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

  it("deleteByPrefix 只清掉匹配前缀的键（写操作后的时间线缓存失效）", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    const prefix = `${cacheKey("timeline", "u1", "o", "n")}\u001f`;
    cache.set(`${prefix}${cacheKey("", 1)}`, 1);
    cache.set(`${prefix}${cacheKey("main", 1)}`, 2);
    // 同用户 / 同仓库名不同仓库：前缀不匹配，不能被误删
    cache.set(`${cacheKey("timeline", "u1", "o", "n2", "", 1)}`, 3);
    // 其他缓存域：不能被误删
    cache.set(cacheKey("cursor", "u1", "o", "n", ""), 4);

    cache.deleteByPrefix(prefix);

    expect(cache.get(`${prefix}${cacheKey("", 1)}`)).toBeNull();
    expect(cache.get(`${prefix}${cacheKey("main", 1)}`)).toBeNull();
    expect(cache.get(cacheKey("timeline", "u1", "o", "n2", "", 1))?.value).toBe(3);
    expect(cache.get(cacheKey("cursor", "u1", "o", "n", ""))?.value).toBe(4);
  });
});

describe("cacheKey", () => {
  it("拼接稳定且不同组合不产生歧义", () => {
    expect(cacheKey("repos", "u1", 1)).toBe("repos\u001fu1\u001f1");
    expect(cacheKey("a", null, "b")).toBe("a\u001f\u001fb");
    expect(cacheKey("a", "b")).not.toBe(cacheKey("a", null, "b"));
  });
});
