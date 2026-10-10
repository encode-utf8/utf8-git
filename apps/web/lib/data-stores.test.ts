import { describe, expect, it } from "vitest";

import { getDataStores, invalidateUserCaches, userCachePrefixes } from "./data-stores";
import { TtlCache, cacheKey } from "./server-cache";

// 四类缓存的键形状与数据层一致（repos-data / timeline-data / commit-data 的 cacheKey 调用）
function fakeCaches() {
  return {
    reposCache: new TtlCache<unknown>({ ttlMs: 60_000 }),
    timelineCache: new TtlCache<unknown>({ ttlMs: 60_000 }),
    cursorCache: new TtlCache<unknown>({ ttlMs: 60_000 }),
    commitCache: new TtlCache<unknown>({ ttlMs: 60_000 }),
  };
}

describe("账号级缓存前缀", () => {
  it("按 cacheKey(scope, userId) + 字段分隔符拼装", () => {
    const prefixes = userCachePrefixes("u1");

    expect(prefixes.repos).toBe(`${cacheKey("repos", "u1")}\u001f`);
    expect(prefixes.timeline).toBe(`${cacheKey("timeline", "u1")}\u001f`);
    expect(prefixes.cursor).toBe(`${cacheKey("cursor", "u1")}\u001f`);
    expect(prefixes.commit).toBe(`${cacheKey("commit", "u1")}\u001f`);
  });
});

describe("invalidateUserCaches", () => {
  it("清掉该用户的四类缓存，保留其他用户与他人仓库的条目", async () => {
    const caches = fakeCaches();
    const mine = (scope: string, ...rest: Array<string | number>) => cacheKey(scope, "u1", ...rest);
    const other = cacheKey("timeline", "u2", "o", "n", "", 1);

    caches.reposCache.set(cacheKey("repos", "u1", 1), "repos");
    caches.timelineCache.set(mine("timeline", "o", "n", "", 1), "timeline");
    caches.cursorCache.set(mine("cursor", "o", "n", ""), "cursor");
    caches.commitCache.set(mine("commit", "o", "n", "abc"), "commit");
    caches.timelineCache.set(other, "other");
    // 前缀只匹配到字段边界：另一个用户 id 以相同字符开头也不能被误删
    caches.timelineCache.set(cacheKey("timeline", "u10", "o", "n", "", 1), "u10");

    await invalidateUserCaches("u1", caches);

    expect(caches.reposCache.get(cacheKey("repos", "u1", 1))).toBeNull();
    expect(caches.timelineCache.get(mine("timeline", "o", "n", "", 1))).toBeNull();
    expect(caches.cursorCache.get(mine("cursor", "o", "n", ""))).toBeNull();
    expect(caches.commitCache.get(mine("commit", "o", "n", "abc"))).toBeNull();
    expect(caches.timelineCache.get(other)?.value).toBe("other");
    expect(caches.timelineCache.get(cacheKey("timeline", "u10", "o", "n", "", 1))?.value).toBe(
      "u10",
    );
  });

  it("默认参数使用进程内的数据存储单例", async () => {
    delete process.env.STORE_BACKEND;
    await expect(invalidateUserCaches("u-nobody")).resolves.toBeUndefined();
    expect(getDataStores().backend).toBe("memory");
  });
});
