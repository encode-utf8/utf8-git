// Postgres 共享存储实现（M1-6）：多实例 / Serverless 部署下的跨实例 TTL 缓存与限流快照。
//
// 取舍：MVP 不引入 Redis，直接用已有的 Postgres 承担跨实例状态；
// 代价是缓存命中多 1 次数据库读、回源多 1 次写（详见 docs/deployment.md）。

import { Prisma, type PrismaClient } from "@prisma/client";

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
