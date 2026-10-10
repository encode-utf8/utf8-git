// M3-4 PR 流程：创建 PR 字段校验 + 可合并性判定 + 合并（纯逻辑，前后端共用，无 IO）。

import { validateBranchName } from "./branch-ops";
import { describeOperationFailure, repositorySlug, type OperationDescriptor } from "./operations";

export type MergeMethod = "merge" | "squash" | "rebase";

export const MERGE_METHODS: ReadonlyArray<{ value: MergeMethod; label: string }> = [
  { value: "merge", label: "合并提交" },
  { value: "squash", label: "压扁合并" },
  { value: "rebase", label: "变基合并" },
];

const MERGE_METHOD_VALUES: ReadonlySet<string> = new Set(MERGE_METHODS.map((item) => item.value));

/** 校验合并方式（服务端不接受未知取值）。 */
export function isMergeMethod(value: unknown): value is MergeMethod {
  return typeof value === "string" && MERGE_METHOD_VALUES.has(value);
}

/** 合并方式的中文标签（操作描述与界面共用）。 */
export function mergeMethodLabel(method: MergeMethod): string {
  return MERGE_METHODS.find((item) => item.value === method)?.label ?? method;
}

/** 解析 PR 编号（路径参数 / 查询串）；非正整数返回 null。 */
export function parsePullNumber(value: unknown): number | null {
  const raw = typeof value === "string" ? value.trim() : value;
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export type MergeabilityInput = {
  /** "open" / "closed"（GitHub 的 PR 状态，小写） */
  state: string;
  merged: boolean;
  draft: boolean;
  /** GitHub 异步计算，未完成时为 null */
  mergeable: boolean | null;
  /** clean / dirty / blocked / behind / unstable / unknown */
  mergeableState: string | null;
};

export type Mergeability = {
  canMerge: boolean;
  /** 不可合并的可读原因；可合并时为 null */
  reason: string | null;
};

/**
 * 判定 PR 能否合并，并给出不可合并的原因。
 * 顺序即优先级：已合并 > 已关闭 > 草稿 > 冲突 / 保护规则 > 计算中。
 */
export function evaluateMergeability(input: MergeabilityInput): Mergeability {
  if (input.merged) {
    return { canMerge: false, reason: "该 PR 已经合并。" };
  }
  if (input.state !== "open") {
    return { canMerge: false, reason: "该 PR 已关闭，无法合并。" };
  }
  if (input.draft) {
    return { canMerge: false, reason: "该 PR 仍是草稿，请先标记为可合并。" };
  }
  if (input.mergeable === false) {
    if (input.mergeableState === "dirty") {
      return { canMerge: false, reason: "存在合并冲突，需要先解决冲突。" };
    }
    if (input.mergeableState === "blocked") {
      return { canMerge: false, reason: "被分支保护规则或必需的检查阻塞。" };
    }
    return { canMerge: false, reason: "当前 git 状态不允许自动合并。" };
  }
  if (input.mergeable === null) {
    return { canMerge: false, reason: "GitHub 尚未完成可合并性计算，请稍后重试。" };
  }
  return { canMerge: true, reason: null };
}

export type MergePullRequestInput = {
  owner: string;
  name: string;
  number: number;
  title: string;
  baseBranch: string;
  headBranch: string;
  method: MergeMethod;
};

/** 构造「合并 PR」操作描述：确认卡片与审计记录共用同一份数据。 */
export function createMergePullRequestDescriptor(
  input: MergePullRequestInput,
): OperationDescriptor {
  const { owner, name, number, title, baseBranch, headBranch, method } = input;
  const repo = repositorySlug({ owner, name });
  return {
    kind: "mergePullRequest",
    repo: { owner, name },
    summary: `在 ${repo} 合并 PR #${number}：${title}`,
    impacts: [
      `把 ${headBranch} 合并进 ${baseBranch}（方式：${mergeMethodLabel(method)}）`,
      `合并后 PR #${number} 变为「已合并」，通常不可撤销`,
      "不会删除任何分支",
    ],
    payload: { number: String(number), method },
  };
}

/** 把合并 PR 接口的失败映射为可读文案（供客户端展示）。 */
export function describeMergePullRequestFailure(status: number, code?: string): string {
  return describeOperationFailure(
    status,
    code,
    "PR 暂时无法合并（可能已合并、已关闭或存在冲突）。",
  );
}

export const PR_TITLE_MAX_LENGTH = 256;
export const PR_BODY_MAX_LENGTH = 65536;

/** 校验 PR 标题；通过返回 null，否则返回可读原因。 */
export function validatePullTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) {
    return "PR 标题不能为空。";
  }
  if (trimmed.length > PR_TITLE_MAX_LENGTH) {
    return `PR 标题不能超过 ${PR_TITLE_MAX_LENGTH} 个字符。`;
  }
  return null;
}

/** 校验 PR 正文长度（正文可为空）。 */
export function validatePullBody(body: string): string | null {
  if (body.length > PR_BODY_MAX_LENGTH) {
    return `PR 正文不能超过 ${PR_BODY_MAX_LENGTH} 个字符。`;
  }
  return null;
}

export type PullBranchPair = { head: string; base: string };

/** 校验来源 / 目标分支：各自须是合法分支名，且不能是同一个分支。 */
export function validatePullBranches({ head, base }: PullBranchPair): string | null {
  const headError = validateBranchName(head.trim());
  if (headError) {
    return `来源分支：${headError}`;
  }
  const baseError = validateBranchName(base.trim());
  if (baseError) {
    return `目标分支：${baseError}`;
  }
  if (head.trim() === base.trim()) {
    return "来源分支与目标分支不能相同。";
  }
  return null;
}

export type CreatePullRequestInput = {
  owner: string;
  name: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
};

/** 构造「创建 PR」操作描述：确认卡片与审计记录共用同一份数据。 */
export function createPullRequestDescriptor(input: CreatePullRequestInput): OperationDescriptor {
  const { owner, name, title, body, draft } = input;
  const head = input.head.trim();
  const base = input.base.trim();
  const repo = repositorySlug({ owner, name });
  const trimmedTitle = title.trim();
  return {
    kind: "createPullRequest",
    repo: { owner, name },
    summary: `在 ${repo} 创建 PR：${head} → ${base}`,
    impacts: [
      `新建 PR「${trimmedTitle}」：${head} → ${base}`,
      draft ? "创建为草稿（不立即请求合并）" : "创建为可合并的 PR",
      "不会修改任何分支或提交",
    ],
    payload: { head, base, title: trimmedTitle, body, draft: draft ? "true" : "false" },
  };
}

/** 把创建 PR 接口的失败映射为可读文案（供客户端展示）。 */
export function describeCreatePullRequestFailure(status: number, code?: string): string {
  return describeOperationFailure(
    status,
    code,
    "该分支组合已存在 PR，或标题不被接受，请检查后重试。",
  );
}
