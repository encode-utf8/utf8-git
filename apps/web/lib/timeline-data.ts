// 时间线数据服务：TTL 缓存（2 min）+ cursor 链分页 + 限流降级。

import {
  getDataStores,
  getRateLimitThreshold,
  RATE_LIMIT_FALLBACK_MS,
  type CursorChain,
  type TimelineCacheValue,
} from "./data-stores";
import { GitHubRateLimitError } from "./github-errors";
import { fetchTimelinePage, TIMELINE_PAGE_SIZE, type TimelineData } from "./github-timeline";
import type { RateLimitStore } from "./rate-limit-store";
import { cacheKey, type CacheLookup, type TtlCache } from "./server-cache";

// 深页请求但服务端 cursor 链缺失（过期 / 重启）时抛出；接口转为 409
export class TimelineCursorExpiredError extends Error {
  constructor(message = "分页游标已过期，请从第 1 页重新加载") {
    super(message);
    this.name = "TimelineCursorExpiredError";
  }
}

export type TimelinePageMeta = {
  page: number;
  pageSize: number;
  cached: boolean;
  stale: boolean;
  degraded: boolean;
  fetchedAt: string | null;
  resetAt: string | null;
  warnings: string[];
};

export type TimelinePageResult = {
  timeline: TimelineData;
  meta: TimelinePageMeta;
};

export type TimelineDataDeps = {
  fetchPage?: typeof fetchTimelinePage;
  cache?: TtlCache<TimelineCacheValue>;
  cursorCache?: TtlCache<CursorChain>;
  rateLimitStore?: RateLimitStore;
  threshold?: number;
  now?: () => number;
  graphql?: Parameters<typeof fetchTimelinePage>[0]["graphql"];
};

function buildMeta(params: {
  page: number;
  cached: boolean;
  stale: boolean;
  degraded: boolean;
  fetchedAt: number | null;
  resetAt: Date | null;
  warnings: string[];
}): TimelinePageMeta {
  return {
    page: params.page,
    pageSize: TIMELINE_PAGE_SIZE,
    cached: params.cached,
    stale: params.stale,
    degraded: params.degraded,
    fetchedAt: params.fetchedAt === null ? null : new Date(params.fetchedAt).toISOString(),
    resetAt: params.resetAt?.toISOString() ?? null,
    warnings: params.warnings,
  };
}

function serveCached(
  cached: CacheLookup<TimelineCacheValue>,
  page: number,
  resetAt: Date | null,
): TimelinePageResult {
  return {
    timeline: cached.value.timeline,
    meta: buildMeta({
      page,
      cached: true,
      stale: !cached.fresh,
      degraded: true,
      fetchedAt: cached.value.fetchedAt,
      resetAt,
      warnings: cached.value.warnings,
    }),
  };
}

/**
 * 加载时间线单页（2 min TTL 缓存 + cursor 链分页 + 限流降级）。
 * 抛出：TimelineCursorExpiredError / GitHubRateLimitError（无缓存可降级时）及 GraphQL 客户端错误。
 */
export async function loadTimelinePage(
  params: {
    userId: string;
    token: string;
    owner: string;
    name: string;
    branch?: string | null;
    page?: number;
  },
  deps: TimelineDataDeps = {},
): Promise<TimelinePageResult> {
  const page = params.page ?? 1;
  const branch = params.branch ?? null;
  const stores = getDataStores();
  const fetchPage = deps.fetchPage ?? fetchTimelinePage;
  const cache = deps.cache ?? stores.timelineCache;
  const cursorCache = deps.cursorCache ?? stores.cursorCache;
  const rateLimitStore = deps.rateLimitStore ?? stores.rateLimitStore;
  const threshold = deps.threshold ?? getRateLimitThreshold();
  const now = deps.now ?? Date.now;

  const key = cacheKey("timeline", params.userId, params.owner, params.name, branch ?? "", page);
  const cursorKey = cacheKey("cursor", params.userId, params.owner, params.name, branch ?? "");

  const cached = cache.get(key);
  const gate = rateLimitStore.shouldDegrade(params.userId, threshold, now());
  if (gate.degrade) {
    if (cached) {
      return serveCached(cached, page, gate.resetAt);
    }
    throw new GitHubRateLimitError(
      "GitHub API 配额不足，且暂无可用的缓存数据",
      gate.resetAt ?? new Date(now() + RATE_LIMIT_FALLBACK_MS),
    );
  }

  // 新鲜缓存直接命中，不再访问 GitHub
  if (cached?.fresh) {
    return {
      timeline: cached.value.timeline,
      meta: buildMeta({
        page,
        cached: true,
        stale: false,
        degraded: false,
        fetchedAt: cached.value.fetchedAt,
        resetAt: null,
        warnings: cached.value.warnings,
      }),
    };
  }

  // 深页依赖上一页 endCursor；链缺失时让客户端回到第 1 页
  let cursor: string | null = null;
  if (page > 1) {
    const pages = cursorCache.get(cursorKey)?.value.pages ?? [];
    const previous = pages[page - 2];
    if (!previous) {
      throw new TimelineCursorExpiredError();
    }
    cursor = previous.endCursor;
  }

  try {
    const result = await fetchPage({
      token: params.token,
      owner: params.owner,
      name: params.name,
      branch,
      cursor,
      graphql: deps.graphql,
    });
    if (result.rateLimit) {
      rateLimitStore.record(params.userId, {
        limit: result.rateLimit.limit,
        remaining: result.rateLimit.remaining,
        resetAt: result.rateLimit.resetAt,
        cost: result.rateLimit.cost,
        source: "graphql",
        recordedAt: now(),
      });
    }
    const fetchedAt = now();
    cache.set(key, { timeline: result.data, warnings: result.warnings, fetchedAt });

    const pages = (cursorCache.get(cursorKey)?.value.pages ?? []).slice(0, Math.max(0, page - 1));
    pages[page - 1] = { endCursor: result.data.pageInfo.endCursor, fetchedAt };
    cursorCache.set(cursorKey, { pages });

    return {
      timeline: result.data,
      meta: buildMeta({
        page,
        cached: false,
        stale: false,
        degraded: false,
        fetchedAt,
        resetAt: null,
        warnings: result.warnings,
      }),
    };
  } catch (error) {
    if (error instanceof GitHubRateLimitError) {
      const resetAt = error.resetAt ?? new Date(now() + RATE_LIMIT_FALLBACK_MS);
      rateLimitStore.record(params.userId, {
        limit: null,
        remaining: 0,
        resetAt,
        cost: null,
        source: "graphql",
        recordedAt: now(),
      });
      if (cached) {
        return serveCached(cached, page, resetAt);
      }
      throw new GitHubRateLimitError(error.message, resetAt);
    }
    throw error;
  }
}
