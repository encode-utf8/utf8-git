import { describe, expect, it } from "vitest";

import {
  fetchViewerReposPage,
  GitHubApiError,
  GitHubForbiddenError,
  GitHubRateLimitError,
  GitHubUnauthorizedError,
  parseLinkHeader,
  parseSsoHeader,
} from "./github-repos";

const sampleRepo = {
  id: 1,
  name: "utf8-git",
  full_name: "encode-utf8/utf8-git",
  owner: { login: "encode-utf8" },
  description: "把 Git 仓库变成一条时间线",
  private: true,
  fork: false,
  archived: false,
  default_branch: "main",
  language: "TypeScript",
  stargazers_count: 3,
  updated_at: "2026-10-04T10:00:00Z",
  html_url: "https://github.com/encode-utf8/utf8-git",
};

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("fetchViewerReposPage", () => {
  it("归一化仓库字段并解析 Link 分页与请求参数", async () => {
    let calledUrl: URL | undefined;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calledUrl = input as URL;
      return jsonResponse([sampleRepo], {
        headers: {
          link: '<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=1>; rel="prev"',
        },
      });
    }) as typeof fetch;

    const page = await fetchViewerReposPage({ token: "test-token", fetchImpl });

    expect(page.repos).toEqual([
      {
        id: 1,
        name: "utf8-git",
        fullName: "encode-utf8/utf8-git",
        owner: "encode-utf8",
        description: "把 Git 仓库变成一条时间线",
        isPrivate: true,
        isFork: false,
        isArchived: false,
        defaultBranch: "main",
        language: "TypeScript",
        stars: 3,
        updatedAt: "2026-10-04T10:00:00Z",
        htmlUrl: "https://github.com/encode-utf8/utf8-git",
      },
    ]);
    expect(page.hasMore).toBe(true);
    expect(page.nextPage).toBe(2);
    expect(page.sso).toBeNull();

    expect(calledUrl?.pathname).toBe("/user/repos");
    expect(calledUrl?.searchParams.get("affiliation")).toBe(
      "owner,collaborator,organization_member",
    );
    expect(calledUrl?.searchParams.get("sort")).toBe("updated");
    expect(calledUrl?.searchParams.get("per_page")).toBe("100");
    expect(calledUrl?.searchParams.get("page")).toBe("1");
  });

  it("401 抛出 GitHubUnauthorizedError", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ message: "Bad credentials" }, { status: 401 })) as typeof fetch;
    await expect(fetchViewerReposPage({ token: "bad", fetchImpl })).rejects.toBeInstanceOf(
      GitHubUnauthorizedError,
    );
  });

  it("403 且配额耗尽时抛出带恢复时间的 GitHubRateLimitError", async () => {
    const resetSeconds = Math.floor(Date.now() / 1000) + 1800;
    const fetchImpl = (async () =>
      jsonResponse(
        { message: "API rate limit exceeded" },
        {
          status: 403,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSeconds) },
        },
      )) as typeof fetch;

    const error = await fetchViewerReposPage({ token: "t", fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect((error as GitHubRateLimitError).resetAt?.getTime()).toBe(resetSeconds * 1000);
  });

  it("403 且带 retry-after（次级限流）时同样抛出 GitHubRateLimitError", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { message: "You have exceeded a secondary rate limit" },
        { status: 403, headers: { "retry-after": "60" } },
      )) as typeof fetch;
    await expect(fetchViewerReposPage({ token: "t", fetchImpl })).rejects.toBeInstanceOf(
      GitHubRateLimitError,
    );
  });

  it("200 且带 X-GitHub-SSO: partial-results 时返回 SSO 提示信息", async () => {
    const fetchImpl = (async () =>
      jsonResponse([sampleRepo], {
        headers: {
          "x-github-sso":
            "partial-results; organizations=acme,globex; url=https://github.com/orgs/acme/sso?authorization_request=abc",
        },
      })) as typeof fetch;

    const page = await fetchViewerReposPage({ token: "t", fetchImpl });
    expect(page.sso).toEqual({
      organizations: ["acme", "globex"],
      url: "https://github.com/orgs/acme/sso?authorization_request=abc",
    });
  });

  it("403 且带 X-GitHub-SSO: required 时抛出携带授权链接的 GitHubForbiddenError", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { message: "Resource protected by organization SAML enforcement" },
        {
          status: 403,
          headers: {
            "x-github-sso":
              "required; url=https://github.com/orgs/acme/sso?authorization_request=xyz",
          },
        },
      )) as typeof fetch;

    const error = await fetchViewerReposPage({ token: "t", fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubForbiddenError);
    expect((error as GitHubForbiddenError).ssoUrl).toBe(
      "https://github.com/orgs/acme/sso?authorization_request=xyz",
    );
  });

  it("其他非 2xx 抛出 GitHubApiError", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ message: "server error" }, { status: 500 })) as typeof fetch;
    const error = await fetchViewerReposPage({ token: "t", fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).status).toBe(500);
  });

  it("响应体异常（非数组）时返回空列表", async () => {
    const fetchImpl = (async () => jsonResponse({ message: "unexpected" })) as typeof fetch;
    const page = await fetchViewerReposPage({ token: "t", fetchImpl });
    expect(page.repos).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});

describe("parseLinkHeader", () => {
  it("无 next 时 hasMore 为 false", () => {
    expect(parseLinkHeader('<https://api.github.com/user/repos?page=1>; rel="prev"', 1)).toEqual({
      hasMore: false,
      nextPage: null,
    });
    expect(parseLinkHeader(null, 1)).toEqual({ hasMore: false, nextPage: null });
  });

  it("next 链接缺少 page 参数时回退到当前页 + 1", () => {
    expect(
      parseLinkHeader('<https://api.github.com/user/repos?per_page=100>; rel="next"', 3),
    ).toEqual({
      hasMore: true,
      nextPage: 4,
    });
  });
});

describe("parseSsoHeader", () => {
  it("仅识别 partial-results", () => {
    expect(parseSsoHeader("required; url=https://example.com")).toBeNull();
    expect(parseSsoHeader(null)).toBeNull();
    expect(
      parseSsoHeader("partial-results; organizations=acme; url=https://example.com/sso"),
    ).toEqual({
      organizations: ["acme"],
      url: "https://example.com/sso",
    });
  });
});
