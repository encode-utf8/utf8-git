// 提交详情数据服务：30 min TTL 缓存 + 限流降级（策略与 repos-data / timeline-data 一致）。

import {
  getDataStores,
  getRateLimitThreshold,
  RATE_LIMIT_FALLBACK_MS,
  type CommitCacheValue,
} from "./data-stores";
import { fetchCommitDetail, type CommitDetail } from "./github-commits";
import { GitHubRateLimitError } from "./github-errors";
import { cacheKey, type CacheLookup } from "./server-cache";
import type { RateLimitStoreLike, TtlCacheLike } from "./shared-store";

export type CommitDetailMeta = {
  cached: boolean;
  stale: boolean;
  degraded: boolean;
  fetchedAt: string | null;
  resetAt: string | null;
};

export type CommitDetailPageResult = {
  commit: CommitDetail;
  meta: CommitDetailMeta;
};

export type CommitDataDeps = {
  fetchDetail?: typeof fetchCommitDetail;
  cache?: TtlCacheLike<CommitCacheValue>;
  rateLimitStore?: RateLimitStoreLike;
  threshold?: number;
  now?: () => number;
};

function buildMeta(params: {
  cached: boolean;
  stale: boolean;
  degraded: boolean;
  fetchedAt: number | null;
  resetAt: Date | null;
}): CommitDetailMeta {
  return {
    cached: params.cached,
    stale: params.stale,
    degraded: params.degraded,
    fetchedAt: params.fetchedAt === null ? null : new Date(params.fetchedAt).toISOString(),
    resetAt: params.resetAt?.toISOString() ?? null,
  };
}

function serveCached(
  cached: CacheLookup<CommitCacheValue>,
  resetAt: Date | null,
): CommitDetailPageResult {
  return {
    commit: cached.value.commit,
    meta: buildMeta({
      cached: true,
      stale: !cached.fresh,
      degraded: true,
      fetchedAt: cached.value.fetchedAt,
      resetAt,
    }),
  };
}

/**
 * 加载提交详情（30 min TTL 缓存 + 限流降级）。
 * 抛出：GitHubRateLimitError（无缓存可降级时）及 github-commits 的其余错误分类。
 */
export async function loadCommitDetail(
  params: { userId: string; token: string; owner: string; name: string; sha: string },
  deps: CommitDataDeps = {},
): Promise<CommitDetailPageResult> {
  const stores = getDataStores();
  const fetchDetail = deps.fetchDetail ?? fetchCommitDetail;
  const cache = deps.cache ?? stores.commitCache;
  const rateLimitStore = deps.rateLimitStore ?? stores.rateLimitStore;
  const threshold = deps.threshold ?? getRateLimitThreshold();
  const now = deps.now ?? Date.now;
  const key = cacheKey(
    "commit",
    params.userId,
    params.owner,
    params.name,
    params.sha.toLowerCase(),
  );

  // 存储调用一律 await：内存实现同步返回，Postgres 实现返回 Promise
  const cached = await cache.get(key);
  const gate = await rateLimitStore.shouldDegrade(params.userId, threshold, now());
  if (gate.degrade) {
    if (cached) {
      return serveCached(cached, gate.resetAt);
    }
    throw new GitHubRateLimitError(
      "GitHub API 配额不足，且暂无可用的缓存数据",
      gate.resetAt ?? new Date(now() + RATE_LIMIT_FALLBACK_MS),
    );
  }

  // 新鲜缓存直接命中，不再访问 GitHub
  if (cached?.fresh) {
    return {
      commit: cached.value.commit,
      meta: buildMeta({
        cached: true,
        stale: false,
        degraded: false,
        fetchedAt: cached.value.fetchedAt,
        resetAt: null,
      }),
    };
  }

  try {
    const result = await fetchDetail({
      token: params.token,
      owner: params.owner,
      name: params.name,
      sha: params.sha,
    });
    if (result.rateLimit) {
      await rateLimitStore.record(params.userId, {
        limit: result.rateLimit.limit,
        remaining: result.rateLimit.remaining,
        resetAt: result.rateLimit.resetAt,
        cost: null,
        source: "rest",
        recordedAt: now(),
      });
    }
    const fetchedAt = now();
    await cache.set(key, { commit: result.commit, fetchedAt });
    return {
      commit: result.commit,
      meta: buildMeta({
        cached: false,
        stale: false,
        degraded: false,
        fetchedAt,
        resetAt: null,
      }),
    };
  } catch (error) {
    if (error instanceof GitHubRateLimitError) {
      const resetAt = error.resetAt ?? new Date(now() + RATE_LIMIT_FALLBACK_MS);
      await rateLimitStore.record(params.userId, {
        limit: null,
        remaining: 0,
        resetAt,
        cost: null,
        source: "rest",
        recordedAt: now(),
      });
      if (cached) {
        return serveCached(cached, resetAt);
      }
      throw new GitHubRateLimitError(error.message, resetAt);
    }
    throw error;
  }
}
