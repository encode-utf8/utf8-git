// 路由 / API 集成测试：覆盖「鉴权 → 令牌 → 数据层 → 错误码」组装链路。
// 替代原 Playwright E2E（见 docs/development-log.md 2026-10-09）：不打开浏览器、
// 不访问真实 GitHub、不连数据库。会话与令牌用模块 mock 顶替，GitHub 请求用全局 fetch 桩，
// 缓存 / 限流走默认内存后端。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, tokenMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  tokenMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
  signIn: vi.fn(),
}));

vi.mock("@/lib/access-token", () => ({
  getGitHubAccessToken: (...args: unknown[]) => tokenMock(...args),
}));

import { GET as getRepos } from "../app/api/repos/route";
import { GET as getTimeline } from "../app/api/repos/[owner]/[name]/timeline/route";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

const sampleRepo = {
  id: 1,
  name: "utf8-git",
  full_name: "encode-utf8/utf8-git",
  owner: { login: "encode-utf8" },
  description: "时间线",
  private: true,
  fork: false,
  archived: false,
  default_branch: "main",
  language: "TypeScript",
  stargazers_count: 3,
  updated_at: "2026-10-08T00:00:00Z",
  html_url: "https://github.com/encode-utf8/utf8-git",
};

function timelinePayload(owner: string, name: string) {
  return {
    data: {
      repository: {
        nameWithOwner: `${owner}/${name}`,
        description: "时间线",
        isPrivate: false,
        defaultBranchRef: { name: "main" },
        refs: {
          nodes: [{ name: "main", target: { oid: "a1", committedDate: "2026-10-08T00:00:00Z" } }],
        },
        object: {
          history: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                oid: "a1",
                messageHeadline: "feat: 初始提交",
                committedDate: "2026-10-08T00:00:00Z",
                author: { name: "Bot", user: { login: "bot", avatarUrl: null } },
                parents: { nodes: [] },
                associatedPullRequests: { nodes: [] },
              },
            ],
          },
        },
      },
      rateLimit: { limit: 5000, cost: 1, remaining: 4999, resetAt: "2030-01-01T00:00:00Z" },
    },
  };
}

const reposRequest = () => new Request("http://localhost/api/repos?page=1");
const timelineRequest = (query = "?page=1") =>
  new Request(`http://localhost/api/repos/encode-utf8/utf8-git/timeline${query}`);
const timelineContext = { params: Promise.resolve({ owner: "encode-utf8", name: "utf8-git" }) };

function stubGitHubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

beforeEach(() => {
  authMock.mockReset();
  tokenMock.mockReset();
  authMock.mockResolvedValue({ user: { id: "u-default" } });
  tokenMock.mockResolvedValue("ghs_test_token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/repos", () => {
  it("未登录返回 401 unauthorized", async () => {
    authMock.mockResolvedValue(null);
    const res = await getRepos(reposRequest());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "unauthorized" });
  });

  it("会话存在但无令牌返回 401 no_token", async () => {
    tokenMock.mockResolvedValue(null);
    const res = await getRepos(reposRequest());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "no_token" });
  });

  it("正常返回仓库列表：字段归一化且响应不含令牌", async () => {
    authMock.mockResolvedValue({ user: { id: "u-repos-ok" } });
    stubGitHubFetch(async () =>
      jsonResponse([sampleRepo], {
        headers: {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
          "x-ratelimit-reset": "1893456000",
        },
      }),
    );
    const res = await getRepos(reposRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      repos: Array<{ fullName: string; isPrivate: boolean }>;
      meta: { cached: boolean };
      token?: unknown;
    };
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0]).toMatchObject({ fullName: "encode-utf8/utf8-git", isPrivate: true });
    expect(body.meta.cached).toBe(false);
    expect(body.token).toBeUndefined();
  });

  it("GitHub 限流返回 429 rate_limited", async () => {
    authMock.mockResolvedValue({ user: { id: "u-repos-rate" } });
    stubGitHubFetch(async () =>
      jsonResponse(
        { message: "API rate limit exceeded" },
        {
          status: 403,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000" },
        },
      ),
    );
    const res = await getRepos(reposRequest());
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ error: "rate_limited" });
  });

  it("GitHub 不可达返回 503 github_unreachable", async () => {
    authMock.mockResolvedValue({ user: { id: "u-repos-net" } });
    stubGitHubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const res = await getRepos(reposRequest());
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: "github_unreachable" });
  });
});

describe("GET /api/repos/[owner]/[name]/timeline", () => {
  it("未登录返回 401 unauthorized", async () => {
    authMock.mockResolvedValue(null);
    const res = await getTimeline(timelineRequest(), timelineContext);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "unauthorized" });
  });

  it("非法仓库名返回 400 invalid_repo", async () => {
    const bad = { params: Promise.resolve({ owner: "..bad", name: "utf8-git" }) };
    const res = await getTimeline(timelineRequest(), bad);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_repo" });
  });

  it("非法页码返回 400 invalid_page", async () => {
    const res = await getTimeline(timelineRequest("?page=0"), timelineContext);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_page" });
  });

  it("正常返回时间线提交与分页信息", async () => {
    authMock.mockResolvedValue({ user: { id: "u-tl-ok" } });
    stubGitHubFetch(async () => jsonResponse(timelinePayload("encode-utf8", "utf8-git")));
    const res = await getTimeline(timelineRequest(), timelineContext);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      repo: { nameWithOwner: string };
      commits: Array<{ oid: string; headline: string }>;
      meta: { page: number };
    };
    expect(body.repo.nameWithOwner).toBe("encode-utf8/utf8-git");
    expect(body.commits).toHaveLength(1);
    expect(body.commits[0]).toMatchObject({ oid: "a1", headline: "feat: 初始提交" });
    expect(body.meta.page).toBe(1);
  });

  it("深页缺少游标链返回 409 cursor_expired", async () => {
    authMock.mockResolvedValue({ user: { id: "u-tl-cursor" } });
    const res = await getTimeline(timelineRequest("?page=2"), timelineContext);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "cursor_expired" });
  });
});
