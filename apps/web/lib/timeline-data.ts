// 时间线数据服务：TTL 缓存（2 min）+ cursor 链分页 + 限流降级。

import type { LaneLayout } from "@utf8-git/git-graph";

import {
  getDataStores,
  getRateLimitThreshold,
  RATE_LIMIT_FALLBACK_MS,
  type CursorChain,
  type TimelineCacheValue,
} from "./data-stores";
import { GitHubRateLimitError } from "./github-errors";
import { fetchTimelinePage, TIMELINE_PAGE_SIZE, type TimelineData } from "./github-timeline";
import { computeCachedLaneLayout } from "./lane-layout";
import { cacheKey, type CacheLookup } from "./server-cache";
import type { RateLimitStoreLike, TtlCacheLike } from "./shared-store";

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
  /** 本次响应附带的泳道布局是否命中服务端缓存（TODO-246 观测用）。 */
  laneLayoutCached: boolean;
};

export type TimelinePageResult = {
  timeline: TimelineData;
  meta: TimelinePageMeta;
  /**
   * 首页附带的泳道布局（TODO-246）：服务端按提交集合内容指纹算好并缓存，
   * 客户端挂载 / 切换分支时直接用它，免去本地全量重算。
   * 深页（page > 1）为 null——客户端对已加载集合做增量续算，不需要服务端布局。
   */
  laneLayout: LaneLayout | null;
};

export type TimelineDataDeps = {
  fetchPage?: typeof fetchTimelinePage;
  cache?: TtlCacheLike<TimelineCacheValue>;
  cursorCache?: TtlCacheLike<CursorChain>;
  rateLimitStore?: RateLimitStoreLike;
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
  laneLayoutCached?: boolean;
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
    laneLayoutCached: params.laneLayoutCached ?? false,
  };
}

/** 提交记录 → 泳道布局输入（oid + parents 即布局所需的全部信息）。 */
function toLaneInput(timeline: TimelineData): Array<{ oid: string; parents: string[] }> {
  return timeline.commits.map((commit) => ({ oid: commit.oid, parents: commit.parents }));
}

/**
 * 为首页响应附带服务端泳道布局（TODO-246）。
 *
 * - 只对 page 1 计算：客户端挂载与「切换分支」都落在第 1 页，直接消费该布局，
 *   省掉本地一次全量 computeLaneLayout；
 * - 深页返回 null：客户端对已加载集合做增量续算（LaneComputation.push），
 *   服务端布局对不上累积集合，传了反而是浪费；
 * - 布局按内容指纹走内存 LRU 缓存（lib/lane-layout.ts），命中时近乎零成本。
 */
function withLaneLayout(
  result: { timeline: TimelineData; meta: TimelinePageMeta },
  page: number,
): TimelinePageResult {
  if (page !== 1) {
    return { ...result, laneLayout: null };
  }
  const { layout, cached } = computeCachedLaneLayout(toLaneInput(result.timeline));
  return {
    ...result,
    laneLayout: layout,
    meta: { ...result.meta, laneLayoutCached: cached },
  };
}

function serveCached(
  cached: CacheLookup<TimelineCacheValue>,
  page: number,
  resetAt: Date | null,
): TimelinePageResult {
  return withLaneLayout(
    {
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
    },
    page,
  );
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

  // 存储调用一律 await：内存实现同步返回，Postgres 实现返回 Promise
  const cached = await cache.get(key);
  const gate = await rateLimitStore.shouldDegrade(params.userId, threshold, now());
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
    return withLaneLayout(
      {
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
      },
      page,
    );
  }

  // 深页依赖上一页 endCursor；链缺失时让客户端回到第 1 页
  let cursor: string | null = null;
  if (page > 1) {
    const pages = (await cursorCache.get(cursorKey))?.value.pages ?? [];
    const previous = pages[page - 2];
    if (!previous) {
      throw new TimelineCursorExpiredError();
    }
    // 上一页已无更多数据（endCursor 为 null）→ 后续页必然为空。
    // 不能继续用 null 游标请求：GitHub 会忽略 after 并重新返回第 1 页，导致重复提交（M1-7 验证发现）。
    if (previous.endCursor === null) {
      const previousKey = cacheKey(
        "timeline",
        params.userId,
        params.owner,
        params.name,
        branch ?? "",
        page - 1,
      );
      const previousPage = await cache.get(previousKey);
      if (!previousPage) {
        // 来不及读到上一页数据（缓存已过期）→ 让客户端回到第 1 页重建游标链
        throw new TimelineCursorExpiredError();
      }
      return withLaneLayout(
        {
          timeline: {
            ...previousPage.value.timeline,
            commits: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
          meta: buildMeta({
            page,
            cached: false,
            stale: false,
            degraded: false,
            fetchedAt: now(),
            resetAt: null,
            warnings: [],
          }),
        },
        page,
      );
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
      await rateLimitStore.record(params.userId, {
        limit: result.rateLimit.limit,
        remaining: result.rateLimit.remaining,
        resetAt: result.rateLimit.resetAt,
        cost: result.rateLimit.cost,
        source: "graphql",
        recordedAt: now(),
      });
    }
    const fetchedAt = now();
    await cache.set(key, { timeline: result.data, warnings: result.warnings, fetchedAt });

    const pages = ((await cursorCache.get(cursorKey))?.value.pages ?? []).slice(
      0,
      Math.max(0, page - 1),
    );
    pages[page - 1] = { endCursor: result.data.pageInfo.endCursor, fetchedAt };
    await cursorCache.set(cursorKey, { pages });

    return withLaneLayout(
      {
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
      },
      page,
    );
  } catch (error) {
    if (error instanceof GitHubRateLimitError) {
      const resetAt = error.resetAt ?? new Date(now() + RATE_LIMIT_FALLBACK_MS);
      await rateLimitStore.record(params.userId, {
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
