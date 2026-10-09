// 时间线 GraphQL 查询与归一化（仅服务端调用）
// 一次请求聚合：仓库信息 + 分支头（前 50）+ 提交历史（50/页）+ 关联 PR + rateLimit。

import {
  type GitHubGraphQLOptions,
  type GitHubRateLimitInfo,
  githubGraphQL,
} from "./github-graphql";

export const TIMELINE_PAGE_SIZE = 50;
const TIMELINE_BRANCH_LIMIT = 50;

// HEAD 表达式由 GitHub 解析为仓库默认分支
export const DEFAULT_BRANCH_EXPRESSION = "HEAD";

const TIMELINE_QUERY = `query Timeline($owner: String!, $name: String!, $branch: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    description
    isPrivate
    defaultBranchRef { name }
    refs(refPrefix: "refs/heads/", first: ${TIMELINE_BRANCH_LIMIT}, orderBy: { field: ALPHABETICAL, direction: ASC }) {
      nodes {
        name
        target {
          oid
          ... on Commit { committedDate }
        }
      }
    }
    object(expression: $branch) {
      ... on Commit {
        history(first: ${TIMELINE_PAGE_SIZE}, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            oid
            messageHeadline
            committedDate
            author {
              name
              user { login avatarUrl }
            }
            parents(first: 2) { nodes { oid } }
            associatedPullRequests(first: 3) {
              nodes {
                number
                title
                state
                mergedAt
                url
                closingIssuesReferences(first: 3) {
                  nodes { number title state url }
                }
              }
            }
          }
        }
      }
    }
  }
  rateLimit { limit cost remaining resetAt }
}`;

