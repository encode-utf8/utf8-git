// GitHub GraphQL v4 客户端（仅服务端调用）
// 特性：超时中止、瞬时错误重试（指数退避）、错误分类、rateLimit 读取、
// 部分失败（data + errors）容忍——局部数据优于整体白屏。

import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubGraphQLError,
  GitHubNetworkError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubTimeoutError,
  GitHubUnauthorizedError,
} from "./github-errors";
import { resolveGithubGraphqlEndpoint } from "./github-endpoints";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;

// 配额快照（响应中的 rateLimit 字段）
export type GitHubRateLimitInfo = {
  limit: number;
  cost: number;
  remaining: number;
  resetAt: Date | null;
};

export type GitHubGraphQLOptions = {
  token: string;
  query: string;
  variables?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
};

export type GitHubGraphQLResult<T> = {
  data: T;
  rateLimit: GitHubRateLimitInfo | null;
  // data + errors 场景下的非致命错误消息（部分数据可用）
  warnings: string[];
};

type RawGraphQLError = { message?: unknown; type?: unknown };
type RawGraphQLPayload<T> = {
  data?: T | null;
  errors?: RawGraphQLError[] | null;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

function readResetAtFromHeaders(response: Response): Date | null {
  const raw = response.headers.get("x-ratelimit-reset");
  if (!raw) {
    return null;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

// 从 data.rateLimit 提取配额快照（字段缺失时返回 null）
export function extractRateLimit(data: unknown): GitHubRateLimitInfo | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const raw = (data as { rateLimit?: unknown }).rateLimit;
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const limit = readNumber((raw as { limit?: unknown }).limit);
  const remaining = readNumber((raw as { remaining?: unknown }).remaining);
  if (limit === null || remaining === null) {
    return null;
  }
  const cost = readNumber((raw as { cost?: unknown }).cost);
  return {
    limit,
    cost: cost ?? 0,
    remaining,
    resetAt: readDate((raw as { resetAt?: unknown }).resetAt),
  };
}

// 仅瞬时错误可重试：超时 / 网络不可达 / 5xx
function isRetryable(error: unknown): boolean {
  if (error instanceof GitHubTimeoutError) {
    return true;
  }
  if (error instanceof GitHubApiError) {
    return error.status >= 500;
  }
  return false;
}

function errorMessages(errors: RawGraphQLError[]): string[] {
  return errors.map((item) =>
    typeof item.message === "string" && item.message.length > 0
      ? item.message
      : "未知 GraphQL 错误",
  );
}

function hasErrorType(errors: RawGraphQLError[], type: string): boolean {
  return errors.some((item) => item.type === type);
}

async function performRequest<T>(options: {
  token: string;
  query: string;
  variables: Record<string, unknown>;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<GitHubGraphQLResult<T>> {
  const { token, query, variables, fetchImpl, timeoutMs } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(resolveGithubGraphqlEndpoint(), {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "utf8-git",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
      // 令牌相关响应绝不进入 Next.js 数据缓存，避免跨用户复用
      cache: "no-store",
    });
  } catch {
    if (controller.signal.aborted) {
      throw new GitHubTimeoutError();
    }
    throw new GitHubNetworkError();
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    throw new GitHubUnauthorizedError();
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const retryAfter = response.headers.get("retry-after");
    if (response.status === 429 || remaining === "0" || retryAfter) {
      throw new GitHubRateLimitError("GitHub API 访问频率超限", readResetAtFromHeaders(response));
    }
    throw new GitHubForbiddenError();
  }
  if (response.status === 404) {
    throw new GitHubNotFoundError();
  }
  if (!response.ok) {
    throw new GitHubApiError(`GitHub GraphQL 返回错误（${response.status}）`, response.status);
  }

  let payload: RawGraphQLPayload<T>;
  try {
    payload = (await response.json()) as RawGraphQLPayload<T>;
  } catch {
    throw new GitHubApiError("GitHub GraphQL 响应解析失败", 502);
  }

  const rateLimit = extractRateLimit(payload.data);
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  if (errors.length > 0) {
    if (hasErrorType(errors, "RATE_LIMITED")) {
      throw new GitHubRateLimitError("GitHub API 访问频率超限", rateLimit?.resetAt ?? null);
    }
    if (hasErrorType(errors, "NOT_FOUND")) {
      throw new GitHubNotFoundError();
    }
  }

  const data = payload.data;
  if (data === null || data === undefined) {
    const messages = errorMessages(errors);
    throw new GitHubGraphQLError(messages[0] ?? "GitHub GraphQL 请求失败", messages);
  }

  return { data, rateLimit, warnings: errorMessages(errors) };
}

/**
 * 执行一次 GraphQL 查询；瞬时错误自动重试（默认最多 3 次尝试，指数退避）。
 * 抛出：GitHubUnauthorizedError / GitHubRateLimitError / GitHubForbiddenError /
 *       GitHubNotFoundError / GitHubGraphQLError / GitHubTimeoutError / GitHubApiError
 */
export async function githubGraphQL<T>(
  options: GitHubGraphQLOptions,
): Promise<GitHubGraphQLResult<T>> {
  const {
    token,
    query,
    variables = {},
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    sleepImpl = defaultSleep,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      await sleepImpl(retryBaseDelayMs * 2 ** (attempt - 1));
    }
    try {
      return await performRequest<T>({ token, query, variables, fetchImpl, timeoutMs });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}
