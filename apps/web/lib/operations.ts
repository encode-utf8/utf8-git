// M3-1 操作编排：所有写操作（建分支 / 建 Issue / 合并 PR / 删分支 / 恢复分支）走同一条管线。
// 纯逻辑、无 IO：执行器与审计写入都通过参数注入，便于单测与后续替换持久化实现。

import { sourceTranslate, type MessageKey, type Translate } from "./i18n/translate";
import type { EnvLike } from "./shared-store";

export type OperationKind =
  | "createBranch"
  | "createIssue"
  | "createPullRequest"
  | "mergePullRequest"
  | "deleteBranch"
  | "restoreBranch"
  | "revokeAuthorization"
  | "purgeAccountData";

export type RepositoryRef = { owner: string; name: string };

/** 一次写操作的描述：做什么、影响什么、参数是什么。 */
export type OperationDescriptor = {
  kind: OperationKind;
  repo: RepositoryRef;
  summary: string;
  impacts: string[];
  payload: Record<string, string>;
};

export type OperationErrorCode = "confirmation_required" | "execution_failed";

export class OperationError extends Error {
  readonly code: OperationErrorCode;
  readonly detail: string | null;
  /** 执行阶段抛出的原始错误（如 GitHub 错误分类），供调用方按状态码细化响应。 */
  readonly originalError: unknown;

  constructor(
    code: OperationErrorCode,
    message: string,
    detail: string | null = null,
    originalError: unknown = null,
  ) {
    super(message);
    this.name = "OperationError";
    this.code = code;
    this.detail = detail;
    this.originalError = originalError;
  }
}

/** 审计状态：开始 / 成功 / 失败。 */
export type OperationAuditStatus = "started" | "succeeded" | "failed";

export type OperationAuditRecord = {
  idempotencyKey: string;
  kind: OperationKind;
  repo: string; // owner/name
  actor: string;
  status: OperationAuditStatus;
  summary: string;
  payload: Record<string, string>;
  result: unknown;
  error: string | null;
  recordedAt: string; // ISO 时间
};

/** 审计写入接口：内存 / 数据库实现都只需满足它。 */
export type OperationAuditSink = {
  find(idempotencyKey: string): Promise<OperationAuditRecord | null>;
  append(record: OperationAuditRecord): Promise<void>;
};

export type OperationOutcome<T> = {
  status: "succeeded" | "replayed";
  value: T;
};

/**
 * 幂等回放窗口（M3-8 防重放）：只有窗口内的成功记录才回放。
 * 幂等键由「操作人 + 类型 + 仓库 + 参数」稳定派生，长期有效会把「参数完全相同的新意图」
 * 误判成重放而静默不执行；限定窗口后，过期记录一律按新意图重新执行。
 */
export const DEFAULT_REPLAY_WINDOW_MS = 10 * 60 * 1000;

