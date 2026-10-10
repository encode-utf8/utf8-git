// GitHub OAuth App 授权撤销客户端（REST，仅服务端调用）。
//
// GitHub 文档：`DELETE /applications/{client_id}/token` 用 client_id + client_secret 做
// Basic 认证撤销单个令牌，成功返回 204。凭据必须来自平台内置的 OAuth App，
// 因此这里不接受用户自备参数。

import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubRateLimitError,
  GitHubValidationError,
} from "./github-errors";
import { githubFetch } from "./github-fetch";
import { getRateLimitResetAt } from "./github-repos";

// 上游 REST 地址：默认官方 API；E2E / 自建可用 GITHUB_API_BASE_URL 指向本地 mock（仅服务端读取）
const GITHUB_API_BASE = process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";

export type RevokeAuthorizationResult = {
  /** 本次调用确实撤销了令牌（204）。 */
  revoked: boolean;
  /** 令牌在 GitHub 侧已不存在（404）——对调用方等价于「已经不可用了」。 */
  alreadyInvalid: boolean;
};

export type RevokeAuthorizationParams = {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * 撤销本应用的 OAuth 授权：成功或「令牌已不存在」都视为目标达成。
 * 错误分类与写操作客户端一致：403 / 429 → 限流或权限不足，401 → 应用凭据不可用（配置问题），
 * 422 → 上游校验失败，其余非 2xx → GitHubApiError。
 */
export async function revokeGitHubAuthorization(
  params: RevokeAuthorizationParams,
): Promise<RevokeAuthorizationResult> {
  const { clientId, clientSecret, accessToken, fetchImpl = fetch, timeoutMs } = params;
  const url = `${GITHUB_API_BASE}/applications/${encodeURIComponent(clientId)}/token`;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await githubFetch(
    url,
    {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "utf8-git",
      },
      body: JSON.stringify({ access_token: accessToken }),
      cache: "no-store",
    },
    { fetchImpl, timeoutMs },
  );

  if (response.status === 204) {
    return { revoked: true, alreadyInvalid: false };
  }
  // 令牌已被撤销 / 从未存在：目标已达成，不算失败
  if (response.status === 404) {
    return { revoked: false, alreadyInvalid: true };
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const retryAfter = response.headers.get("retry-after");
    if (response.status === 429 || remaining === "0" || retryAfter) {
      throw new GitHubRateLimitError("GitHub API 访问频率超限", getRateLimitResetAt(response));
    }
    throw new GitHubForbiddenError();
  }
  if (response.status === 401) {
    // 应用凭据错误属于服务端配置问题（不是用户的令牌失效），因此归类为上游异常
    throw new GitHubApiError("GitHub 拒绝了应用凭据（401）", 502);
  }
  if (response.status === 422) {
    throw new GitHubValidationError("GitHub 拒绝了撤销请求（422）");
  }
  if (!response.ok) {
    throw new GitHubApiError(`GitHub API 返回错误（${response.status}）`, response.status);
  }
  // 其他 2xx（GitHub 目前只返回 204）：按已撤销处理
  return { revoked: true, alreadyInvalid: false };
}
