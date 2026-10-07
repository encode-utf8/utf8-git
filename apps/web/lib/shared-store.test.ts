import { describe, expect, it } from "vitest";

import type { RateLimitSnapshot } from "./rate-limit-store";
import { decideDegrade, isFresh, resolveStoreBackend } from "./shared-store";

describe("resolveStoreBackend", () => {
  it("默认 memory；postgres 才启用数据库后端；非法值回退 memory", () => {
    expect(resolveStoreBackend(undefined)).toBe("memory");
    expect(resolveStoreBackend("")).toBe("memory");
    expect(resolveStoreBackend(" POSTGRES ")).toBe("postgres");
    expect(resolveStoreBackend("redis")).toBe("memory");
  });
});

describe("isFresh", () => {
  it("按 TTL 判定新鲜度", () => {
    expect(isFresh(1_000, 500, 1_400)).toBe(true);
    expect(isFresh(1_000, 500, 1_500)).toBe(false);
  });
});

describe("decideDegrade", () => {
  function snapshot(overrides: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot {
    return {
      limit: 5_000,
      remaining: 50,
      resetAt: new Date(2_000_000),
      cost: 1,
      source: "graphql",
      recordedAt: 1_000,
      ...overrides,
    };
  }

  it("无快照不降级", () => {
    expect(decideDegrade(null, 100, 1_000)).toEqual({
      degrade: false,
      resetAt: null,
      snapshot: null,
    });
  });

  it("配额低于阈值且未到恢复时间 → 降级", () => {
    expect(decideDegrade(snapshot(), 100, 1_000).degrade).toBe(true);
  });

  it("配额充足不降级", () => {
    expect(decideDegrade(snapshot({ remaining: 4_000 }), 100, 1_000).degrade).toBe(false);
  });

  it("已过恢复时间 → 不降级（可尝试新请求）", () => {
    expect(decideDegrade(snapshot(), 100, 3_000_000).degrade).toBe(false);
  });
});
