// GitHub 提交详情客户端（REST，仅服务端调用）
// 用途：时间线节点详情（文件变更统计与文件列表）；错误语义与 github-repos 保持一致。

import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubUnauthorizedError,
} from "./github-errors";
import { getRateLimitResetAt, readRateLimitHeaders, type RestRateLimitInfo } from "./github-repos";
import { githubFetch } from "./github-fetch";

const GITHUB_API_BASE = "https://api.github.com";

// GitHub 最多返回 300 个文件；MVP 截取前 100 并标记截断
export const COMMIT_FILES_LIMIT = 100;

export type CommitFileChange = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
};

export type CommitDetail = {
  sha: string;
  message: string;
  headline: string;
  author: {
    login: string | null;
    name: string | null;
    avatarUrl: string | null;
    date: string | null;
  };
  committerDate: string | null;
  stats: { additions: number; deletions: number; total: number } | null;
  files: CommitFileChange[];
  filesTruncated: boolean;
  parents: string[];
  htmlUrl: string | null;
};

export type CommitDetailResult = {
  commit: CommitDetail;
  rateLimit: RestRateLimitInfo | null;
};

type RawCommitDetail = {
  sha?: unknown;
  commit?: {
    message?: unknown;
    author?: { name?: unknown; date?: unknown } | null;
    committer?: { date?: unknown } | null;
  } | null;
  author?: { login?: unknown; avatar_url?: unknown } | null;
  stats?: { additions?: unknown; deletions?: unknown; total?: unknown } | null;
  files?: Array<{
    filename?: unknown;
    status?: unknown;
    additions?: unknown;
    deletions?: unknown;
    changes?: unknown;
  } | null> | null;
  parents?: Array<{ sha?: unknown } | null> | null;
  html_url?: unknown;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// 归一化 REST /repos/{owner}/{repo}/commits/{sha} 响应
export function normalizeCommitDetail(raw: unknown): CommitDetail {
  const data = (raw ?? {}) as RawCommitDetail;
  const message = readString(data.commit?.message) ?? "";
  const headline = message.split("\n")[0]?.trim() ?? "";
  const filesAll = Array.isArray(data.files) ? data.files : [];
  const files = filesAll
    .filter((file): file is NonNullable<typeof file> => file !== null && file !== undefined)
    .slice(0, COMMIT_FILES_LIMIT)
    .map((file) => ({
      filename: readString(file.filename) ?? "",
      status: readString(file.status) ?? "modified",
      additions: readNumber(file.additions) ?? 0,
      deletions: readNumber(file.deletions) ?? 0,
      changes: readNumber(file.changes) ?? 0,
    }));
  return {
    sha: readString(data.sha) ?? "",
    message,
    headline,
    author: {
      login: readString(data.author?.login),
      name: readString(data.commit?.author?.name),
      avatarUrl: readString(data.author?.avatar_url),
      date: readString(data.commit?.author?.date),
    },
    committerDate: readString(data.commit?.committer?.date),
    stats: data.stats
      ? {
          additions: readNumber(data.stats.additions) ?? 0,
          deletions: readNumber(data.stats.deletions) ?? 0,
          total: readNumber(data.stats.total) ?? 0,
        }
      : null,
    files,
    filesTruncated: filesAll.length > COMMIT_FILES_LIMIT,
    parents: (data.parents ?? [])
      .map((parent) => readString(parent?.sha))
      .filter((value): value is string => value !== null),
    htmlUrl: readString(data.html_url),
  };
}

// 拉取单个提交详情（含文件统计）；抛出与 github-repos 同一套错误分类
export async function fetchCommitDetail(params: {
  token: string;
  owner: string;
  name: string;
  sha: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<CommitDetailResult> {
  const { token, owner, name, sha, fetchImpl = fetch, timeoutMs } = params;
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}`;

  // 统一封装：默认 15s 超时；网络不可达 → GitHubNetworkError，超时 → GitHubTimeoutError
  const response = await githubFetch(
    url,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "utf8-git",
      },
      // 令牌相关响应绝不进入 Next.js 数据缓存，避免跨用户复用
      cache: "no-store",
    },
    { fetchImpl, timeoutMs },
  );

  if (response.status === 401) {
    throw new GitHubUnauthorizedError();
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const retryAfter = response.headers.get("retry-after");
    if (response.status === 429 || remaining === "0" || retryAfter) {
      throw new GitHubRateLimitError("GitHub API 访问频率超限", getRateLimitResetAt(response));
    }
    throw new GitHubForbiddenError();
  }
  if (response.status === 404) {
    throw new GitHubNotFoundError("提交不存在或无权访问");
  }
  if (response.status === 422) {
    // 仓库存在但该 SHA 无法解析（提交不存在）时，GitHub 返回 422
    throw new GitHubNotFoundError("提交不存在或无权访问");
  }
  if (!response.ok) {
    throw new GitHubApiError(`GitHub API 返回错误（${response.status}）`, response.status);
  }

  const payload: unknown = await response.json();
  return { commit: normalizeCommitDetail(payload), rateLimit: readRateLimitHeaders(response) };
}
