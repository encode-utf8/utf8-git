import { describe, expect, it } from "vitest";

import {
  createMergePullRequestDescriptor,
  describeMergePullRequestFailure,
  evaluateMergeability,
  isMergeMethod,
  mergeMethodLabel,
  parsePullNumber,
  type MergeabilityInput,
} from "./pull-ops";

function mergeability(overrides: Partial<MergeabilityInput> = {}): MergeabilityInput {
  return {
    state: "open",
    merged: false,
    draft: false,
    mergeable: true,
    mergeableState: "clean",
    ...overrides,
  };
}

describe("PR 编号解析", () => {
  it("接受正整数（含字符串形式）", () => {
    expect(parsePullNumber(12)).toBe(12);
    expect(parsePullNumber("12")).toBe(12);
    expect(parsePullNumber(" 7 ")).toBe(7);
  });

  it("拒绝非正整数与其它类型", () => {
    expect(parsePullNumber("0")).toBeNull();
    expect(parsePullNumber("-3")).toBeNull();
    expect(parsePullNumber("1.5")).toBeNull();
    expect(parsePullNumber("abc")).toBeNull();
    expect(parsePullNumber(0)).toBeNull();
    expect(parsePullNumber(null)).toBeNull();
    expect(parsePullNumber(undefined)).toBeNull();
  });
});

describe("合并方式", () => {
  it("只接受 merge / squash / rebase", () => {
    expect(isMergeMethod("merge")).toBe(true);
    expect(isMergeMethod("squash")).toBe(true);
    expect(isMergeMethod("rebase")).toBe(true);
    expect(isMergeMethod("fast-forward")).toBe(false);
    expect(isMergeMethod(null)).toBe(false);
  });

  it("给出中文标签", () => {
    expect(mergeMethodLabel("squash")).toBe("压扁合并");
  });
});

describe("可合并性判定", () => {
  it("干净且开放时为可合并", () => {
    expect(evaluateMergeability(mergeability())).toEqual({ canMerge: true, reason: null });
  });

  it("已合并 / 已关闭 / 草稿分别给出原因", () => {
    expect(evaluateMergeability(mergeability({ merged: true })).reason).toContain("已经合并");
    expect(evaluateMergeability(mergeability({ state: "closed" })).reason).toContain("已关闭");
    expect(evaluateMergeability(mergeability({ draft: true })).reason).toContain("草稿");
  });

  it("dirty 提示冲突，blocked 提示保护规则", () => {
    expect(
      evaluateMergeability(mergeability({ mergeable: false, mergeableState: "dirty" })).reason,
    ).toContain("合并冲突");
    expect(
      evaluateMergeability(mergeability({ mergeable: false, mergeableState: "blocked" })).reason,
    ).toContain("保护规则");
  });

  it("mergeable 为 null 时提示稍后重试", () => {
    const result = evaluateMergeability(
      mergeability({ mergeable: null, mergeableState: "unknown" }),
    );
    expect(result.canMerge).toBe(false);
    expect(result.reason).toContain("稍后重试");
  });

  it("behind（落后但可合并）仍允许合并", () => {
    expect(evaluateMergeability(mergeability({ mergeableState: "behind" })).canMerge).toBe(true);
  });
});

describe("合并 PR 操作描述", () => {
  it("包含编号 / 分支 / 合并方式与影响预览", () => {
    const descriptor = createMergePullRequestDescriptor({
      owner: "encode-utf8",
      name: "utf8-git",
      number: 61,
      title: "feat: 待合并的分支",
      baseBranch: "main",
      headBranch: "feature/e2e-created",
      method: "squash",
    });
    expect(descriptor.kind).toBe("mergePullRequest");
    expect(descriptor.summary).toBe("在 encode-utf8/utf8-git 合并 PR #61：feat: 待合并的分支");
    expect(descriptor.impacts[0]).toContain("feature/e2e-created");
    expect(descriptor.impacts[0]).toContain("main");
    expect(descriptor.impacts[0]).toContain("压扁合并");
    expect(descriptor.payload).toEqual({ number: "61", method: "squash" });
  });
});

describe("合并 PR 失败文案", () => {
  it("不可合并使用 PR 专用文案", () => {
    expect(describeMergePullRequestFailure(422, "pull_not_mergeable")).toContain("无法合并");
    expect(describeMergePullRequestFailure(403, "forbidden")).toContain("权限不足");
    expect(describeMergePullRequestFailure(429, "rate_limited")).toContain("过于频繁");
  });
});
