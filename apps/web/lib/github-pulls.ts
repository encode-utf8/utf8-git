// GitHub PR 写操作客户端（REST，仅服务端调用）：创建 PR + 可合并性查询 + 合并。
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
import type { MergeMethod } from "./pull-ops";

// 上游 REST 地址：默认官方 API；E2E / 自建可用 GITHUB_API_BASE_URL 指向本地 mock（仅服务端读取）
const GITHUB_API_BASE = process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";

export type PullRequestSummary = {
  number: number;
  title: string;
  state: string; // open / closed（GitHub REST 为小写）
  merged: boolean;
  draft: boolean;
  /** GitHub 异步计算可合并性，未完成时为 null */
  mergeable: boolean | null;
  mergeableState: string | null;
  headRef: string | null;
  baseRef: string | null;
  url: string | null;
};

export type FetchedPullRequest = PullRequestSummary & { rateLimit: RestRateLimitInfo | null };

export type MergeResult = {
  merged: boolean;
  sha: string | null;
  message: string | null;
  rateLimit: RestRateLimitInfo | null;
};

type RawPullRequest = {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  merged?: unknown;
  draft?: unknown;
  mergeable?: unknown;
  mergeable_state?: unknown;
  head?: { ref?: unknown } | null;
  base?: { ref?: unknown } | null;
  html_url?: unknown;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// 归一化 GET /repos/{owner}/{repo}/pulls/{number} 响应
export function normalizePullRequest(raw: unknown, fallbackNumber: number): PullRequestSummary {
  const data = (raw ?? {}) as RawPullRequest;
  return {
    number: typeof data.number === "number" ? data.number : fallbackNumber,
    title: readString(data.title) ?? "",
    state: readString(data.state) ?? "open",
    merged: data.merged === true,
    draft: data.draft === true,
    // 只有明确的布尔值才算「已计算完成」，其余（含字段缺失）视为计算中
    mergeable: typeof data.mergeable === "boolean" ? data.mergeable : null,
    mergeableState: readString(data.mergeable_state),
    headRef: readString(data.head?.ref),
    baseRef: readString(data.base?.ref),
    url: readString(data.html_url),
  };
}

// 归一化 PUT /repos/{owner}/{repo}/pulls/{number}/merge 响应
export function normalizeMergeResult(raw: unknown): Omit<MergeResult, "rateLimit"> {
  const data = (raw ?? {}) as { merged?: unknown; sha?: unknown; message?: unknown };
  return {
    merged: data.merged === true,
    sha: readString(data.sha),
    message: readString(data.message),
  };
}

// REST 错误 → 统一错误分类（读取与合并共用）：非 2xx 一律在此抛出
function throwForStatus(response: Response, action: "读取" | "合并" | "创建"): never {
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
    throw new GitHubNotFoundError("PR 或仓库不存在，或无权访问");
  }
  if (response.status === 405) {
    // 合并专用：GitHub 判定当前状态不可合并
    throw new GitHubValidationError(`GitHub 拒绝${action}该 PR（405：不可合并）`);
  }
  if (response.status === 409) {
    // head 分支已变动 / 存在合并冲突
    throw new GitHubValidationError(`GitHub 拒绝${action}该 PR（409：head 已变动或存在冲突）`);
  }
  if (response.status === 422) {
    throw new GitHubValidationError(`GitHub 拒绝${action}该 PR（422）`);
  }
  throw new GitHubApiError(`GitHub API 返回错误（${response.status}）`, response.status);
}

/** 读取 PR 状态（用于可合并性检查）；抛出与其他客户端同一套错误分类。 */
export async function fetchPullRequest(params: {
  token: string;
  owner: string;
  name: string;
  number: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<FetchedPullRequest> {
  const { token, owner, name, number, fetchImpl = fetch, timeoutMs } = params;
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}`;

  const response = await githubFetch(
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "utf8-git",
      },
      cache: "no-store",
    },
    { fetchImpl, timeoutMs },
  );

  if (!response.ok) {
    throwForStatus(response, "读取");
  }

  const payload: unknown = await response.json();
  return { ...normalizePullRequest(payload, number), rateLimit: readRateLimitHeaders(response) };
}

/** 合并 PR（默认合并提交）；抛出与其他客户端同一套错误分类。 */
export async function mergePullRequest(params: {
  token: string;
  owner: string;
  name: string;
  number: number;
  method: MergeMethod;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<MergeResult> {
  const { token, owner, name, number, method, fetchImpl = fetch, timeoutMs } = params;
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/merge`;

  const response = await githubFetch(
    url,
    {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "utf8-git",
      },
      body: JSON.stringify({ merge_method: method }),
      cache: "no-store",
    },
    { fetchImpl, timeoutMs },
  );

  if (!response.ok) {
    throwForStatus(response, "合并");
  }

  const payload: unknown = await response.json();
  return { ...normalizeMergeResult(payload), rateLimit: readRateLimitHeaders(response) };
}
export type CreatedPullRequest = {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  headRef: string | null;
  baseRef: string | null;
  url: string | null;
  rateLimit: RestRateLimitInfo | null;
};

// 归一化 POST /repos/{owner}/{repo}/pulls 响应
export function normalizeCreatedPullRequest(raw: unknown): Omit<CreatedPullRequest, "rateLimit"> {
  const data = (raw ?? {}) as {
    number?: unknown;
    title?: unknown;
    state?: unknown;
    draft?: unknown;
    head?: { ref?: unknown } | null;
    base?: { ref?: unknown } | null;
    html_url?: unknown;
  };
  return {
    number: typeof data.number === "number" ? data.number : 0,
    title: readString(data.title) ?? "",
    state: readString(data.state) ?? "open",
    draft: data.draft === true,
    headRef: readString(data.head?.ref),
    baseRef: readString(data.base?.ref),
    url: readString(data.html_url),
  };
}

/** 创建 PR（标题 / 正文 / 来源分支 / 目标分支 / 草稿）；抛出与其他客户端同一套错误分类。 */
export async function createPullRequest(params: {
  token: string;
  owner: string;
  name: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<CreatedPullRequest> {
  const {
    token,
    owner,
    name,
    head,
    base,
    title,
    body,
    draft,
    fetchImpl = fetch,
    timeoutMs,
  } = params;
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`;
  const requestBody: Record<string, unknown> = { title, head, base, draft };
  if (body.trim().length > 0) {
    requestBody.body = body;
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

  if (!response.ok) {
    throwForStatus(response, "创建");
  }

  const payload: unknown = await response.json();
  return { ...normalizeCreatedPullRequest(payload), rateLimit: readRateLimitHeaders(response) };
}
