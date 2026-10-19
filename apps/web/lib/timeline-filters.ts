// 时间线即时过滤（纯函数，便于单测与复用）。
// 数据已在客户端（当前已加载的提交），因此过滤为纯内存操作，可实时反馈。

import type { TimelineCommit } from "./github-timeline";

/** 事件类型过滤：全部 / 仅合并提交 / 仅关联 PR / 仅关联 Issue。 */
export type TimelineEventKind = "all" | "merge" | "pullRequest" | "issue";

/** 时间范围：全部 / 近一周 / 近一月（相对当前时刻）/ 自定义时间窗（时间刷子拖出来的区间）。 */
export type TimelineRange = "all" | "week" | "month" | "custom";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<Exclude<TimelineRange, "all" | "custom">, number> = {
  week: 7,
  month: 30,
};

/** 自定义时间窗（毫秒时间戳，闭区间）。 */
export type TimelineWindow = { from: number; to: number };

export type TimelineFilterState = {
  /** 关键词：匹配提交标题、SHA、作者（大小写不敏感）。 */
  query: string;
  /** 作者过滤（登录名或名称）；空串表示全部。 */
  author: string;
  /** 事件类型过滤。 */
  kind: TimelineEventKind;
  /** 时间范围过滤（相对 now）；custom 时由 window 决定区间。 */
  range: TimelineRange;
  /** 时间刷子拖出的自定义窗口；null 表示未启用。 */
  window: TimelineWindow | null;
};

export const EMPTY_TIMELINE_FILTER: TimelineFilterState = {
  query: "",
  author: "",
  kind: "all",
  range: "all",
  window: null,
};

export function hasActiveTimelineFilter(state: TimelineFilterState): boolean {
  // custom 且没有窗口时并不裁剪任何提交（见 withinRange），因此不算「已激活」
  const rangeActive = state.range === "custom" ? state.window !== null : state.range !== "all";
  return (
    state.query.trim().length > 0 ||
    state.author.length > 0 ||
    state.kind !== "all" ||
    rangeActive ||
    state.window !== null
  );
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

/**
 * 提交是否落在相对 nowMs 的时间范围内。
 * nowMs 为 null（时间基准未就绪，如 SSR / 首帧）时不做裁剪；时间戳非法时视为范围外。
 */
function withinRange(
  commit: TimelineCommit,
  state: TimelineFilterState,
  nowMs: number | null,
): boolean {
  const { range, window } = state;
  if (range === "all") {
    return true;
  }
  const committedAt = Date.parse(commit.committedDate);
  if (!Number.isFinite(committedAt)) {
    return false;
  }
  // 自定义窗口不依赖 now，SSR 首帧也能给出稳定的过滤结果
  if (range === "custom") {
    if (window === null) {
      // 没有窗口就不裁剪（防御：不该出现，但别变成「全空」）
      return true;
    }
    // 容忍两端顺序被调换
    const low = Math.min(window.from, window.to);
    const high = Math.max(window.from, window.to);
    return committedAt >= low && committedAt <= high;
  }
  if (nowMs === null) {
    return true;
  }
  return committedAt >= nowMs - RANGE_DAYS[range] * DAY_MS;
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

/** 关键词 + 作者 + 事件类型 + 时间范围叠加过滤（各条件取交集）。nowMs 可显式注入以便测试。 */
export function filterTimelineCommits(
  commits: TimelineCommit[],
  state: TimelineFilterState,
  nowMs: number | null = null,
): TimelineCommit[] {
  const query = state.query.trim().toLowerCase();
  return commits.filter((commit) => {
    if (!withinRange(commit, state, nowMs)) {
      return false;
    }
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

/** oid 在列表中的行号；不在列表（或 oid 为空）时返回 -1。缩放后用于把选中提交重新锚定到视口。 */
export function indexOfCommit(commits: TimelineCommit[], oid: string | null): number {
  if (!oid) {
    return -1;
  }
  return commits.findIndex((commit) => commit.oid === oid);
}
