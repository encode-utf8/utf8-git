// 客户端数据请求封装：瞬时错误指数退避重试 + 离线短路 + 统一错误呈现。
// 只对「断网 / 网络失败 / 超时 / 5xx」自动重试；4xx（尤其 401 / 403 / 429）不重试，避免浪费配额。

import {
  OnlineRequestError,
  describeApiFailure,
  describeFetchRejection,
  isRetryableKind,
  retryDelayMs,
  type OnlineErrorInfo,
} from "./error-state";

export type FetchWithRetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal | null;
  isOnline?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function defaultIsOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

async function readErrorPayload(
  response: Response,
): Promise<{ error?: unknown; resetAt?: unknown } | null> {
  try {
    const payload: unknown = await response.json();
    return typeof payload === "object" && payload !== null
      ? (payload as { error?: unknown; resetAt?: unknown })
      : null;
  } catch {
    return null;
  }
}

/**
 * 带重试的 GET 请求：成功返回 2xx 响应；
 * 否则抛出 OnlineRequestError（含用户文案、是否可重试与限流恢复时间）。
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    retries = 2,
    baseDelayMs = 400,
    signal = null,
    isOnline = defaultIsOnline,
    sleep = defaultSleep,
    fetchImpl = fetch,
    headers = {},
  } = options;

  let lastInfo: OnlineErrorInfo | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) {
      // 调用方主动取消（组件卸载 / 分支切换），按「超时」呈现即可
      throw new OnlineRequestError(describeFetchRejection({ name: "AbortError" }, true));
    }
    // 离线时直接短路：不发起必然失败的请求，也不做无意义重试
    if (!isOnline()) {
      throw new OnlineRequestError(describeFetchRejection(null, false));
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json", ...headers },
        signal: signal ?? undefined,
        cache: "no-store",
      });
    } catch (error) {
      const info = describeFetchRejection(error, isOnline());
      lastInfo = info;
      if (!isRetryableKind(info.kind) || attempt === retries) {
        throw new OnlineRequestError(info);
      }
      await sleep(retryDelayMs(attempt, baseDelayMs));
      continue;
    }

    if (response.ok) {
      return response;
    }

    const payload = await readErrorPayload(response);
    const info = describeApiFailure(response.status, payload);
    lastInfo = info;
    if (!isRetryableKind(info.kind) || attempt === retries) {
      throw new OnlineRequestError(info);
    }
    await sleep(retryDelayMs(attempt, baseDelayMs));
  }

  throw new OnlineRequestError(lastInfo ?? describeApiFailure(500, null));
}

export type JsonRequestOptions = FetchWithRetryOptions & {
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  body?: string;
  contentType?: string;
};

/**
 * 带重试的写请求（M3-8）：写操作在服务端是幂等的（同参数命中审计回放），
 * 所以「请求根本没拿到响应」的网络失败可以安全重试。
 * 与 GET 不同，这里只重试网络层失败：任何 HTTP 响应（含 4xx / 5xx）都原样返回，
 * 交给调用方按状态码展示文案（429 限流、422 冲突等），避免重试放大上游影响。
 */
export async function fetchJsonWithRetry(
  url: string,
  options: JsonRequestOptions = {},
): Promise<Response> {
  const {
    method = "POST",
    body,
    contentType = "application/json",
    retries = 2,
    baseDelayMs = 400,
    signal = null,
    isOnline = defaultIsOnline,
    sleep = defaultSleep,
    fetchImpl = fetch,
    headers = {},
  } = options;

  let lastInfo: OnlineErrorInfo | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) {
      throw new OnlineRequestError(describeFetchRejection({ name: "AbortError" }, true));
    }
    if (!isOnline()) {
      throw new OnlineRequestError(describeFetchRejection(null, false));
    }

    try {
      return await fetchImpl(url, {
        method,
        headers: { "content-type": contentType, Accept: "application/json", ...headers },
        body,
        signal: signal ?? undefined,
        cache: "no-store",
      });
    } catch (error) {
      const info = describeFetchRejection(error, isOnline());
      lastInfo = info;
      if (!isRetryableKind(info.kind) || attempt === retries) {
        throw new OnlineRequestError(info);
      }
      await sleep(retryDelayMs(attempt, baseDelayMs));
    }
  }

  throw new OnlineRequestError(lastInfo ?? describeApiFailure(500, null));
}