export type TimelineCommitAuthor = {
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type TimelineIssue = {
  number: number;
  title: string;
  state: string;
  url: string | null;
};

export type TimelinePullRequest = {
  number: number;
  title: string;
  state: string;
  mergedAt: string | null;
  url: string | null;
  /** 该 PR 关闭的 Issue（GitHub closingIssuesReferences），作为提交标注挂载。 */
  issues: TimelineIssue[];
};

export type TimelineCommit = {
  oid: string;
  headline: string;
  committedDate: string;
  author: TimelineCommitAuthor;
  parents: string[];
  pullRequests: TimelinePullRequest[];
};

export type TimelineBranch = {
  name: string;
  headOid: string | null;
  committedDate: string | null;
};

export type TimelinePageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

export type TimelineData = {
  repo: {
    nameWithOwner: string;
    description: string | null;
    isPrivate: boolean;
    defaultBranch: string | null;
  };
  branch: string | null;
  commits: TimelineCommit[];
  branches: TimelineBranch[];
  pageInfo: TimelinePageInfo;
};

// ---- 原始响应结构（全部按 unknown 防御式读取）----

type RawIssueNode = {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  url?: unknown;
};

type RawPullRequestNode = {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  mergedAt?: unknown;
  url?: unknown;
  closingIssuesReferences?: { nodes?: Array<RawIssueNode | null> | null } | null;
};

type RawCommitNode = {
  oid?: unknown;
  messageHeadline?: unknown;
  committedDate?: unknown;
  author?: { name?: unknown; user?: { login?: unknown; avatarUrl?: unknown } | null } | null;
  parents?: { nodes?: Array<{ oid?: unknown } | null> | null } | null;
  associatedPullRequests?: { nodes?: Array<RawPullRequestNode | null> | null } | null;
};

type RawTimelineResponse = {
  repository?: {
    nameWithOwner?: unknown;
    description?: unknown;
    isPrivate?: unknown;
    defaultBranchRef?: { name?: unknown } | null;
    refs?: {
      nodes?: Array<{
        name?: unknown;
        target?: { oid?: unknown; committedDate?: unknown } | null;
      } | null> | null;
    } | null;
    object?: {
      history?: {
        pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } | null;
        nodes?: Array<RawCommitNode | null> | null;
      } | null;
    } | null;
  } | null;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeIssue(raw: RawIssueNode): TimelineIssue | null {
  const number = typeof raw.number === "number" ? raw.number : null;
  if (number === null) {
    return null;
  }
  return {
    number,
    title: readString(raw.title) ?? "",
    state: readString(raw.state) ?? "UNKNOWN",
    url: readString(raw.url),
  };
}

function normalizePullRequest(raw: RawPullRequestNode): TimelinePullRequest | null {
  const number = typeof raw.number === "number" ? raw.number : null;
  if (number === null) {
    return null;
  }
  const issues = (raw.closingIssuesReferences?.nodes ?? [])
    .map((node) => (node ? normalizeIssue(node) : null))
    .filter((value): value is TimelineIssue => value !== null);
  return {
    number,
    title: readString(raw.title) ?? "",
    state: readString(raw.state) ?? "UNKNOWN",
    mergedAt: readString(raw.mergedAt),
    url: readString(raw.url),
    issues,
  };
}

function normalizeCommit(raw: RawCommitNode): TimelineCommit {
  const parents = (raw.parents?.nodes ?? [])
    .map((node) => readString(node?.oid))
    .filter((value): value is string => value !== null);
  const pullRequests = (raw.associatedPullRequests?.nodes ?? [])
    .map((node) => (node ? normalizePullRequest(node) : null))
    .filter((value): value is TimelinePullRequest => value !== null);
  return {
    oid: readString(raw.oid) ?? "",
    headline: readString(raw.messageHeadline) ?? "",
    committedDate: readString(raw.committedDate) ?? "",
    author: {
      login: readString(raw.author?.user?.login),
      name: readString(raw.author?.name),
      avatarUrl: readString(raw.author?.user?.avatarUrl),
    },
    parents,
    pullRequests,
  };
}

// 归一化 GraphQL 响应；requestedBranch 为 null 时回退到默认分支名
export function normalizeTimelineResponse(
  raw: unknown,
  requestedBranch: string | null,
): TimelineData {
  const response = (raw ?? {}) as RawTimelineResponse;
  const repository = response.repository ?? null;
  const defaultBranch = readString(repository?.defaultBranchRef?.name);

  const branches = (repository?.refs?.nodes ?? [])
    .map((node): TimelineBranch | null => {
      const name = readString(node?.name);
      if (!name) {
        return null;
      }
      return {
        name,
        headOid: readString(node?.target?.oid),
        committedDate: readString(node?.target?.committedDate),
      };
    })
    .filter((value): value is TimelineBranch => value !== null);

  const history = repository?.object?.history ?? null;
  const commits = (history?.nodes ?? [])
    .map((node) => (node ? normalizeCommit(node) : null))
    .filter((value): value is TimelineCommit => value !== null);

  return {
    repo: {
      nameWithOwner: readString(repository?.nameWithOwner) ?? "",
      description: readString(repository?.description),
      isPrivate: repository?.isPrivate === true,
      defaultBranch,
    },
    branch: requestedBranch ?? defaultBranch,
    commits,
    branches,
    pageInfo: {
      hasNextPage: history?.pageInfo?.hasNextPage === true,
      endCursor: readString(history?.pageInfo?.endCursor),
    },
  };
}

/**
 * 汇总提交关联 PR 所关闭的 Issue（按编号去重，保留首次出现顺序）。
 * D1：Issue 作为提交上的标注而非独立节点，故统一在提交维度聚合。
 */
export function collectIssues(pullRequests: TimelinePullRequest[]): TimelineIssue[] {
  const seen = new Set<number>();
  const issues: TimelineIssue[] = [];
  for (const pullRequest of pullRequests) {
    for (const issue of pullRequest.issues) {
      if (seen.has(issue.number)) {
        continue;
      }
      seen.add(issue.number);
      issues.push(issue);
    }
  }
  return issues;
}

export type FetchTimelineParams = {
  token: string;
  owner: string;
  name: string;
  branch?: string | null;
  cursor?: string | null;
  fetchImpl?: typeof fetch;
  graphql?: Partial<
    Pick<GitHubGraphQLOptions, "timeoutMs" | "maxRetries" | "retryBaseDelayMs" | "sleepImpl">
  >;
};

export type FetchTimelineResult = {
  data: TimelineData;
  rateLimit: GitHubRateLimitInfo | null;
  warnings: string[];
};

// 拉取一页时间线（默认分支用 HEAD 表达式，1 次 GraphQL 请求）
export async function fetchTimelinePage(params: FetchTimelineParams): Promise<FetchTimelineResult> {
  const result = await githubGraphQL<RawTimelineResponse>({
    token: params.token,
    query: TIMELINE_QUERY,
    variables: {
      owner: params.owner,
      name: params.name,
      branch: params.branch ?? DEFAULT_BRANCH_EXPRESSION,
      cursor: params.cursor ?? null,
    },
    fetchImpl: params.fetchImpl,
    ...params.graphql,
  });
  return {
    data: normalizeTimelineResponse(result.data, params.branch ?? null),
    rateLimit: result.rateLimit,
    warnings: result.warnings,
  };
}
