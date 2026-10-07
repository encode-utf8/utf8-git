import { describe, expect, it } from "vitest";

import { GitHubApiError, GitHubTimeoutError, GitHubUnauthorizedError } from "./github-errors";
import { normalizeTokenResponse, refreshGitHubToken } from "./github-token";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

describe("normalizeTokenResponse", () => {
  it("解析令牌并按 expires_in 计算绝对过期时间", () => {
    const token = normalizeTokenResponse(
      {
        access_token: "gho_new",
        refresh_token: "ghr_new",
        expires_in: 28800,
        token_type: "bearer",
        scope: "read:user,repo",
      },
      1_700_000_000_000,
    );
    expect(token).toEqual({
      accessToken: "gho_new",
      refreshToken: "ghr_new",
      expiresAt: 1_700_000_000 + 28800,
      tokenType: "bearer",
      scope: "read:user,repo",
    });
  });

  it("缺少 access_token 时返回 null", () => {
    expect(normalizeTokenResponse({ error: "bad_verification_code" }, 0)).toBeNull();
    expect(normalizeTokenResponse(null, 0)).toBeNull();
  });
});

describe("refreshGitHubToken", () => {
  it("以 refresh_token 授权类型提交表单并返回新令牌", async () => {
    let calledUrl = "";
    let calledInit: RequestInit | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      calledInit = init;
      return jsonResponse({
        access_token: "gho_new",
        refresh_token: "ghr_new",
        expires_in: 28800,
        token_type: "bearer",
      });
    }) as typeof fetch;

    const result = await refreshGitHubToken({
      clientId: "cid",
      clientSecret: "secret",
      refreshToken: "ghr_old",
      fetchImpl,
      now: () => 1_700_000_000_000,
    });

    expect(calledUrl).toBe("https://github.com/login/oauth/access_token");
    expect(calledInit?.method).toBe("POST");
    const body = new URLSearchParams(String(calledInit?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("secret");
    expect(body.get("refresh_token")).toBe("ghr_old");
    expect(result.accessToken).toBe("gho_new");
    expect(result.refreshToken).toBe("ghr_new");
    expect(result.expiresAt).toBe(1_700_000_000 + 28800);
  });

  it("200 + error 字段（refresh token 已失效）→ GitHubUnauthorizedError", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        error: "bad_verification_code",
        error_description: "The code passed is incorrect or expired.",
      })) as typeof fetch;

    await expect(
      refreshGitHubToken({ clientId: "c", clientSecret: "s", refreshToken: "r", fetchImpl }),
    ).rejects.toBeInstanceOf(GitHubUnauthorizedError);
  });

  it("网络异常 → GitHubApiError；超时 → GitHubTimeoutError", async () => {
    const networkFail = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(
      refreshGitHubToken({
        clientId: "c",
        clientSecret: "s",
        refreshToken: "r",
        fetchImpl: networkFail,
      }),
    ).rejects.toBeInstanceOf(GitHubApiError);

    const timeoutFail = (async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    }) as typeof fetch;
    await expect(
      refreshGitHubToken({
        clientId: "c",
        clientSecret: "s",
        refreshToken: "r",
        fetchImpl: timeoutFail,
      }),
    ).rejects.toBeInstanceOf(GitHubTimeoutError);
  });

  it("5xx → GitHubApiError（不误判为未授权）", async () => {
    const fetchImpl = (async () => jsonResponse({}, { status: 500 })) as typeof fetch;
    const error = await refreshGitHubToken({
      clientId: "c",
      clientSecret: "s",
      refreshToken: "r",
      fetchImpl,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error).not.toBeInstanceOf(GitHubUnauthorizedError);
  });
});
