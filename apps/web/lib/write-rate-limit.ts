// M3-8 写操作频率限制（TODO-231）：按用户统计滑动窗口内的写操作尝试次数，超限直接拒绝，
// 不再把请求打到 GitHub。
//
// 计数复用写操作审计表（每次尝试都先写一条 started 记录），因此不需要新建表 / 迁移；
// 多实例 / Serverless 部署下与审计同源，不会出现各实例判定不一致的问题。

import type { EnvLike } from "./shared-store";

export const DEFAULT_WRITE_LIMIT = 20;
export const DEFAULT_WRITE_WINDOW_MS = 60 * 1000;
// 被拒时的最小等待时间：避免时钟抖动导致 Retry-After 算成 0 秒
export const MIN_RETRY_AFTER_MS = 1000;

export type WriteRateLimitConfig = {
  /** 窗口内允许的写操作次数上限。 */
  limit: number;
  /** 滑动窗口长度（毫秒）。 */
  windowMs: number;
};

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 频率限制配置：`WRITE_OPERATION_LIMIT` / `WRITE_OPERATION_WINDOW_MS`，非法值回退默认。 */
export function getWriteRateLimitConfig(env: EnvLike = process.env): WriteRateLimitConfig {
  return {
    limit: Math.floor(positiveNumber(env.WRITE_OPERATION_LIMIT, DEFAULT_WRITE_LIMIT)),
    windowMs: Math.floor(positiveNumber(env.WRITE_OPERATION_WINDOW_MS, DEFAULT_WRITE_WINDOW_MS)),
  };
}

/** 滑动窗口起点：只统计该时刻之后的尝试。 */
export function rateLimitWindowStart(now: Date, windowMs: number): Date {
  return new Date(now.getTime() - windowMs);
}

export type WriteRateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  windowMs: number;
  /** 被拒时建议的重试等待时间（毫秒）。 */
  retryAfterMs: number;
};

/**
 * 是否放行：窗口内尝试次数达到上限即拒绝。
 * 计数不区分操作类型，所有写操作共享同一份额度——这正是要防的连点 / 脚本刷写。
 *
 * 被拒时按「最早那条记录何时滑出窗口」计算等待时间：`oldestRecordedAt` 缺省或无法解析时
 * 回退为整个窗口长度（保守值）。
 */
export function decideWriteRateLimit(params: {
  recent: number;
  limit: number;
  windowMs: number;
  now?: number;
  oldestRecordedAt?: string | null;
}): WriteRateLimitDecision {
  const allowed = params.recent < params.limit;
  return {
    allowed,
    limit: params.limit,
    remaining: Math.max(0, params.limit - params.recent),
    windowMs: params.windowMs,
    retryAfterMs: allowed ? 0 : retryAfterMs(params),
  };
}

function retryAfterMs(params: {
  windowMs: number;
  now?: number;
  oldestRecordedAt?: string | null;
}): number {
  const oldest = params.oldestRecordedAt ? Date.parse(params.oldestRecordedAt) : Number.NaN;
  if (!Number.isFinite(oldest)) {
    return params.windowMs;
  }
  const elapsed = (params.now ?? Date.now()) - oldest;
  return Math.min(params.windowMs, Math.max(MIN_RETRY_AFTER_MS, params.windowMs - elapsed));
}
