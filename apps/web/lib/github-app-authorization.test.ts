import { describe, expect, it } from "vitest";

import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubNetworkError,
  GitHubRateLimitError,
  GitHubValidationError,
} from "./github-errors";
import { revokeGitHubAuthorization } from "./github-app-authorization";

const clientId = "cid-123";
const clientSecret = "secret-456";
const accessToken = "ghs_token";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function capture() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("撤销 GitHub 授权", () => {
  it("DELETE /applications/{client_id}/token：Basic 认证 + access_token 请求体", async () => {
    const { calls, fetchImpl } = capture();

    const result = await revokeGitHubAuthorization({
      clientId,
      clientSecret,
      accessToken,
      fetchImpl,
    });

    expect(result).toEqual({ revoked: true, alreadyInvalid: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`/applications/${clientId}/token`);
    expect(calls[0].init.method).toBe("DELETE");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ access_token: accessToken });
  });

  it("404 视为「令牌已不存在」而不是失败", async () => {
    const fetchImpl = (async () =>
      jsonResponse(404, { message: "Not Found" })) as unknown as typeof fetch;

    await expect(
      revokeGitHubAuthorization({ clientId, clientSecret, accessToken, fetchImpl }),
    ).resolves.toEqual({ revoked: false, alreadyInvalid: true });
  });

  it("403 + 配额耗尽 → GitHubRateLimitError", async () => {
    const fetchImpl = (async () =>
      jsonResponse(403, {}, { "x-ratelimit-remaining": "0" })) as unknown as typeof fetch;

    await expect(
      revokeGitHubAuthorization({ clientId, clientSecret, accessToken, fetchImpl }),
    ).rejects.toBeInstanceOf(GitHubRateLimitError);
  });

  it("403 → GitHubForbiddenError", async () => {
    const fetchImpl = (async () => jsonResponse(403, {})) as unknown as typeof fetch;

    await expect(
      revokeGitHubAuthorization({ clientId, clientSecret, accessToken, fetchImpl }),
    ).rejects.toBeInstanceOf(GitHubForbiddenError);
  });

  it("401（应用凭据错误）→ 归类为上游异常而不是用户令牌失效", async () => {
    const fetchImpl = (async () => jsonResponse(401, {})) as unknown as typeof fetch;

    const failure = await revokeGitHubAuthorization({
      clientId,
      clientSecret,
      accessToken,
      fetchImpl,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GitHubApiError);
    expect((failure as GitHubApiError).status).toBe(502);
  });

  it("422 → GitHubValidationError；5xx → GitHubApiError", async () => {
    const validation = (async () => jsonResponse(422, {})) as unknown as typeof fetch;
    await expect(
      revokeGitHubAuthorization({ clientId, clientSecret, accessToken, fetchImpl: validation }),
    ).rejects.toBeInstanceOf(GitHubValidationError);

    const failure = (async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const error = await revokeGitHubAuthorization({
      clientId,
      clientSecret,
      accessToken,
      fetchImpl: failure,
    }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).status).toBe(500);
  });

  it("网络不可达 → GitHubNetworkError", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(
      revokeGitHubAuthorization({ clientId, clientSecret, accessToken, fetchImpl }),
    ).rejects.toBeInstanceOf(GitHubNetworkError);
  });
});
