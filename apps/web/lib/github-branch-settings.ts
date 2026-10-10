// M3-5 删除分支的前置读取（REST，仅服务端调用）：默认分支 + 分支保护规则。
// 说明：分支保护端点 GET /branches/{branch}/protection 对无权令牌直接返回 403，
// 因此这里改用 GET /repos/{owner}/{repo} 的 default_branch 与
// GET /repos/{owner}/{repo}/branches/{branch} 的 protected 字段（公开仓库可读）。
// 不依赖保护的细分规则（审查人数 / 检查项），只关心「是否受保护」这一删除前置条件。

import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubUnauthorizedError,
} from "./github-errors";
import { githubFetch } from "./github-fetch";
import { getRateLimitResetAt, readRateLimitHeaders, type RestRateLimitInfo } from "./github-repos";

const GITHUB_API_BASE = process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";

export type BranchDeletionContext = {
  /** 分支是否存在（404 视为不存在：无法删除，但不算错误）。 */
  exists: boolean;
  defaultBranch: string | null;
  protectedBranch: boolean;
  rateLimit: RestRateLimitInfo | null;
};

type RawRepo = { default_branch?: unknown };
type RawBranch = { protected?: unknown };

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// 分支名可能含 /（feature/x）；逐段编码保留路径分隔符
function encodeRefPath(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function authHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "utf8-git",
  };
}

/** 非 2xx 状态统一分类；404 由调用方按资源语义处理，故此处不覆盖。 */
function mapFailure(response: Response, notFoundMessage: string): never {
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
    throw new GitHubNotFoundError(notFoundMessage);
  }
  throw new GitHubApiError(`GitHub API 返回错误（${response.status}）`, response.status);
}

/**
 * 读取删除分支所需的前置上下文：默认分支与目标分支的保护状态。
 * 抛出：GitHubUnauthorizedError / GitHubForbiddenError / GitHubRateLimitError（仓库不存在时 GitHubNotFoundError）。
 */
export async function fetchBranchDeletionContext(params: {
  token: string;
  owner: string;
  name: string;
  branch: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<BranchDeletionContext> {
  const { token, owner, name, branch, fetchImpl = fetch, timeoutMs } = params;
  const repoUrl = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const branchUrl = `${repoUrl}/branches/${encodeRefPath(branch)}`;
  const init: RequestInit = { headers: authHeaders(token), cache: "no-store" };

  const [repoResponse, branchResponse] = await Promise.all([
    githubFetch(repoUrl, init, { fetchImpl, timeoutMs }),
    githubFetch(branchUrl, init, { fetchImpl, timeoutMs }),
  ]);

  if (!repoResponse.ok) {
    mapFailure(repoResponse, "仓库不存在或无权访问");
  }
  const repo = (await repoResponse.json()) as RawRepo;
  const defaultBranch = readString(repo?.default_branch);
  const rateLimit = readRateLimitHeaders(branchResponse) ?? readRateLimitHeaders(repoResponse);

  // 分支不存在：可删除性判定交给调用方（给出「分支不存在」原因），不当作错误
  if (branchResponse.status === 404) {
    return { exists: false, defaultBranch, protectedBranch: false, rateLimit };
  }
  if (!branchResponse.ok) {
    mapFailure(branchResponse, "分支不存在或无权访问");
  }
  const rawBranch = (await branchResponse.json()) as RawBranch;
  return {
    exists: true,
    defaultBranch,
    protectedBranch: rawBranch?.protected === true,
    rateLimit,
  };
}
