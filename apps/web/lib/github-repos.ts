// GitHub 仓库列表客户端（仅服务端调用）
// 选用 REST /user/repos：可通过 X-GitHub-SSO 头检测组织 SSO 的部分结果，
// 分页直接使用 Link 头；跨资源聚合型读接口（时间线）见 github-timeline.ts。

import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubRateLimitError,
  GitHubUnauthorizedError,
} from "./github-errors";
import { githubFetch } from "./github-fetch";

// 统一从 github-errors 再导出：既有导入路径（页面 / API / 测试）保持不变
export { GitHubApiError, GitHubForbiddenError, GitHubRateLimitError, GitHubUnauthorizedError };
export {
  GitHubGraphQLError,
  GitHubNetworkError,
  GitHubNotFoundError,
  GitHubTimeoutError,
} from "./github-errors";

const GITHUB_API_BASE = "https://api.github.com";

// REST 响应头中的配额快照（x-ratelimit-*）
export type RestRateLimitInfo = {
  limit: number | null;
  remaining: number;
  resetAt: Date | null;
};

// 仓储信息（仅保留页面需要的字段）
export type RepoSummary = {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  defaultBranch: string | null;
  language: string | null;
  stars: number;
  updatedAt: string;
  htmlUrl: string;
};

// 组织 SSO 部分结果（X-GitHub-SSO: partial-results）
export type SsoInfo = {
  organizations: string[];
  url: string | null;
};

export type RepoPage = {
  repos: RepoSummary[];
  hasMore: boolean;
  nextPage: number | null;
  sso: SsoInfo | null;
  rateLimit: RestRateLimitInfo | null;
};

type RawRepo = {
  id?: unknown;
  name?: unknown;
  full_name?: unknown;
  owner?: { login?: unknown };
  description?: unknown;
  private?: unknown;
  fork?: unknown;
  archived?: unknown;
  default_branch?: unknown;
  language?: unknown;
  stargazers_count?: unknown;
  updated_at?: unknown;
  html_url?: unknown;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toRepoSummary(raw: RawRepo): RepoSummary {
  return {
    id: typeof raw.id === "number" ? raw.id : 0,
    name: readString(raw.name) ?? "",
    fullName: readString(raw.full_name) ?? "",
    owner: readString(raw.owner?.login) ?? "",
    description: readString(raw.description),
    isPrivate: raw.private === true,
    isFork: raw.fork === true,
    isArchived: raw.archived === true,
    defaultBranch: readString(raw.default_branch),
    language: readString(raw.language),
    stars: typeof raw.stargazers_count === "number" ? raw.stargazers_count : 0,
    updatedAt: readString(raw.updated_at) ?? "",
    htmlUrl: readString(raw.html_url) ?? "",
  };
}

// 解析 Link 头中的 rel="next"，得到下一页页码
export function parseLinkHeader(
  link: string | null,
  currentPage: number,
): { hasMore: boolean; nextPage: number | null } {
  if (!link) {
    return { hasMore: false, nextPage: null };
  }
  const match = /<([^>]+)>;\s*rel="next"/.exec(link);
  if (!match) {
    return { hasMore: false, nextPage: null };
  }
  const page = Number(new URL(match[1]).searchParams.get("page"));
  return { hasMore: true, nextPage: Number.isInteger(page) && page > 0 ? page : currentPage + 1 };
}

// 解析 X-GitHub-SSO 头中的组织与授权链接
export function parseSsoHeader(value: string | null | undefined): SsoInfo | null {
  if (!value || !value.startsWith("partial-results")) {
    return null;
  }
  const organizations =
    /organizations=([^;]+)/
      .exec(value)?.[1]
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];
  const url = readString(/url=([^;]+)/.exec(value)?.[1]?.trim());
  return { organizations, url };
}

function extractSsoUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return readString(/url=([^;]+)/.exec(value)?.[1]?.trim());
}

export function getRateLimitResetAt(response: Response): Date | null {
  const reset = response.headers.get("x-ratelimit-reset");
  if (!reset) {
    return null;
  }
  const seconds = Number(reset);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

// 解析成功响应中的 x-ratelimit-* 头
export function readRateLimitHeaders(response: Response): RestRateLimitInfo | null {
  const remainingRaw = response.headers.get("x-ratelimit-remaining");
  const remaining = Number(remainingRaw);
  if (remainingRaw === null || !Number.isFinite(remaining)) {
    return null;
  }
  const limitRaw = Number(response.headers.get("x-ratelimit-limit"));
  return {
    limit: Number.isFinite(limitRaw) ? limitRaw : null,
    remaining,
    resetAt: getRateLimitResetAt(response),
  };
}

/**
 * 拉取当前用户可见的仓库（含私有、组织）；分页 100 条/页。
 * 抛出：GitHubUnauthorizedError / GitHubRateLimitError / GitHubForbiddenError / GitHubApiError
 */
export async function fetchViewerReposPage(params: {
  token: string;
  page?: number;
  perPage?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<RepoPage> {
  const { token, page = 1, perPage = 100, fetchImpl = fetch, timeoutMs } = params;

  const url = new URL(`${GITHUB_API_BASE}/user/repos`);
  url.searchParams.set("affiliation", "owner,collaborator,organization_member");
  url.searchParams.set("sort", "updated");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));

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
    const ssoHeader = response.headers.get("x-github-sso");
    if (response.status === 429 || remaining === "0" || retryAfter) {
      throw new GitHubRateLimitError("GitHub API 访问频率超限", getRateLimitResetAt(response));
    }
    throw new GitHubForbiddenError(
      ssoHeader
        ? "该组织的单点登录（SSO）授权未完成，仓库数据被部分隐藏"
        : "GitHub 拒绝了本次请求（403）",
      extractSsoUrl(ssoHeader),
    );
  }
  if (!response.ok) {
    throw new GitHubApiError(`GitHub API 返回错误（${response.status}）`, response.status);
  }

  const payload: unknown = await response.json();
  const repos = Array.isArray(payload) ? (payload as RawRepo[]).map(toRepoSummary) : [];

  return {
    repos,
    ...parseLinkHeader(response.headers.get("link"), page),
    sso: parseSsoHeader(response.headers.get("x-github-sso")),
    rateLimit: readRateLimitHeaders(response),
  };
}
