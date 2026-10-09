// GitHub 分支写操作客户端（REST，仅服务端调用）：创建分支引用。
// 读接口见 github-repos / github-commits / github-timeline；错误语义与它们保持一致。

import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubUnauthorizedError,
  GitHubValidationError,
} from "./github-errors";
import { githubFetch } from "./github-fetch";
import { getRateLimitResetAt, readRateLimitHeaders, type RestRateLimitInfo } from "./github-repos";

// 上游 REST 地址：默认官方 API；E2E / 自建可用 GITHUB_API_BASE_URL 指向本地 mock（仅服务端读取）
const GITHUB_API_BASE = process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";

export type CreatedBranchRef = {
  ref: string; // refs/heads/feature/x
  branch: string; // feature/x
  sha: string; // 指向的目标提交
  url: string | null;
  rateLimit: RestRateLimitInfo | null;
};

type RawRef = {
  ref?: unknown;
  object?: { sha?: unknown } | null;
  url?: unknown;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// 归一化 POST /repos/{owner}/{repo}/git/refs 响应
export function normalizeCreatedRef(
  raw: unknown,
  fallbackBranch: string,
): { ref: string; branch: string; sha: string; url: string | null } {
  const data = (raw ?? {}) as RawRef;
  const ref = readString(data.ref) ?? `refs/heads/${fallbackBranch}`;
  const branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : fallbackBranch;
  return { ref, branch, sha: readString(data.object?.sha) ?? "", url: readString(data.url) };
}

/** 基于给定提交创建分支引用；抛出与其他客户端同一套错误分类。 */
export async function createBranchRef(params: {
  token: string;
  owner: string;
  name: string;
  branch: string;
  fromSha: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<CreatedBranchRef> {
  const { token, owner, name, branch, fromSha, fetchImpl = fetch, timeoutMs } = params;
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs`;

  const response = await githubFetch(
    url,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "utf8-git",
      },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
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
    throw new GitHubNotFoundError("仓库不存在或无权写入");
  }
  if (response.status === 422) {
    // 分支名非法或引用已存在
    throw new GitHubValidationError("分支名非法或已存在（422）");
  }
  if (!response.ok) {
    throw new GitHubApiError(`GitHub API 返回错误（${response.status}）`, response.status);
  }

  const payload: unknown = await response.json();
  return { ...normalizeCreatedRef(payload, branch), rateLimit: readRateLimitHeaders(response) };
}
