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
  /** 原始记录条数上限（list / count / oldestRecordedAt 共用）。 */
  limit?: number;
  /** 原始记录偏移（list 用；按「操作条数」分页请用 listOperations）。 */
  offset?: number;
};

/**
 * 审计存储：写操作管线只依赖 find / append。
 * list 供分支恢复（M3-6）与操作历史页（M3-7）使用；count 供写操作频率限制（M3-8）
 * 统计窗口内的尝试次数；prune 负责保留期清理，避免审计表无限增长。
 */
export interface OperationAuditStoreLike extends OperationAuditSink {
  list(query?: OperationAuditQuery): Promise<OperationAuditRecord[]>;
  /** 操作历史：按「单次操作」分页（同键只保留最新一条），offset / limit 以操作条数计。 */
  listOperations(query?: OperationAuditQuery): Promise<OperationAuditRecord[]>;
  count(query?: OperationAuditQuery): Promise<number>;
  /** 命中条件中最早一条的 recordedAt：频率限制据此给出精确的 Retry-After。 */
  oldestRecordedAt(query?: OperationAuditQuery): Promise<string | null>;
  prune(before: Date): Promise<number>;
}

// 操作历史分页：同一次操作通常写 2 条记录（started + 终态），按「操作条数」分页要多取一些
// 原始记录再收敛；达到上限只展示较新的部分（更深的翻页需要游标，见开发记录的风险清单）。
export const OPERATION_SCAN_FACTOR = 3;
export const OPERATION_SCAN_LIMIT = 600;

/** 为某个分页窗口预取的原始记录条数。 */
export function operationScanLimit(limit: number, offset: number): number {
  return Math.min((offset + limit) * OPERATION_SCAN_FACTOR, OPERATION_SCAN_LIMIT);
}

/** 收敛后分页：按幂等键收敛成「每次操作一条」，再取第 offset 条起的 limit 条。 */
export function latestOperationPage(
  records: OperationAuditRecord[],
  limit: number,
  offset = 0,
): OperationAuditRecord[] {
  return latestPerIdempotencyKey(records).slice(offset, offset + limit);
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

  /** 最新优先；支持按仓库 / 操作人 / 类型 / 状态 / 时间下界过滤与条数上限、偏移。 */
  async list(query: OperationAuditQuery = {}): Promise<OperationAuditRecord[]> {
    const limit = query.limit ?? DEFAULT_AUDIT_LIMIT;
    const offset = query.offset ?? 0;
    const matched = this.records.filter((item) => matchesQuery(item, query));
    const end = Math.max(0, matched.length - offset);
    return matched.slice(Math.max(0, end - limit), end).reverse();
  }

  /** 操作历史分页：预取原始记录后按幂等键收敛（见 latestOperationPage）。 */
  async listOperations(query: OperationAuditQuery = {}): Promise<OperationAuditRecord[]> {
    const limit = query.limit ?? DEFAULT_AUDIT_LIMIT;
    const offset = query.offset ?? 0;
    const rows = await this.list({ ...query, limit: operationScanLimit(limit, offset), offset: 0 });
    return latestOperationPage(rows, limit, offset);
  }

  /** 统计命中条件的记录数（频率限制只关心窗口内的 started 记录）。 */
  async count(query: OperationAuditQuery = {}): Promise<number> {
    return this.records.reduce((total, item) => (matchesQuery(item, query) ? total + 1 : total), 0);
  }

  /** 命中条件中最早一条的 recordedAt（频率限制据此算精确等待时间）。 */
  async oldestRecordedAt(query: OperationAuditQuery = {}): Promise<string | null> {
    let oldestAt: number | null = null;
    let oldest: string | null = null;
    for (const item of this.records) {
      if (!matchesQuery(item, query)) {
        continue;
      }
      const at = Date.parse(item.recordedAt);
      if (!Number.isFinite(at)) {
        continue;
      }
      if (oldestAt === null || at < oldestAt) {
        oldestAt = at;
        oldest = item.recordedAt;
      }
    }
    return oldest;
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
