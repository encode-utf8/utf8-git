import { describe, expect, it } from "vitest";

import { COMMIT_FILES_LIMIT, fetchCommitDetail, normalizeCommitDetail } from "./github-commits";
import { GitHubNotFoundError, GitHubRateLimitError } from "./github-errors";

const sampleRaw = {
  sha: "abcdef1234567890abcdef1234567890abcdef12",
  commit: {
    message: "feat: 新功能\n\n详细说明",
    author: { name: "encode-utf8", date: "2026-10-06T12:00:00Z" },
    committer: { date: "2026-10-06T12:05:00Z" },
  },
  author: { login: "encode-utf8", avatar_url: "https://avatars.githubusercontent.com/u/1" },
  stats: { additions: 120, deletions: 30, total: 150 },
  files: [
    {
      filename: "apps/web/lib/a.ts",
      status: "modified",
      additions: 100,
      deletions: 20,
      changes: 120,
    },
    {
      filename: "apps/web/lib/b.ts",
      status: "added",
      additions: 20,
      deletions: 10,
      changes: 30,
    },
  ],
  parents: [{ sha: "parent-1" }],
  html_url: "https://github.com/encode-utf8/utf8-git/commit/abcdef1",
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

describe("normalizeCommitDetail", () => {
  it("归一化提交信息 / 作者 / 统计 / 文件 / 父提交", () => {
    const commit = normalizeCommitDetail(sampleRaw);
    expect(commit.headline).toBe("feat: 新功能");
    expect(commit.message).toBe("feat: 新功能\n\n详细说明");
    expect(commit.author).toEqual({
      login: "encode-utf8",
      name: "encode-utf8",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
      date: "2026-10-06T12:00:00Z",
    });
    expect(commit.committerDate).toBe("2026-10-06T12:05:00Z");
    expect(commit.stats).toEqual({ additions: 120, deletions: 30, total: 150 });
    expect(commit.files).toHaveLength(2);
    expect(commit.files[1]).toEqual({
      filename: "apps/web/lib/b.ts",
      status: "added",
      additions: 20,
      deletions: 10,
      changes: 30,
    });
    expect(commit.filesTruncated).toBe(false);
    expect(commit.parents).toEqual(["parent-1"]);
    expect(commit.htmlUrl).toBe("https://github.com/encode-utf8/utf8-git/commit/abcdef1");
  });

  it("文件数超过上限时截断并标记", () => {
    const files = Array.from({ length: COMMIT_FILES_LIMIT + 1 }, (_value, index) => ({
      filename: `file-${index}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
    }));
    const commit = normalizeCommitDetail({ ...sampleRaw, files });
    expect(commit.files).toHaveLength(COMMIT_FILES_LIMIT);
    expect(commit.filesTruncated).toBe(true);
  });

  it("字段缺失时防御式回退", () => {
    const commit = normalizeCommitDetail({});
    expect(commit.headline).toBe("");
    expect(commit.stats).toBeNull();
    expect(commit.files).toEqual([]);
    expect(commit.parents).toEqual([]);
    expect(commit.author).toEqual({ login: null, name: null, avatarUrl: null, date: null });
  });
});

describe("fetchCommitDetail", () => {
  it("请求正确的 URL 并携带令牌", async () => {
    let calledUrl = "";
    let calledInit: RequestInit | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      calledInit = init;
      return jsonResponse(sampleRaw);
    }) as typeof fetch;

    const result = await fetchCommitDetail({
      token: "t",
      owner: "encode-utf8",
      name: "utf8-git",
      sha: "abcdef1",
      fetchImpl,
    });

    expect(calledUrl).toBe("https://api.github.com/repos/encode-utf8/utf8-git/commits/abcdef1");
    expect((calledInit?.headers as Record<string, string>).Authorization).toBe("Bearer t");
    expect(result.commit.headline).toBe("feat: 新功能");
    expect(result.rateLimit).toBeNull();
  });

  it("404 → GitHubNotFoundError", async () => {
    const fetchImpl = (async () => jsonResponse({}, { status: 404 })) as typeof fetch;
    await expect(
      fetchCommitDetail({ token: "t", owner: "o", name: "n", sha: "abcdef1", fetchImpl }),
    ).rejects.toBeInstanceOf(GitHubNotFoundError);
  });

  it("422（SHA 无法解析）→ GitHubNotFoundError", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { message: "No commit found for SHA: abcdef1" },
        { status: 422 },
      )) as typeof fetch;
    await expect(
      fetchCommitDetail({ token: "t", owner: "o", name: "n", sha: "abcdef1", fetchImpl }),
    ).rejects.toBeInstanceOf(GitHubNotFoundError);
  });

  it("403 且配额为 0 → GitHubRateLimitError（含恢复时间）", async () => {
    const reset = Math.floor(Date.now() / 1000) + 1800;
    const fetchImpl = (async () =>
      jsonResponse(
        {},
        {
          status: 403,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
        },
      )) as typeof fetch;

    const error = await fetchCommitDetail({
      token: "t",
      owner: "o",
      name: "n",
      sha: "abcdef1",
      fetchImpl,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect((error as GitHubRateLimitError).resetAt?.getTime()).toBe(reset * 1000);
  });
});
