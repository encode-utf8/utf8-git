// 服务端 GitHub 请求统一封装：超时中止 + 网络错误归一化。
// 目的：让「无法连接 GitHub」「请求超时」与 HTTP 状态错误一样可被上层分类处理，
// 而不是以原始 TypeError / DOMException 冒泡成未分类的 500。

import { GitHubNetworkError, GitHubTimeoutError } from "./github-errors";

export const DEFAULT_GITHUB_TIMEOUT_MS = 15_000;

// Node undici 常见的网络类错误码
const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

// 中止类错误（超时 / 外部取消）：不应被当作网络失败
export function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

// 判断是否为网络不可达类异常（fetch 抛出的 TypeError / undici 错误码 / 其 cause 链）
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) {
    return true;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== error) {
    return isNetworkFailure(cause);
  }
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(
      message,
    )
  );
}

export type GithubFetchOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * 发起 GitHub 请求：默认 15s 超时。
 * - 超时（或上游 signal 中止）→ GitHubTimeoutError
 * - 网络不可达 → GitHubNetworkError
 * - 非 2xx 状态不在此处理，交由各客户端按状态分类
 */
export async function githubFetch(
  input: string | URL,
  init: RequestInit = {},
  options: GithubFetchOptions = {},
): Promise<Response> {
  const { fetchImpl = fetch, timeoutMs = DEFAULT_GITHUB_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const externalSignal = init.signal ?? null;
  const forwardAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  let timedOut = false;
  const timer =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new GitHubTimeoutError();
    }
    if (externalSignal?.aborted) {
      throw error;
    }
    if (isAbortError(error)) {
      throw new GitHubTimeoutError();
    }
    if (isNetworkFailure(error)) {
      throw new GitHubNetworkError();
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
}
