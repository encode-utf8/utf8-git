// Postgres 共享存储实现（M1-6）：多实例 / Serverless 部署下的跨实例 TTL 缓存与限流快照。
//
// 取舍：MVP 不引入 Redis，直接用已有的 Postgres 承担跨实例状态；
// 代价是缓存命中多 1 次数据库读、回源多 1 次写（详见 docs/deployment.md）。

import { Prisma, type OperationAudit, type PrismaClient } from "@prisma/client";

import {
  AUDIT_PURGE_PROBABILITY,
  DEFAULT_AUDIT_LIMIT,
  getAuditRetentionMs,
  latestOperationPage,
  operationScanLimit,
  type OperationAuditQuery,
  type OperationAuditStoreLike,
} from "./operation-audit";
import type { OperationAuditRecord } from "./operations";
import type { DegradeDecision, RateLimitSnapshot } from "./rate-limit-store";
import type { CacheLookup } from "./server-cache";
import { decideDegrade, isFresh, type RateLimitStoreLike, type TtlCacheLike } from "./shared-store";

// 过期条目清理概率：写入时顺带清理，避免每次请求都扫表
const PURGE_PROBABILITY = 0.02;

export class PgTtlCache<V> implements TtlCacheLike<V> {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scope: string,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  async get(key: string): Promise<CacheLookup<V> | null> {
    const row = await this.prisma.sharedCacheEntry.findUnique({
      where: { key },
      select: { value: true, storedAt: true },
    });
    if (!row) {
      return null;
    }
    const storedAt = Number(row.storedAt);
    return {
      value: row.value as unknown as V,
      storedAt,
      fresh: isFresh(storedAt, this.ttlMs, this.now()),
    };
  }

  async set(key: string, value: V): Promise<void> {
    const now = this.now();
    const data = {
      scope: this.scope,
      value: value as unknown as Prisma.InputJsonValue,
      storedAt: BigInt(now),
      expiresAt: new Date(now + this.ttlMs),
    };
    await this.prisma.sharedCacheEntry.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
    if (this.random() < PURGE_PROBABILITY) {
      await this.purgeExpired(now);
    }
  }

  async delete(key: string): Promise<void> {
    await this.prisma.sharedCacheEntry.deleteMany({ where: { key } });
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    await this.prisma.sharedCacheEntry.deleteMany({ where: { key: { startsWith: prefix } } });
  }

  // 清理已过期条目（按需调用，避免表无限增长）
  async purgeExpired(now: number = this.now()): Promise<number> {
    const result = await this.prisma.sharedCacheEntry.deleteMany({
      where: { expiresAt: { lt: new Date(now) } },
    });
    return result.count;
  }
}

export class PgRateLimitStore implements RateLimitStoreLike {
  constructor(private readonly prisma: PrismaClient) {}

  async record(userId: string, snapshot: RateLimitSnapshot): Promise<void> {
    const data = {
      limitValue: snapshot.limit,
      remaining: snapshot.remaining,
      resetAt: snapshot.resetAt,
      cost: snapshot.cost,
      source: snapshot.source,
      recordedAt: BigInt(snapshot.recordedAt),
    };
    await this.prisma.rateLimitState.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  async get(userId: string): Promise<RateLimitSnapshot | null> {
    const row = await this.prisma.rateLimitState.findUnique({ where: { userId } });
    if (!row) {
      return null;
    }
    return {
      limit: row.limitValue,
      remaining: row.remaining,
      resetAt: row.resetAt,
      cost: row.cost,
      source: row.source === "graphql" ? "graphql" : "rest",
      recordedAt: Number(row.recordedAt),
    };
  }

  async delete(userId: string): Promise<void> {
    await this.prisma.rateLimitState.deleteMany({ where: { userId } });
  }

  async shouldDegrade(
    userId: string,
    threshold: number,
    now: number = Date.now(),
  ): Promise<DegradeDecision> {
    return decideDegrade(await this.get(userId), threshold, now);
  }
}

// 写操作审计的 Postgres 实现（M3-1）：与内存实现语义一致，供多实例 / Serverless 部署复用同一管线。
export class PgOperationAuditStore implements OperationAuditStoreLike {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: {
      now?: () => number;
      random?: () => number;
      retentionMs?: number;
      purgeProbability?: number;
    } = {},
  ) {}

