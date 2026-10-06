import { describe, expect, it } from "vitest";

import { TtlCache, cacheKey } from "./server-cache";

describe("TtlCache", () => {
  it("TTL 内为 fresh；过期后仍可读到旧值（fresh=false）", () => {
    let now = 1000;
    const cache = new TtlCache<string>({ ttlMs: 100, now: () => now });
    cache.set("k", "v");

    expect(cache.get("k")).toEqual({ value: "v", storedAt: 1000, fresh: true });
    now = 1099;
    expect(cache.get("k")?.fresh).toBe(true);
    now = 1100;
    const expired = cache.get("k");
    expect(expired?.fresh).toBe(false);
    expect(expired?.value).toBe("v");
  });

  it("超出容量按 LRU 淘汰（命中过的键保留）", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000, maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);

    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")?.value).toBe(1);
    expect(cache.get("c")?.value).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("delete / clear 生效", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");
    expect(cache.get("a")).toBeNull();
    cache.clear();
    expect(cache.get("b")).toBeNull();
    expect(cache.size).toBe(0);
  });
});

describe("cacheKey", () => {
  it("拼接稳定且不同组合不产生歧义", () => {
    expect(cacheKey("repos", "u1", 1)).toBe("repos\u0000u1\u00001");
    expect(cacheKey("a", null, "b")).toBe("a\u0000\u0000b");
    expect(cacheKey("a", "b")).not.toBe(cacheKey("a", null, "b"));
  });
});
