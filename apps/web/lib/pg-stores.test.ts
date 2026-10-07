import { describe, expect, it } from "vitest";

// 需要本地 PostgreSQL 与 apps/web/.env：
//   $env:DATABASE_URL="..." ; $env:RUN_DB_TESTS=1 ; pnpm --filter @utf8-git/web test
// 迁移需先应用：pnpm --filter @utf8-git/web exec prisma migrate deploy
const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!runDbTests)("Postgres 共享存储（数据库用例）", () => {
  it("一个实例写入的 TTL 缓存可被另一个实例读到；过期条目可清理", async () => {
    const { PgTtlCache } = await import("./pg-stores");
    const { getPrismaClient } = await import("./prisma");

    const prisma = getPrismaClient();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const key = `test-shared-cache-${suffix}`;

    // 两个 store 实例共用同一张表，模拟多实例部署
    const instanceA = new PgTtlCache<{ n: number }>(prisma, "test", 60_000);
    const instanceB = new PgTtlCache<{ n: number }>(prisma, "test", 60_000);

    try {
      await instanceA.set(key, { n: 42 });

      const hit = await instanceB.get(key);
      expect(hit?.value).toEqual({ n: 42 });
      expect(hit?.fresh).toBe(true);

      // TTL 为 0 的实例读到同一份数据但判定为不新鲜（可用于降级展示）
      const staleView = new PgTtlCache<{ n: number }>(prisma, "test", 0);
      expect((await staleView.get(key))?.fresh).toBe(false);

      // 过期清理：把「现在」推到 TTL 之后
      const purged = await instanceA.purgeExpired(Date.now() + 120_000);
      expect(purged).toBeGreaterThanOrEqual(1);
      expect(await instanceB.get(key)).toBeNull();
    } finally {
      await prisma.sharedCacheEntry.deleteMany({ where: { key } });
    }
  });

  it("限流快照跨实例共享，并能推导降级决策", async () => {
    const { PgRateLimitStore } = await import("./pg-stores");
    const { getPrismaClient } = await import("./prisma");

    const prisma = getPrismaClient();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const userId = `test-ratelimit-${suffix}`;
    const instanceA = new PgRateLimitStore(prisma);
    const instanceB = new PgRateLimitStore(prisma);

    try {
      await instanceA.record(userId, {
        limit: 5_000,
        remaining: 10,
        resetAt: new Date(Date.now() + 3_600_000),
        cost: 1,
        source: "graphql",
        recordedAt: Date.now(),
      });

      const shared = await instanceB.get(userId);
      expect(shared?.remaining).toBe(10);
      expect(shared?.source).toBe("graphql");
      expect((await instanceB.shouldDegrade(userId, 100)).degrade).toBe(true);

      // 恢复时间已过 → 允许尝试新请求（不降级）
      await instanceA.record(userId, {
        limit: 5_000,
        remaining: 10,
        resetAt: new Date(Date.now() - 1_000),
        cost: 1,
        source: "rest",
        recordedAt: Date.now(),
      });
      expect((await instanceB.shouldDegrade(userId, 100)).degrade).toBe(false);
    } finally {
      await prisma.rateLimitState.deleteMany({ where: { userId } });
    }
  });
});
