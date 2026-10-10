import { describe, expect, it } from "vitest";

import {
  createDeleteBranchDescriptor,
  describeDeleteBranchFailure,
  evaluateBranchDeletion,
  isProtectedBranch,
} from "./branch-delete-ops";

const base = {
  branch: "feature/demo",
  defaultBranch: "main",
  protectedBranch: false,
  currentBranch: "main",
};

describe("分支可删除性判定", () => {
  it("普通分支可删除", () => {
    expect(evaluateBranchDeletion(base)).toEqual({ canDelete: true, reason: null });
  });

  it("默认分支禁止删除（优先级最高）", () => {
    const verdict = evaluateBranchDeletion({
      ...base,
      branch: "main",
      protectedBranch: true,
      currentBranch: "main",
    });
    expect(verdict.canDelete).toBe(false);
    expect(verdict.reason).toContain("默认分支");
  });

  it("受保护分支禁止删除", () => {
    const verdict = evaluateBranchDeletion({ ...base, protectedBranch: true });
    expect(verdict.canDelete).toBe(false);
    expect(verdict.reason).toContain("保护规则");
  });

  it("当前正在查看的分支禁止删除", () => {
    const verdict = evaluateBranchDeletion({ ...base, currentBranch: "feature/demo" });
    expect(verdict.canDelete).toBe(false);
    expect(verdict.reason).toContain("正在查看");
  });

  it("空分支名提示先选择", () => {
    expect(evaluateBranchDeletion({ ...base, branch: "  " }).reason).toContain("请选择");
  });

  it("忽略分支名两侧空白", () => {
    expect(evaluateBranchDeletion({ ...base, branch: " main " }).reason).toContain("默认分支");
  });
});

describe("默认分支保护判定", () => {
  it("与默认分支同名即视为受保护", () => {
    expect(isProtectedBranch("main", "main")).toBe(true);
    expect(isProtectedBranch("main", " feature/x ")).toBe(false);
    expect(isProtectedBranch(null, "main")).toBe(false);
  });
});

describe("删除分支操作描述", () => {
  it("包含仓库 / 分支与影响预览，并说明不删除提交", () => {
    const descriptor = createDeleteBranchDescriptor({
      owner: "encode-utf8",
      name: "utf8-git",
      branch: "feature/demo",
      headSha: "a".repeat(40),
    });
    expect(descriptor.kind).toBe("deleteBranch");
    expect(descriptor.summary).toBe("在 encode-utf8/utf8-git 删除分支 feature/demo");
    expect(descriptor.payload).toEqual({ branch: "feature/demo", sha: "a".repeat(40) });
    expect(descriptor.impacts.some((impact) => impact.includes("不会删除任何提交"))).toBe(true);
    expect(descriptor.impacts.some((impact) => impact.includes("a".repeat(40)))).toBe(true);
  });

  it("没有 SHA 时只记录分支名", () => {
    const descriptor = createDeleteBranchDescriptor({
      owner: "encode-utf8",
      name: "utf8-git",
      branch: "feature/demo",
    });
    expect(descriptor.payload).toEqual({ branch: "feature/demo" });
    expect(descriptor.impacts.some((impact) => impact.includes("自行记录 SHA"))).toBe(true);
  });
});

describe("删除分支失败文案", () => {
  it("按错误码给出针对性提示", () => {
    expect(describeDeleteBranchFailure(422, "branch_conflict")).toContain("受保护");
    expect(describeDeleteBranchFailure(403, "forbidden")).toContain("权限不足");
    expect(describeDeleteBranchFailure(401, "token_invalid")).toContain("重新登录");
    expect(describeDeleteBranchFailure(404, "not_found")).toContain("不存在");
  });

  it("未知错误码按状态码回退", () => {
    expect(describeDeleteBranchFailure(400, "invalid_branch")).toContain("参数");
    expect(describeDeleteBranchFailure(500, "internal_error")).toContain("稍后重试");
  });
});
