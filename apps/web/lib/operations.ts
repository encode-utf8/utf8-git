// M3-1 操作编排：所有写操作（建分支 / 建 Issue / 合并 PR / 删分支）走同一条管线。
// 纯逻辑、无 IO：执行器与审计写入都通过参数注入，便于单测与后续替换持久化实现。

export type OperationKind = "createBranch" | "createIssue" | "mergePullRequest" | "deleteBranch";

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

  constructor(code: OperationErrorCode, message: string, detail: string | null = null) {
    super(message);
    this.name = "OperationError";
    this.code = code;
    this.detail = detail;
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

const CONFIRM_LABEL: Record<OperationKind, string> = {
  createBranch: "创建分支",
  createIssue: "创建 Issue",
  mergePullRequest: "合并 PR",
  deleteBranch: "删除分支",
};

const DANGER_KINDS: ReadonlySet<OperationKind> = new Set<OperationKind>(["deleteBranch"]);

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
export function confirmationView(descriptor: OperationDescriptor): ConfirmationView {
  return {
    title: descriptor.summary,
    impacts: descriptor.impacts,
    confirmLabel: CONFIRM_LABEL[descriptor.kind],
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
};

/**
 * 统一写操作管线：
 * 1) 必须显式确认，否则拒绝执行；
 * 2) 幂等键命中「已成功」记录时直接回放结果，不重复执行；
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
}: RunOperationOptions<T>): Promise<OperationOutcome<T>> {
  if (!confirmed) {
    throw new OperationError("confirmation_required", "写操作需要用户确认后才能执行。");
  }

  const existing = await audit.find(idempotencyKey);
  if (existing?.status === "succeeded") {
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
    throw new OperationError("execution_failed", "写操作执行失败，已记录审计。", detail);
  }
}
