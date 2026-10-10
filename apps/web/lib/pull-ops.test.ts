import { describe, expect, it } from "vitest";

import {
  createMergePullRequestDescriptor,
  createPullRequestDescriptor,
  describeCreatePullRequestFailure,
  describeMergePullRequestFailure,
  evaluateMergeability,
  isMergeMethod,
  mergeMethodLabel,
  parsePullNumber,
  validatePullBody,
  validatePullBranches,
  validatePullTitle,
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

describe("创建 PR 字段校验", () => {
  it("标题必填且有长度上限", () => {
    expect(validatePullTitle("")).toContain("不能为空");
    expect(validatePullTitle("   ")).toContain("不能为空");
    expect(validatePullTitle("a".repeat(257))).toContain("256");
    expect(validatePullTitle("feat: 合并时间线")).toBeNull();
  });

  it("正文可为空但有长度上限", () => {
    expect(validatePullBody("")).toBeNull();
    expect(validatePullBody("a".repeat(65537))).toContain("65536");
  });

  it("来源 / 目标分支须合法且不能相同", () => {
    expect(validatePullBranches({ head: "feature/x", base: "main" })).toBeNull();
    expect(validatePullBranches({ head: "", base: "main" })).toContain("来源分支");
    expect(validatePullBranches({ head: "feature/x", base: "ma in" })).toContain("目标分支");
    expect(validatePullBranches({ head: "main", base: "main" })).toContain("不能相同");
  });
});

describe("创建 PR 操作描述", () => {
  it("包含分支方向 / 标题与草稿标记", () => {
    const descriptor = createPullRequestDescriptor({
      owner: "encode-utf8",
      name: "utf8-git",
      head: "feature/e2e",
      base: "main",
      title: "  feat: 合并时间线  ",
      body: "## 背景",
      draft: true,
    });
    expect(descriptor.kind).toBe("createPullRequest");
    expect(descriptor.summary).toBe("在 encode-utf8/utf8-git 创建 PR：feature/e2e → main");
    expect(descriptor.impacts[0]).toContain("feat: 合并时间线");
    expect(descriptor.impacts[1]).toContain("草稿");
    expect(descriptor.payload).toEqual({
      head: "feature/e2e",
      base: "main",
      title: "feat: 合并时间线",
      body: "## 背景",
      draft: "true",
    });
  });

  it("非草稿时给出可合并提示", () => {
    const descriptor = createPullRequestDescriptor({
      owner: "o",
      name: "n",
      head: "h",
      base: "b",
      title: "t",
      body: "",
      draft: false,
    });
    expect(descriptor.impacts[1]).toBe("创建为可合并的 PR");
  });
});

describe("创建 PR 失败文案", () => {
  it("冲突错误使用 PR 专用文案", () => {
    expect(describeCreatePullRequestFailure(422, "pull_invalid")).toContain("已存在");
    expect(describeCreatePullRequestFailure(403, "forbidden")).toContain("权限不足");
  });
});
