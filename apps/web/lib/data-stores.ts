// 数据层单例：缓存 / 限流快照在 dev 热重载之间保持稳定（沿用 prisma.ts 的 globalThis 模式）。
// 说明：内存缓存仅在单实例内有效；多实例 / Serverless 部署需外部缓存（后续评估项）。

import type { RepoPage } from "./github-repos";
import type { TimelineData } from "./github-timeline";
import { RateLimitStore } from "./rate-limit-store";
import { TtlCache } from "./server-cache";

// 技术分析 §6.2：仓库列表 5 min、时间线首页 2 min
export const REPOS_CACHE_TTL_MS = 5 * 60 * 1000;
export const TIMELINE_CACHE_TTL_MS = 2 * 60 * 1000;
export const CURSOR_CHAIN_TTL_MS = 30 * 60 * 1000;

// 配额低于该值时进入降级（可用 GITHUB_RATE_LIMIT_DEGRADE_THRESHOLD 调整）
export const DEFAULT_RATE_LIMIT_THRESHOLD = 100;

// 限流响应未给出恢复时间时的保守回退（GitHub 配额窗口为 1 小时）
export const RATE_LIMIT_FALLBACK_MS = 60 * 60 * 1000;

export type ReposCacheValue = {
  page: RepoPage;
  fetchedAt: number;
};

export type TimelineCacheValue = {
  timeline: TimelineData;
  warnings: string[];
  fetchedAt: number;
};

// 分页 cursor 链：pages[i] 为第 i+1 页的 endCursor
export type CursorChain = {
  pages: Array<{ endCursor: string | null; fetchedAt: number }>;
};

type DataStores = {
  reposCache: TtlCache<ReposCacheValue>;
  timelineCache: TtlCache<TimelineCacheValue>;
  cursorCache: TtlCache<CursorChain>;
  rateLimitStore: RateLimitStore;
};

const globalForData = globalThis as unknown as { __utf8gitDataStores?: DataStores };

export function getDataStores(): DataStores {
  globalForData.__utf8gitDataStores ??= {
    reposCache: new TtlCache<ReposCacheValue>({ ttlMs: REPOS_CACHE_TTL_MS }),
    timelineCache: new TtlCache<TimelineCacheValue>({ ttlMs: TIMELINE_CACHE_TTL_MS }),
    cursorCache: new TtlCache<CursorChain>({ ttlMs: CURSOR_CHAIN_TTL_MS, maxEntries: 200 }),
    rateLimitStore: new RateLimitStore(),
  };
  return globalForData.__utf8gitDataStores;
}

// 读取降级阈值（环境变量可调；无效时回退默认值）
export function getRateLimitThreshold(): number {
  const raw = Number(process.env.GITHUB_RATE_LIMIT_DEGRADE_THRESHOLD);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RATE_LIMIT_THRESHOLD;
}
