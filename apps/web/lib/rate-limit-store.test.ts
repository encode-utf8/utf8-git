import { describe, expect, it } from "vitest";

import { RateLimitStore, type RateLimitSnapshot } from "./rate-limit-store";

function snapshot(overrides: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot {
  return {
    limit: 5000,
    remaining: 4999,
    resetAt: new Date(2_000_000),
    cost: 1,
    source: "graphql",
    recordedAt: 1_000_000,
    ...overrides,
  };
}

describe("RateLimitStore", () => {
  it("无快照时不降级", () => {
    const store = new RateLimitStore();
    expect(store.shouldDegrade("u1", 100, 1_000_000).degrade).toBe(false);
  });

  it("剩余量低于阈值 → 降级并带恢复时间", () => {
    const store = new RateLimitStore();
    store.record("u1", snapshot({ remaining: 20 }));
    const decision = store.shouldDegrade("u1", 100, 1_000_000);
    expect(decision.degrade).toBe(true);
    expect(decision.resetAt).toEqual(new Date(2_000_000));
  });

  it("剩余量高于阈值 → 不降级", () => {
    const store = new RateLimitStore();
    store.record("u1", snapshot({ remaining: 500 }));
    expect(store.shouldDegrade("u1", 100, 1_000_000).degrade).toBe(false);
  });

  it("已过恢复时间 → 视为配额已重置，不降级", () => {
    const store = new RateLimitStore();
    store.record("u1", snapshot({ remaining: 0, resetAt: new Date(900_000) }));
    expect(store.shouldDegrade("u1", 100, 1_000_000).degrade).toBe(false);
  });

  it("快照按用户隔离，delete 生效", () => {
    const store = new RateLimitStore();
    store.record("u1", snapshot({ remaining: 0 }));
    expect(store.shouldDegrade("u2", 100, 1_000_000).degrade).toBe(false);
    store.delete("u1");
    expect(store.get("u1")).toBeNull();
  });
});
