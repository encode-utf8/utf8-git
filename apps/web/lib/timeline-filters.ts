// 时间线即时过滤（纯函数，便于单测与复用）。
// 数据已在客户端（当前已加载的提交），因此过滤为纯内存操作，可实时反馈。

import type { TimelineCommit } from "./github-timeline";

/** 事件类型过滤：全部 / 仅合并提交 / 仅关联 PR / 仅关联 Issue。 */
export type TimelineEventKind = "all" | "merge" | "pullRequest" | "issue";

export type TimelineFilterState = {
  /** 关键词：匹配提交标题、SHA、作者（大小写不敏感）。 */
  query: string;
  /** 作者过滤（登录名或名称）；空串表示全部。 */
  author: string;
  /** 事件类型过滤。 */
  kind: TimelineEventKind;
};

export const EMPTY_TIMELINE_FILTER: TimelineFilterState = {
  query: "",
  author: "",
  kind: "all",
};

export function hasActiveTimelineFilter(state: TimelineFilterState): boolean {
  return state.query.trim().length > 0 || state.author.length > 0 || state.kind !== "all";
}

/** 作者展示名：登录名优先，其次名称（与时间线行一致）；未知作者返回空串。 */
export function authorLabelOf(commit: TimelineCommit): string {
  return commit.author.login ?? commit.author.name ?? "";
}

/** 收集已加载提交里的作者（去重、保留首次出现顺序，忽略未知作者）。 */
export function timelineAuthors(commits: TimelineCommit[]): string[] {
  const seen = new Set<string>();
  const authors: string[] = [];
  for (const commit of commits) {
    const label = authorLabelOf(commit);
    if (!label || seen.has(label)) {
      continue;
    }
    seen.add(label);
    authors.push(label);
  }
  return authors;
}

function matchesKind(commit: TimelineCommit, kind: TimelineEventKind): boolean {
  if (kind === "all") {
    return true;
  }
  if (kind === "merge") {
    return commit.parents.length > 1;
  }
  if (kind === "pullRequest") {
    return commit.pullRequests.length > 0;
  }
  return commit.pullRequests.some((pullRequest) => pullRequest.issues.length > 0);
}

/** 关键词 + 作者 + 事件类型叠加过滤（各条件取交集）。 */
export function filterTimelineCommits(
  commits: TimelineCommit[],
  state: TimelineFilterState,
): TimelineCommit[] {
  const query = state.query.trim().toLowerCase();
  return commits.filter((commit) => {
    if (state.author && authorLabelOf(commit) !== state.author) {
      return false;
    }
    if (!matchesKind(commit, state.kind)) {
      return false;
    }
    if (!query) {
      return true;
    }
    return (
      commit.headline.toLowerCase().includes(query) ||
      commit.oid.toLowerCase().includes(query) ||
      authorLabelOf(commit).toLowerCase().includes(query)
    );
  });
}
