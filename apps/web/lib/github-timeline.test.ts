import { describe, expect, it } from "vitest";

import { collectIssues, fetchTimelinePage, normalizeTimelineResponse } from "./github-timeline";

const rawResponse = {
  repository: {
    nameWithOwner: "encode-utf8/utf8-git",
    description: "把 Git 仓库变成一条时间线",
    isPrivate: false,
    defaultBranchRef: { name: "main" },
    refs: {
      nodes: [
        { name: "dev", target: { oid: "bbb", committedDate: "2026-10-04T00:00:00Z" } },
        { name: "main", target: { oid: "aaa", committedDate: "2026-10-05T00:00:00Z" } },
      ],
    },
    object: {
      history: {
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
        nodes: [
          {
            oid: "aaa",
            messageHeadline: "feat: 新功能",
            committedDate: "2026-10-05T00:00:00Z",
            author: {
              name: "encode-utf8",
              user: {
                login: "encode-utf8",
                avatarUrl: "https://avatars.githubusercontent.com/u/1",
              },
            },
            parents: { nodes: [{ oid: "parent-1" }, { oid: "parent-2" }, { oid: "parent-3" }] },
            associatedPullRequests: {
              nodes: [
                {
                  number: 3,
                  title: "新增仓库列表页",
                  state: "MERGED",
                  mergedAt: "2026-10-05T00:00:00Z",
                  url: "https://github.com/encode-utf8/utf8-git/pull/3",
                  closingIssuesReferences: {
                    nodes: [
                      {
                        number: 12,
                        title: "时间线偶发空白",
                        state: "CLOSED",
                        url: "https://github.com/encode-utf8/utf8-git/issues/12",
                      },
                    ],
                  },
                },
                { number: "bad" },
              ],
            },
          },
          null,
        ],
      },
    },
  },
  rateLimit: { limit: 5000, cost: 1, remaining: 4999, resetAt: "2026-10-05T01:00:00Z" },
};

describe("normalizeTimelineResponse", () => {
  it("归一化仓库 / 分支 / 提交 / 关联 PR（防御式）", () => {
    const data = normalizeTimelineResponse(rawResponse, null);

    expect(data.repo).toEqual({
      nameWithOwner: "encode-utf8/utf8-git",
      description: "把 Git 仓库变成一条时间线",
      isPrivate: false,
      defaultBranch: "main",
    });
    expect(data.branch).toBe("main");
    expect(data.branches).toHaveLength(2);
    expect(data.branches[1]).toEqual({
      name: "main",
      headOid: "aaa",
      committedDate: "2026-10-05T00:00:00Z",
    });
    expect(data.commits).toHaveLength(1);
    expect(data.commits[0]).toEqual({
      oid: "aaa",
      headline: "feat: 新功能",
      committedDate: "2026-10-05T00:00:00Z",
      author: {
        login: "encode-utf8",
        name: "encode-utf8",
        avatarUrl: "https://avatars.githubusercontent.com/u/1",
      },
      parents: ["parent-1", "parent-2", "parent-3"],
      pullRequests: [
        {
          number: 3,
          title: "新增仓库列表页",
          state: "MERGED",
          mergedAt: "2026-10-05T00:00:00Z",
          url: "https://github.com/encode-utf8/utf8-git/pull/3",
          issues: [
            {
              number: 12,
              title: "时间线偶发空白",
              state: "CLOSED",
              url: "https://github.com/encode-utf8/utf8-git/issues/12",
            },
          ],
        },
      ],
    });
    expect(data.pageInfo).toEqual({ hasNextPage: true, endCursor: "cursor-1" });
  });

  it("显式分支优先于默认分支名", () => {
    const data = normalizeTimelineResponse(rawResponse, "dev");
    expect(data.branch).toBe("dev");
  });

  it("空响应 / 缺陷字段全部回退为空值", () => {
    const data = normalizeTimelineResponse({}, null);
    expect(data).toEqual({
      repo: { nameWithOwner: "", description: null, isPrivate: false, defaultBranch: null },
      branch: null,
      commits: [],
      branches: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    expect(normalizeTimelineResponse(null, "dev").branch).toBe("dev");
  });
});

describe("fetchTimelinePage", () => {
  it("单次 GraphQL 请求取回聚合数据（默认分支用 HEAD 表达式）", async () => {
    let calls = 0;
    let capturedBody: string | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({ data: rawResponse }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await fetchTimelinePage({
      token: "t",
      owner: "encode-utf8",
      name: "utf8-git",
      fetchImpl,
      graphql: { sleepImpl: async () => {} },
    });

    expect(calls).toBe(1);
    const body = JSON.parse(capturedBody ?? "{}") as { variables: Record<string, unknown> };
    expect(body.variables).toEqual({
      owner: "encode-utf8",
      name: "utf8-git",
      branch: "HEAD",
      cursor: null,
    });
    expect(result.data.branch).toBe("main");
    expect(result.rateLimit?.remaining).toBe(4999);
    expect(result.warnings).toEqual([]);
  });

  it("指定分支与 cursor 时传入变量", async () => {
    let capturedBody: string | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({ data: rawResponse }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await fetchTimelinePage({
      token: "t",
      owner: "o",
      name: "n",
      branch: "dev",
      cursor: "cursor-1",
      fetchImpl,
      graphql: { sleepImpl: async () => {} },
    });

    const body = JSON.parse(capturedBody ?? "{}") as { variables: Record<string, unknown> };
    expect(body.variables).toEqual({ owner: "o", name: "n", branch: "dev", cursor: "cursor-1" });
  });
});

describe("collectIssues", () => {
  it("跨 PR 聚合 Issue 并按编号去重，保留首次出现顺序", () => {
    const issue = (number: number) => ({ number, title: `#${number}`, state: "OPEN", url: null });
    const pullRequest = (number: number, issues: ReturnType<typeof issue>[]) => ({
      number,
      title: `PR #${number}`,
      state: "MERGED",
      mergedAt: null,
      url: null,
      issues,
    });

    expect(collectIssues([])).toEqual([]);
    const collected = collectIssues([
      pullRequest(1, [issue(10), issue(11)]),
      pullRequest(2, [issue(11), issue(12)]),
    ]);
    expect(collected.map((item) => item.number)).toEqual([10, 11, 12]);
  });
});