/** 回放窗口配置：`WRITE_OPERATION_REPLAY_WINDOW_MS`，非法或非正数回退默认。 */
export function getReplayWindowMs(env: EnvLike = process.env): number {
  const raw = Number(env.WRITE_OPERATION_REPLAY_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REPLAY_WINDOW_MS;
}

/** 成功记录是否仍在回放窗口内（时间无法解析时视为不可回放）。 */
export function isWithinReplayWindow(recordedAt: string, now: Date, windowMs: number): boolean {
  const recorded = Date.parse(recordedAt);
  if (!Number.isFinite(recorded)) {
    return false;
  }
  return now.getTime() - recorded <= windowMs;
}

/** 操作状态在消息目录中的键：操作历史页与审计导出共用同一份文案。 */
const OPERATION_STATUS_KEY: Record<OperationAuditStatus, MessageKey> = {
  started: "ops.status.started",
  succeeded: "ops.status.succeeded",
  failed: "ops.status.failed",
};

/** 操作类型在消息目录中的键：确认卡片按钮、操作历史页共用同一份文案。 */
const OPERATION_KIND_KEY: Record<OperationKind, MessageKey> = {
  createBranch: "ops.kind.createBranch",
  createIssue: "ops.kind.createIssue",
  createPullRequest: "ops.kind.createPullRequest",
  mergePullRequest: "ops.kind.mergePullRequest",
  deleteBranch: "ops.kind.deleteBranch",
  restoreBranch: "ops.kind.restoreBranch",
  revokeAuthorization: "ops.kind.revokeAuthorization",
  purgeAccountData: "ops.kind.purgeAccountData",
};

/** 操作状态的可读名（默认源语言，供审计导出等无界面场景使用）。 */
export function operationStatusLabel(
  status: OperationAuditStatus,
  t: Translate = sourceTranslate,
): string {
  return t(OPERATION_STATUS_KEY[status]);
}

/** 操作类型 / 确认按钮的可读名。 */
export function operationKindLabel(kind: OperationKind, t: Translate = sourceTranslate): string {
  return t(OPERATION_KIND_KEY[kind]);
}

// 破坏性操作：确认卡片用红色主按钮呈现（删除分支、撤销授权、清除数据）
const DANGER_KINDS: ReadonlySet<OperationKind> = new Set<OperationKind>([
  "deleteBranch",
  "revokeAuthorization",
  "purgeAccountData",
]);

export type ConfirmationView = {
  title: string;
  impacts: string[];
  confirmLabel: string;
  danger: boolean;
};

export function repositorySlug(repo: RepositoryRef): string {
  return `${repo.owner}/${repo.name}`;
}

/** 确认卡片所需的展示信息（标题 / 影响预览 / 按钮文案 / 是否危险操作）。 */
export function confirmationView(
  descriptor: OperationDescriptor,
  t: Translate = sourceTranslate,
): ConfirmationView {
  return {
    title: descriptor.summary,
    impacts: descriptor.impacts,
    confirmLabel: operationKindLabel(descriptor.kind, t),
    danger: DANGER_KINDS.has(descriptor.kind),
  };
}

/** 幂等键：由 actor + 操作类型 + 仓库 + 排序后的参数稳定拼接，客户端重试不会重复执行。 */
export function createIdempotencyKey(descriptor: OperationDescriptor, actor: string): string {
  const payload = Object.keys(descriptor.payload)
    .sort()
    .map((key) => `${key}=${descriptor.payload[key]}`)
    .join("&");
  return [actor, descriptor.kind, repositorySlug(descriptor.repo), payload].join("|");
}

export type RunOperationOptions<T> = {
  descriptor: OperationDescriptor;
  actor: string;
  idempotencyKey: string;
  confirmed: boolean;
  execute: () => Promise<T>;
  audit: OperationAuditSink;
  now?: () => Date;
  /** 幂等回放窗口（毫秒）；成功记录超出窗口后不再回放，按新意图重新执行。 */
  replayWindowMs?: number;
};

/**
 * 统一写操作管线：
 * 1) 必须显式确认，否则拒绝执行；
 * 2) 幂等键命中「窗口内已成功」记录时直接回放结果，不重复执行；
 * 3) 执行前后各写一条审计（started → succeeded / failed）。
 */
export async function runOperation<T>({
  descriptor,
  actor,
  idempotencyKey,
  confirmed,
  execute,
  audit,
  now = () => new Date(),
  replayWindowMs = DEFAULT_REPLAY_WINDOW_MS,
}: RunOperationOptions<T>): Promise<OperationOutcome<T>> {
  if (!confirmed) {
    throw new OperationError("confirmation_required", "写操作需要用户确认后才能执行。");
  }

  const existing = await audit.find(idempotencyKey);
  if (
    existing?.status === "succeeded" &&
    isWithinReplayWindow(existing.recordedAt, now(), replayWindowMs)
  ) {
    return { status: "replayed", value: existing.result as T };
  }

  const base = {
    idempotencyKey,
    kind: descriptor.kind,
    repo: repositorySlug(descriptor.repo),
    actor,
    summary: descriptor.summary,
    payload: descriptor.payload,
  };

  await audit.append({
    ...base,
    status: "started",
    result: null,
    error: null,
    recordedAt: now().toISOString(),
  });

  try {
    const value = await execute();
    await audit.append({
      ...base,
      status: "succeeded",
      result: value ?? null,
      error: null,
      recordedAt: now().toISOString(),
    });
    return { status: "succeeded", value };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await audit.append({
      ...base,
      status: "failed",
      result: null,
      error: detail,
      recordedAt: now().toISOString(),
    });
    throw new OperationError("execution_failed", "写操作执行失败，已记录审计。", detail, error);
  }
}

/**
 * 把写操作接口的失败映射为可读文案（供客户端展示）。
 * conflictMessage 由具体操作提供——不同操作「冲突」的语义不同。
 */
export function describeOperationFailure(
  status: number,
  code: string | undefined,
  conflictMessage: string,
  t: Translate = sourceTranslate,
): string {
  switch (code) {
    case "token_invalid":
    case "no_token":
      return t("ops.failure.unauthorized");
    case "forbidden":
      return t("ops.failure.forbidden");
    case "not_found":
      return t("ops.failure.notFound");
    case "rate_limited":
      return t("ops.failure.rateLimited");
    case "github_unreachable":
      return t("ops.failure.unreachable");
    case "github_timeout":
      return t("ops.failure.timeout");
    case "confirmation_required":
      return t("ops.failure.confirmationRequired");
    case "too_many_requests":
      return t("ops.failure.tooManyRequests");
    case "branch_conflict":
    case "issue_invalid":
    case "pull_invalid":
    case "pull_not_mergeable":
    case "revoke_failed":
    case "purge_failed":
      return conflictMessage;
    case "revoke_unavailable":
      return t("ops.failure.revokeUnavailable");
    default:
      break;
  }
  if (status === 400) {
    return t("ops.failure.badRequest");
  }
  return t("ops.failure.generic");
}
