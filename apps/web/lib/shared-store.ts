// 共享存储抽象（M1-6）：让 TTL 缓存与限流快照既可用进程内内存实现（默认，单实例 / 本地开发），
// 也可用 Postgres 实现（多实例 / Serverless 部署，跨实例共享）。
//
// 约定：数据服务对存储的调用一律 await，因此同步实现与异步实现都能直接替换。

import type { DegradeDecision, RateLimitSnapshot } from "./rate-limit-store";
import type { CacheLookup } from "./server-cache";

export type MaybePromise<T> = T | Promise<T>;

/** 环境变量查询表：配置解析函数用它做入参，便于单测直接传入普通对象。 */
export type EnvLike = Record<string, string | undefined>;

export interface TtlCacheLike<V> {
  get(key: string): MaybePromise<CacheLookup<V> | null>;
  set(key: string, value: V): MaybePromise<void>;
  delete(key: string): MaybePromise<void>;
  /** 按前缀失效：写操作成功后清掉该仓库的分支列表 / PR 状态等派生缓存。 */
  deleteByPrefix(prefix: string): MaybePromise<void>;
}

export interface RateLimitStoreLike {
  record(userId: string, snapshot: RateLimitSnapshot): MaybePromise<void>;
  get(userId: string): MaybePromise<RateLimitSnapshot | null>;
  delete(userId: string): MaybePromise<void>;
  shouldDegrade(userId: string, threshold: number, now?: number): MaybePromise<DegradeDecision>;
}

export type StoreBackend = "memory" | "postgres";

// 存储后端选择：默认 memory；未知值回退 memory（避免配置笔误把请求打到数据库）
export function resolveStoreBackend(raw: string | undefined): StoreBackend {
  return raw?.trim().toLowerCase() === "postgres" ? "postgres" : "memory";
}

// 缓存条目是否新鲜（内存与 Postgres 实现共用）
export function isFresh(storedAt: number, ttlMs: number, now: number): boolean {
  return now - storedAt < ttlMs;
}

// 由限流快照推导降级决策（内存与 Postgres 实现共用）：
// 已过恢复时间视为可尝试新请求；配额低于阈值则降级为只读缓存。
export function decideDegrade(
  snapshot: RateLimitSnapshot | null,
  threshold: number,
  now: number,
): DegradeDecision {
  if (!snapshot) {
    return { degrade: false, resetAt: null, snapshot: null };
  }
  const resetAtMs = snapshot.resetAt?.getTime() ?? null;
  if (resetAtMs !== null && resetAtMs <= now) {
    return { degrade: false, resetAt: snapshot.resetAt, snapshot };
  }
  return { degrade: snapshot.remaining <= threshold, resetAt: snapshot.resetAt, snapshot };
}
