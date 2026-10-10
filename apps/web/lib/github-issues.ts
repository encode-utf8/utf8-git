// GitHub Issue 写操作客户端（REST，仅服务端调用）：创建 Issue。
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

export type CreatedIssue = {
  number: number;
  title: string;
  state: string;
  url: string | null;
  rateLimit: RestRateLimitInfo | null;
};

type RawIssue = {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  html_url?: unknown;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// 归一化 POST /repos/{owner}/{repo}/issues 响应
export function normalizeCreatedIssue(raw: unknown): {
  number: number;
  title: string;
  state: string;
  url: string | null;
} {
  const data = (raw ?? {}) as RawIssue;
  const number = typeof data.number === "number" ? data.number : 0;
  return {
    number,
    title: readString(data.title) ?? "",
    state: readString(data.state) ?? "open",
    url: readString(data.html_url),
  };
}

/** 创建 Issue；抛出与其他客户端同一套错误分类。 */
export async function createIssue(params: {
  token: string;
  owner: string;
  name: string;
  title: string;
  body: string;
  labels: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<CreatedIssue> {
  const { token, owner, name, title, body, labels, fetchImpl = fetch, timeoutMs } = params;
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`;
  const requestBody: Record<string, unknown> = { title };
  if (body.trim().length > 0) {
    requestBody.body = body;
  }
  if (labels.length > 0) {
    requestBody.labels = labels;
  }

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
      body: JSON.stringify(requestBody),
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
  if (response.status === 410) {
    // 仓库已关闭 Issue
    throw new GitHubValidationError("该仓库已关闭 Issue 功能（410）");
  }
  if (response.status === 422) {
    throw new GitHubValidationError("Issue 字段不被接受（422）");
  }
  if (!response.ok) {
    throw new GitHubApiError(`GitHub API 返回错误（${response.status}）`, response.status);
  }

  const payload: unknown = await response.json();
  return { ...normalizeCreatedIssue(payload), rateLimit: readRateLimitHeaders(response) };
}
