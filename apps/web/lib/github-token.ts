// GitHub OAuth 令牌续期客户端（仅服务端调用）
// 背景：GitHub 开启「令牌过期」策略后，access token 有效期 8 小时；
// 使用入库的 refresh token（6 个月）调用令牌端点换取新令牌，refresh token 会轮换。

import {
  GitHubApiError,
  GitHubNetworkError,
  GitHubTimeoutError,
  GitHubUnauthorizedError,
} from "./github-errors";
import { resolveGithubTokenEndpoint } from "./github-endpoints";
const DEFAULT_TIMEOUT_MS = 8000;

export type RefreshedGitHubToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null; // unix 秒
  tokenType: string | null;
  scope: string | null;
};

type RawTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// 归一化令牌端点响应：expires_in（秒）→ 绝对过期时间（unix 秒）
export function normalizeTokenResponse(raw: unknown, nowMs: number): RefreshedGitHubToken | null {
  const data = (raw ?? {}) as RawTokenResponse;
  const accessToken = readString(data.access_token);
  if (!accessToken) {
    return null;
  }
  const expiresIn = readNumber(data.expires_in);
  return {
    accessToken,
    refreshToken: readString(data.refresh_token),
    expiresAt: expiresIn === null ? null : Math.floor(nowMs / 1000) + expiresIn,
    tokenType: readString(data.token_type),
    scope: readString(data.scope),
  };
}

export type RefreshGitHubTokenParams = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

// 用 refresh token 换取新令牌；错误分类与数据层一致：
// - 被拒绝（error 字段 / 400 / 401 / 403）→ GitHubUnauthorizedError（需重新授权）
// - 超时 → GitHubTimeoutError；网络不可达 → GitHubNetworkError；5xx → GitHubApiError（均可重试）
export async function refreshGitHubToken(
  params: RefreshGitHubTokenParams,
): Promise<RefreshedGitHubToken> {
  const {
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = Date.now,
  } = params;

  let response: Response;
  try {
    response = await fetchImpl(resolveGithubTokenEndpoint(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "utf8-git",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new GitHubTimeoutError("GitHub 令牌续期超时");
    }
    throw new GitHubNetworkError("无法连接 GitHub 令牌端点");
  }

  const payload: unknown = await response.json().catch(() => null);
  const data = (payload ?? {}) as RawTokenResponse;
  // 失效的 refresh token 也常以 200 + error 字段返回
  if (readString(data.error)) {
    throw new GitHubUnauthorizedError("GitHub 令牌续期被拒绝，请重新授权");
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new GitHubUnauthorizedError("GitHub 令牌续期被拒绝，请重新授权");
  }
  if (!response.ok) {
    throw new GitHubApiError(`GitHub 令牌端点返回异常（${response.status}）`, 502);
  }

  const normalized = normalizeTokenResponse(payload, now());
  if (!normalized) {
    throw new GitHubApiError("GitHub 令牌端点响应缺少 access_token", 502);
  }
  return normalized;
}
