// M3-4 PR 流程：创建 PR 字段校验 + 可合并性判定 + 合并（纯逻辑，前后端共用，无 IO）。

import { validateBranchName } from "./branch-ops";
import { sourceTranslate, type MessageKey, type Translate } from "./i18n/translate";
import { describeOperationFailure, repositorySlug, type OperationDescriptor } from "./operations";

export type MergeMethod = "merge" | "squash" | "rebase";

export const MERGE_METHODS: ReadonlyArray<{ value: MergeMethod; labelKey: MessageKey }> = [
  { value: "merge", labelKey: "ops.mergeMethod.merge" },
  { value: "squash", labelKey: "ops.mergeMethod.squash" },
  { value: "rebase", labelKey: "ops.mergeMethod.rebase" },
];

const MERGE_METHOD_VALUES: ReadonlySet<string> = new Set(MERGE_METHODS.map((item) => item.value));

/** 校验合并方式（服务端不接受未知取值）。 */
export function isMergeMethod(value: unknown): value is MergeMethod {
  return typeof value === "string" && MERGE_METHOD_VALUES.has(value);
}

/** 合并方式的可读名（操作描述与界面共用）。 */
export function mergeMethodLabel(method: MergeMethod, t: Translate = sourceTranslate): string {
  const option = MERGE_METHODS.find((item) => item.value === method);
  return option ? t(option.labelKey) : method;
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
export function evaluateMergeability(
  input: MergeabilityInput,
  t: Translate = sourceTranslate,
): Mergeability {
  if (input.merged) {
    return { canMerge: false, reason: t("ops.mergeability.merged") };
  }
  if (input.state !== "open") {
    return { canMerge: false, reason: t("ops.mergeability.closed") };
  }
  if (input.draft) {
    return { canMerge: false, reason: t("ops.mergeability.draft") };
  }
  if (input.mergeable === false) {
    if (input.mergeableState === "dirty") {
      return { canMerge: false, reason: t("ops.mergeability.conflict") };
    }
    if (input.mergeableState === "blocked") {
      return { canMerge: false, reason: t("ops.mergeability.blocked") };
    }
    return { canMerge: false, reason: t("ops.mergeability.notAllowed") };
  }
  if (input.mergeable === null) {
    return { canMerge: false, reason: t("ops.mergeability.pending") };
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
  t: Translate = sourceTranslate,
): OperationDescriptor {
  const { owner, name, number, title, baseBranch, headBranch, method } = input;
  const repo = repositorySlug({ owner, name });
  return {
    kind: "mergePullRequest",
    repo: { owner, name },
    summary: t("ops.descriptor.mergePullRequest.summary", { repo, number, title }),
    impacts: [
      t("ops.descriptor.mergePullRequest.merge", {
        head: headBranch,
        base: baseBranch,
        method: mergeMethodLabel(method, t),
      }),
      t("ops.descriptor.mergePullRequest.result", { number }),
      t("ops.descriptor.mergePullRequest.noDeleteBranch"),
    ],
    payload: { number: String(number), method },
  };
}

/** 把合并 PR 接口的失败映射为可读文案（供客户端展示）。 */
export function describeMergePullRequestFailure(
  status: number,
  code?: string,
  t: Translate = sourceTranslate,
): string {
  return describeOperationFailure(status, code, t("ops.conflict.mergePullRequest"), t);
}

export const PR_TITLE_MAX_LENGTH = 256;
export const PR_BODY_MAX_LENGTH = 65536;

/** 校验 PR 标题；通过返回 null，否则返回可读原因。 */
export function validatePullTitle(title: string, t: Translate = sourceTranslate): string | null {
  const trimmed = title.trim();
  if (!trimmed) {
    return t("ops.pullTitle.empty");
  }
  if (trimmed.length > PR_TITLE_MAX_LENGTH) {
    return t("ops.pullTitle.tooLong", { max: PR_TITLE_MAX_LENGTH });
  }
  return null;
}

/** 校验 PR 正文长度（正文可为空）。 */
export function validatePullBody(body: string, t: Translate = sourceTranslate): string | null {
  if (body.length > PR_BODY_MAX_LENGTH) {
    return t("ops.pullBody.tooLong", { max: PR_BODY_MAX_LENGTH });
  }
  return null;
}

export type PullBranchPair = { head: string; base: string };

/** 校验来源 / 目标分支：各自须是合法分支名，且不能是同一个分支。 */
export function validatePullBranches(
  { head, base }: PullBranchPair,
  t: Translate = sourceTranslate,
): string | null {
  const headError = validateBranchName(head.trim(), t);
  if (headError) {
    return t("ops.pullBranches.headInvalid", { reason: headError });
  }
  const baseError = validateBranchName(base.trim(), t);
  if (baseError) {
    return t("ops.pullBranches.baseInvalid", { reason: baseError });
  }
  if (head.trim() === base.trim()) {
    return t("ops.pullBranches.same");
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
export function createPullRequestDescriptor(
  input: CreatePullRequestInput,
  t: Translate = sourceTranslate,
): OperationDescriptor {
  const { owner, name, title, body, draft } = input;
  const head = input.head.trim();
  const base = input.base.trim();
  const repo = repositorySlug({ owner, name });
  const trimmedTitle = title.trim();
  return {
    kind: "createPullRequest",
    repo: { owner, name },
    summary: t("ops.descriptor.createPullRequest.summary", { repo, head, base }),
    impacts: [
      t("ops.descriptor.createPullRequest.created", { title: trimmedTitle, head, base }),
      draft
        ? t("ops.descriptor.createPullRequest.draft")
        : t("ops.descriptor.createPullRequest.ready"),
      t("ops.descriptor.createPullRequest.noChange"),
    ],
    payload: { head, base, title: trimmedTitle, body, draft: draft ? "true" : "false" },
  };
}

/** 把创建 PR 接口的失败映射为可读文案（供客户端展示）。 */
export function describeCreatePullRequestFailure(
  status: number,
  code?: string,
  t: Translate = sourceTranslate,
): string {
  return describeOperationFailure(status, code, t("ops.conflict.createPullRequest"), t);
}
