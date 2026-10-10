// 数据层单例：缓存 / 限流快照在 dev 热重载之间保持稳定（沿用 prisma.ts 的 globalThis 模式）。
// M1-6：后端可选——默认 memory（单实例 / 本地开发）；STORE_BACKEND=postgres 时走数据库，
// 让缓存与限流快照在多实例 / Serverless 部署下跨实例共享。

import type { CommitDetail } from "./github-commits";
import type { RepoPage } from "./github-repos";
import type { TimelineData } from "./github-timeline";
import { MemoryOperationAuditStore, type OperationAuditStoreLike } from "./operation-audit";
import { PgOperationAuditStore, PgRateLimitStore, PgTtlCache } from "./pg-stores";
import { getPrismaClient } from "./prisma";
import { RateLimitStore } from "./rate-limit-store";
import { TtlCache, cacheKey } from "./server-cache";
import {
  resolveStoreBackend,
  type RateLimitStoreLike,
  type StoreBackend,
  type TtlCacheLike,
} from "./shared-store";

// 技术分析 §6.2：仓库列表 5 min、时间线首页 2 min
export const REPOS_CACHE_TTL_MS = 5 * 60 * 1000;
export const TIMELINE_CACHE_TTL_MS = 2 * 60 * 1000;
export const CURSOR_CHAIN_TTL_MS = 30 * 60 * 1000;
// 技术分析 §6.2：节点详情 30 min
export const COMMIT_DETAIL_CACHE_TTL_MS = 30 * 60 * 1000;

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

export type CommitCacheValue = {
  commit: CommitDetail;
  fetchedAt: number;
};

// 分页 cursor 链：pages[i] 为第 i+1 页的 endCursor
export type CursorChain = {
  pages: Array<{ endCursor: string | null; fetchedAt: number }>;
};

type DataStores = {
  backend: StoreBackend;
  reposCache: TtlCacheLike<ReposCacheValue>;
  timelineCache: TtlCacheLike<TimelineCacheValue>;
  cursorCache: TtlCacheLike<CursorChain>;
  commitCache: TtlCacheLike<CommitCacheValue>;
  rateLimitStore: RateLimitStoreLike;
  operationAudit: OperationAuditStoreLike;
};

const globalForData = globalThis as unknown as { __utf8gitDataStores?: DataStores };

// 内存后端：单实例 / 本地开发默认；带 LRU 上限
function createMemoryStores(): DataStores {
  return {
    backend: "memory",
    reposCache: new TtlCache<ReposCacheValue>({ ttlMs: REPOS_CACHE_TTL_MS }),
    timelineCache: new TtlCache<TimelineCacheValue>({ ttlMs: TIMELINE_CACHE_TTL_MS }),
    cursorCache: new TtlCache<CursorChain>({ ttlMs: CURSOR_CHAIN_TTL_MS, maxEntries: 200 }),
    commitCache: new TtlCache<CommitCacheValue>({ ttlMs: COMMIT_DETAIL_CACHE_TTL_MS }),
    rateLimitStore: new RateLimitStore(),
    operationAudit: new MemoryOperationAuditStore(),
  };
}

// Postgres 后端：多实例 / Serverless 部署，缓存与限流快照跨实例共享
function createPostgresStores(): DataStores {
  const prisma = getPrismaClient();
  return {
    backend: "postgres",
    reposCache: new PgTtlCache<ReposCacheValue>(prisma, "repos", REPOS_CACHE_TTL_MS),
    timelineCache: new PgTtlCache<TimelineCacheValue>(prisma, "timeline", TIMELINE_CACHE_TTL_MS),
    cursorCache: new PgTtlCache<CursorChain>(prisma, "cursor", CURSOR_CHAIN_TTL_MS),
    commitCache: new PgTtlCache<CommitCacheValue>(prisma, "commit", COMMIT_DETAIL_CACHE_TTL_MS),
    rateLimitStore: new PgRateLimitStore(prisma),
    operationAudit: new PgOperationAuditStore(prisma),
  };
}

function createDataStores(backend: StoreBackend): DataStores {
  return backend === "postgres" ? createPostgresStores() : createMemoryStores();
}

export function getDataStores(): DataStores {
  const backend = resolveStoreBackend(process.env.STORE_BACKEND);
  // dev 热重载可能残留旧版本单例（缺少新的缓存字段或后端与配置不一致），此时整体重建
  const existing = globalForData.__utf8gitDataStores as Partial<DataStores> | undefined;
  if (!existing?.commitCache || !existing?.operationAudit || existing.backend !== backend) {
    const stores = createDataStores(backend);
    globalForData.__utf8gitDataStores = stores;
    return stores;
  }
  return existing as DataStores;
}

// 读取降级阈值（环境变量可调；无效时回退默认值）
export function getRateLimitThreshold(): number {
  const raw = Number(process.env.GITHUB_RATE_LIMIT_DEGRADE_THRESHOLD);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RATE_LIMIT_THRESHOLD;
}

/**
 * 账号级缓存前缀：四类缓存键都以 `userId` 作为第 2 段（见 repos-data / timeline-data /
 * commit-data 的 cacheKey 调用），因此「清除数据 / 撤销授权」按用户整体失效时，
 * 用 `cacheKey(scope, userId)` + 字段分隔符作为前缀即可一次清干净。
 */
export function userCachePrefixes(userId: string): {
  repos: string;
  timeline: string;
  cursor: string;
  commit: string;
} {
  const separator = "\u001f";
  return {
    repos: `${cacheKey("repos", userId)}${separator}`,
    timeline: `${cacheKey("timeline", userId)}${separator}`,
    cursor: `${cacheKey("cursor", userId)}${separator}`,
    commit: `${cacheKey("commit", userId)}${separator}`,
  };
}

/** 需要按用户整体失效的那几类缓存（结构与 DataStores 对应，便于单测注入）。 */
export type UserCaches = {
  reposCache: TtlCacheLike<unknown>;
  timelineCache: TtlCacheLike<unknown>;
  cursorCache: TtlCacheLike<unknown>;
  commitCache: TtlCacheLike<unknown>;
};

/**
 * 失效某个用户的全部缓存（M3-9）：撤销授权 / 清除数据后，这些条目既没有令牌可用、
 * 也不应继续留在应用内（限流降级时会读旧值展示），必须整体清掉。
 */
export async function invalidateUserCaches(
  userId: string,
  caches: UserCaches = getDataStores(),
): Promise<void> {
  const prefixes = userCachePrefixes(userId);
  await Promise.all([
    caches.reposCache.deleteByPrefix(prefixes.repos),
    caches.timelineCache.deleteByPrefix(prefixes.timeline),
    caches.cursorCache.deleteByPrefix(prefixes.cursor),
    caches.commitCache.deleteByPrefix(prefixes.commit),
  ]);
}

/**
 * 写操作成功后失效该用户在此仓库的时间线缓存（含分支列表 / PR 状态等派生数据）。
 * 不失效时，写操作后的 router.refresh() 会命中旧缓存——M3-6 发现「新建分支后选择器不更新」
 * 就是这个原因。只失效时间线缓存、不动游标分页链：提交本身没有变化，游标链仍然有效。
 */
export async function invalidateTimelineCache(params: {
  userId: string;
  owner: string;
  name: string;
}): Promise<void> {
  const prefix = `${cacheKey("timeline", params.userId, params.owner, params.name)}\u001f`;
  await getDataStores().timelineCache.deleteByPrefix(prefix);
}
