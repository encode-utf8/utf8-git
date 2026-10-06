// 仓库列表数据服务：TTL 缓存（5 min）+ 限流降级（优先陈旧缓存，避免整体白屏）。

import {
  getDataStores,
  getRateLimitThreshold,
  RATE_LIMIT_FALLBACK_MS,
  type ReposCacheValue,
} from "./data-stores";
import { GitHubRateLimitError } from "./github-errors";
import { fetchViewerReposPage, type RepoPage } from "./github-repos";
import type { RateLimitStore } from "./rate-limit-store";
import { cacheKey, type CacheLookup, type TtlCache } from "./server-cache";

export type ReposPageMeta = {
  cached: boolean;
  stale: boolean;
  degraded: boolean;
  fetchedAt: string | null;
  resetAt: string | null;
};

export type ReposPageResult = {
  page: RepoPage;
  meta: ReposPageMeta;
};

export type ReposDataDeps = {
  fetchPage?: typeof fetchViewerReposPage;
  cache?: TtlCache<ReposCacheValue>;
  rateLimitStore?: RateLimitStore;
  threshold?: number;
  now?: () => number;
};

function serveCached(cached: CacheLookup<ReposCacheValue>, resetAt: Date | null): ReposPageResult {
  return {
    page: cached.value.page,
    meta: {
      cached: true,
      stale: !cached.fresh,
      degraded: true,
      fetchedAt: new Date(cached.value.fetchedAt).toISOString(),
      resetAt: resetAt?.toISOString() ?? null,
    },
  };
}

/**
 * 加载仓库列表页（5 min TTL 缓存 + 限流降级）。
 * 抛出：GitHubRateLimitError（无缓存可降级时）及 github-repos 的其余错误分类。
 */
export async function loadReposPage(
  params: { userId: string; token: string; page?: number },
  deps: ReposDataDeps = {},
): Promise<ReposPageResult> {
  const page = params.page ?? 1;
  const stores = getDataStores();
  const fetchPage = deps.fetchPage ?? fetchViewerReposPage;
  const cache = deps.cache ?? stores.reposCache;
  const rateLimitStore = deps.rateLimitStore ?? stores.rateLimitStore;
  const threshold = deps.threshold ?? getRateLimitThreshold();
  const now = deps.now ?? Date.now;
  const key = cacheKey("repos", params.userId, page);

  const cached = cache.get(key);
  const gate = rateLimitStore.shouldDegrade(params.userId, threshold, now());
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
      page: cached.value.page,
      meta: {
        cached: true,
        stale: false,
        degraded: false,
        fetchedAt: new Date(cached.value.fetchedAt).toISOString(),
        resetAt: null,
      },
    };
  }

  try {
    const result = await fetchPage({ token: params.token, page });
    if (result.rateLimit) {
      rateLimitStore.record(params.userId, {
        limit: result.rateLimit.limit,
        remaining: result.rateLimit.remaining,
        resetAt: result.rateLimit.resetAt,
        cost: null,
        source: "rest",
        recordedAt: now(),
      });
    }
    cache.set(key, { page: result, fetchedAt: now() });
    return {
      page: result,
      meta: {
        cached: false,
        stale: false,
        degraded: false,
        fetchedAt: new Date(now()).toISOString(),
        resetAt: null,
      },
    };
  } catch (error) {
    if (error instanceof GitHubRateLimitError) {
      const resetAt = error.resetAt ?? new Date(now() + RATE_LIMIT_FALLBACK_MS);
      rateLimitStore.record(params.userId, {
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
