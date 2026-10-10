import { describe, expect, it } from "vitest";

import {
  RESTORE_WINDOW_MS,
  createRestoreBranchDescriptor,
  describeRestoreBranchFailure,
  describeRestoreRemaining,
  evaluateBranchRestore,
  restoreDeadline,
} from "./branch-restore-ops";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const SHA = "a".repeat(40);
const base = { branch: "feature/demo", sha: SHA, recordedAt: "2026-10-10T06:00:00.000Z", now: NOW };

describe("恢复窗口", () => {
  it("截止时间 = 删除时间 + 24h", () => {
    expect(restoreDeadline("2026-10-10T06:00:00.000Z").toISOString()).toBe(
      "2026-10-11T06:00:00.000Z",
    );
    expect(RESTORE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("剩余时间按小时 / 分钟给出可读描述", () => {
    expect(describeRestoreRemaining("2026-10-10T06:00:00.000Z", NOW)).toContain("约 18 小时");
    expect(describeRestoreRemaining("2026-10-09T12:30:00.000Z", NOW)).toContain("约 30 分钟");
    expect(describeRestoreRemaining("2026-10-08T00:00:00.000Z", NOW)).toBe("恢复窗口已过期");
    expect(describeRestoreRemaining("not-a-date", NOW)).toBe("恢复窗口未知");
  });
});

describe("可恢复性判定", () => {
  it("窗口内的删除记录可恢复", () => {
    expect(evaluateBranchRestore(base)).toEqual({ canRestore: true, reason: null });
  });

  it("恰好在窗口边界内仍可恢复", () => {
    const recordedAt = new Date(NOW - RESTORE_WINDOW_MS + 1000).toISOString();
    expect(evaluateBranchRestore({ ...base, recordedAt }).canRestore).toBe(true);
  });

  it("超出 24h 不可恢复", () => {
    const recordedAt = new Date(NOW - RESTORE_WINDOW_MS - 1000).toISOString();
    const verdict = evaluateBranchRestore({ ...base, recordedAt });
    expect(verdict.canRestore).toBe(false);
    expect(verdict.reason).toContain("24 小时");
  });

  it("缺少 SHA 或分支名不可恢复", () => {
    expect(evaluateBranchRestore({ ...base, sha: null }).reason).toContain("SHA");
    expect(evaluateBranchRestore({ ...base, branch: "  " }).reason).toContain("分支名");
  });

  it("删除时间非法不可恢复", () => {
    expect(evaluateBranchRestore({ ...base, recordedAt: "bad" }).reason).toContain("时间无效");
  });
});

describe("恢复分支操作描述", () => {
  it("包含仓库 / 分支 / SHA 与影响预览，并说明保护规则不继承", () => {
    const descriptor = createRestoreBranchDescriptor({
      owner: "encode-utf8",
      name: "utf8-git",
      branch: "feature/demo",
      sha: SHA,
      source: "u1|deleteBranch|encode-utf8/utf8-git|branch=feature/demo",
    });
    expect(descriptor.kind).toBe("restoreBranch");
    expect(descriptor.summary).toBe("在 encode-utf8/utf8-git 恢复分支 feature/demo");
    expect(descriptor.payload).toEqual({
      branch: "feature/demo",
      from: SHA,
      source: "u1|deleteBranch|encode-utf8/utf8-git|branch=feature/demo",
    });
    expect(descriptor.impacts[0]).toContain("feature/demo");
    expect(descriptor.impacts.some((impact) => impact.includes("不继承原保护规则"))).toBe(true);
  });

  it("来源记录不同则幂等键不同（避免二次恢复被当作回放）", () => {
    const first = createRestoreBranchDescriptor({
      owner: "o",
      name: "n",
      branch: "b",
      sha: SHA,
      source: "delete-1",
    });
    const second = createRestoreBranchDescriptor({
      owner: "o",
      name: "n",
      branch: "b",
      sha: SHA,
      source: "delete-2",
    });
    expect(first.payload).not.toEqual(second.payload);
  });
});

describe("恢复分支失败文案", () => {
  it("按错误码给出针对性提示", () => {
    expect(describeRestoreBranchFailure(422, "branch_conflict")).toContain("已存在");
    expect(describeRestoreBranchFailure(403, "forbidden")).toContain("权限不足");
    expect(describeRestoreBranchFailure(401, "token_invalid")).toContain("重新登录");
  });

  it("未知错误码按状态码回退", () => {
    expect(describeRestoreBranchFailure(400, "invalid_body")).toContain("参数");
    expect(describeRestoreBranchFailure(500, "internal_error")).toContain("稍后重试");
  });
});
