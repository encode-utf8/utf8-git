// M3-1 写操作审计存储：接口 + 内存实现（Postgres 实现见 pg-stores.ts）。
// 内存实现用于单测与 STORE_BACKEND=memory 的单实例 / 本地开发。

import type {
  OperationAuditRecord,
  OperationAuditSink,
  OperationAuditStatus,
  OperationKind,
} from "./operations";
import type { EnvLike } from "./shared-store";

export type OperationAuditQuery = {
  repo?: string;
  actor?: string;
  /** 按操作类型过滤（如删除分支的恢复入口只关心 deleteBranch）。 */
  kind?: OperationKind;
  /** 按状态过滤（恢复入口只看 succeeded，避免列出失败记录）。 */
  status?: OperationAuditStatus;
  /** 只匹配 recordedAt >= since 的记录（M3-8 写操作频率限制的滑动窗口）。 */
  since?: string;
  limit?: number;
};

/**
 * 审计存储：写操作管线只依赖 find / append。
 * list 供分支恢复（M3-6）与操作历史页（M3-7）使用；count 供写操作频率限制（M3-8）
 * 统计窗口内的尝试次数；prune 负责保留期清理，避免审计表无限增长。
 */
export interface OperationAuditStoreLike extends OperationAuditSink {
  list(query?: OperationAuditQuery): Promise<OperationAuditRecord[]>;
  count(query?: OperationAuditQuery): Promise<number>;
  prune(before: Date): Promise<number>;
}

export const DEFAULT_AUDIT_LIMIT = 50;

// 审计保留期（默认 90 天）：写操作时按概率顺带清理过期记录。
export const DEFAULT_AUDIT_RETENTION_DAYS = 90;

// 过期条目清理概率：写入时顺带清理，避免每次写操作都扫表（与 PgTtlCache 同一策略）
export const AUDIT_PURGE_PROBABILITY = 0.02;

/** 保留期（毫秒）：非法或非正数回退默认；环境变量 `OPERATION_AUDIT_RETENTION_DAYS`。 */
export function getAuditRetentionMs(env: EnvLike = process.env): number {
  const raw = Number(env.OPERATION_AUDIT_RETENTION_DAYS);
  const days = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AUDIT_RETENTION_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

/** 记录是否命中查询条件（内存实现的 list / count 共用）。 */
function matchesQuery(record: OperationAuditRecord, query: OperationAuditQuery): boolean {
  if (query.repo && record.repo !== query.repo) {
    return false;
  }
  if (query.actor && record.actor !== query.actor) {
    return false;
  }
  if (query.kind && record.kind !== query.kind) {
    return false;
  }
  if (query.status && record.status !== query.status) {
    return false;
  }
  if (query.since) {
    const since = Date.parse(query.since);
    if (Number.isFinite(since) && Date.parse(record.recordedAt) < since) {
      return false;
    }
  }
  return true;
}

/**
 * 同一幂等键只保留最新一条记录：写管线会先写 started、成功 / 失败再写一条终态，
 * 操作历史页按此收敛后每条操作只出现一次。入参需为「最新优先」（list 的返回顺序）。
 */
export function latestPerIdempotencyKey(records: OperationAuditRecord[]): OperationAuditRecord[] {
  const seen = new Set<string>();
  const latest: OperationAuditRecord[] = [];
  for (const record of records) {
    if (seen.has(record.idempotencyKey)) {
      continue;
    }
    seen.add(record.idempotencyKey);
    latest.push(record);
  }
  return latest;
}

/** 内存审计存储：按写入顺序保留；find 返回该幂等键最近的一条。 */
export class MemoryOperationAuditStore implements OperationAuditStoreLike {
  private readonly records: OperationAuditRecord[] = [];

  constructor(
    private readonly options: {
      now?: () => number;
      random?: () => number;
      retentionMs?: number;
      purgeProbability?: number;
    } = {},
  ) {}

  async find(idempotencyKey: string): Promise<OperationAuditRecord | null> {
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      if (this.records[index].idempotencyKey === idempotencyKey) {
        return this.records[index];
      }
    }
    return null;
  }

  async append(record: OperationAuditRecord): Promise<void> {
    this.records.push(record);
    // 内存后端默认不做自动清理（进程重启即清空，且避免单测出现随机行为）；
    // 长期运行的多实例部署走 PgOperationAuditStore，那里默认按概率清理。
    const random = this.options.random ?? Math.random;
    const probability = this.options.purgeProbability ?? 0;
    if (random() < probability) {
      await this.prune(this.retentionCutoff());
    }
  }

  /** 最新优先；支持按仓库 / 操作人 / 类型 / 状态 / 时间下界过滤与条数上限。 */
  async list(query: OperationAuditQuery = {}): Promise<OperationAuditRecord[]> {
    const limit = query.limit ?? DEFAULT_AUDIT_LIMIT;
    return this.records
      .filter((item) => matchesQuery(item, query))
      .slice(-limit)
      .reverse();
  }

  /** 统计命中条件的记录数（频率限制只关心窗口内的 started 记录）。 */
  async count(query: OperationAuditQuery = {}): Promise<number> {
    return this.records.reduce((total, item) => (matchesQuery(item, query) ? total + 1 : total), 0);
  }

  /** 删除 recordedAt < before 的记录，返回删除条数（保留期清理）。 */
  async prune(before: Date): Promise<number> {
    const cutoff = before.getTime();
    const kept = this.records.filter((item) => Date.parse(item.recordedAt) >= cutoff);
    const removed = this.records.length - kept.length;
    this.records.length = 0;
    this.records.push(...kept);
    return removed;
  }

  private retentionCutoff(): Date {
    const now = this.options.now ?? Date.now;
    const retentionMs = this.options.retentionMs ?? getAuditRetentionMs();
    return new Date(now() - retentionMs);
  }
}