  async find(idempotencyKey: string): Promise<OperationAuditRecord | null> {
    const row = await this.prisma.operationAudit.findFirst({
      where: { idempotencyKey },
      orderBy: { id: "desc" },
    });
    return row ? toAuditRecord(row) : null;
  }

  async append(record: OperationAuditRecord): Promise<void> {
    await this.prisma.operationAudit.create({
      data: {
        idempotencyKey: record.idempotencyKey,
        kind: record.kind,
        repo: record.repo,
        actor: record.actor,
        status: record.status,
        summary: record.summary,
        payload: record.payload as Prisma.InputJsonValue,
        result: record.result === null ? null : JSON.stringify(record.result),
        error: record.error,
        recordedAt: new Date(record.recordedAt),
      },
    });
    const random = this.options.random ?? Math.random;
    const probability = this.options.purgeProbability ?? AUDIT_PURGE_PROBABILITY;
    if (random() < probability) {
      await this.prune(this.retentionCutoff());
    }
  }

  async list(query: OperationAuditQuery = {}): Promise<OperationAuditRecord[]> {
    const rows = await this.prisma.operationAudit.findMany({
      where: auditWhere(query),
      orderBy: { id: "desc" },
      take: query.limit ?? DEFAULT_AUDIT_LIMIT,
      skip: query.offset ?? 0,
    });
    return rows.map(toAuditRecord);
  }

  /** 操作历史分页：预取原始记录后按幂等键收敛（见 latestOperationPage）。 */
  async listOperations(query: OperationAuditQuery = {}): Promise<OperationAuditRecord[]> {
    const limit = query.limit ?? DEFAULT_AUDIT_LIMIT;
    const offset = query.offset ?? 0;
    const rows = await this.list({ ...query, limit: operationScanLimit(limit, offset), offset: 0 });
    return latestOperationPage(rows, limit, offset);
  }

  /** 命中条件中最早一条的 recordedAt（频率限制据此算精确等待时间）。 */
  async oldestRecordedAt(query: OperationAuditQuery = {}): Promise<string | null> {
    const row = await this.prisma.operationAudit.findFirst({
      where: auditWhere(query),
      orderBy: { recordedAt: "asc" },
      select: { recordedAt: true },
    });
    return row ? row.recordedAt.toISOString() : null;
  }

  /** 统计命中条件的记录数（频率限制只关心窗口内的 started 记录）。 */
  async count(query: OperationAuditQuery = {}): Promise<number> {
    return this.prisma.operationAudit.count({ where: auditWhere(query) });
  }

  /** 删除某个操作人的全部审计记录（账号数据清除），返回删除条数。 */
  async deleteByActor(actor: string): Promise<number> {
    const result = await this.prisma.operationAudit.deleteMany({ where: { actor } });
    return result.count;
  }

  /** 删除 recordedAt < before 的记录，返回删除条数（保留期清理）。 */
  async prune(before: Date): Promise<number> {
    const result = await this.prisma.operationAudit.deleteMany({
      where: { recordedAt: { lt: before } },
    });
    return result.count;
  }

  private retentionCutoff(): Date {
    const now = this.options.now ?? Date.now;
    const retentionMs = this.options.retentionMs ?? getAuditRetentionMs();
    return new Date(now() - retentionMs);
  }
}

function auditWhere(query: OperationAuditQuery): Prisma.OperationAuditWhereInput {
  return {
    ...(query.repo ? { repo: query.repo } : {}),
    ...(query.actor ? { actor: query.actor } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.since ? { recordedAt: { gte: new Date(query.since) } } : {}),
  };
}

function toAuditRecord(row: OperationAudit): OperationAuditRecord {
  return {
    idempotencyKey: row.idempotencyKey,
    kind: row.kind as OperationAuditRecord["kind"],
    repo: row.repo,
    actor: row.actor,
    status: row.status as OperationAuditRecord["status"],
    summary: row.summary,
    payload: row.payload as unknown as Record<string, string>,
    result: row.result === null ? null : JSON.parse(row.result),
    error: row.error,
    recordedAt: row.recordedAt.toISOString(),
  };
}
