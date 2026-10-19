// 时间线视图状态的分享编解码（纯函数）：分支 + 筛选 + 密度 + 解释模式 ↔ URL 查询串。
//
// 两条原则：
// 1. 只编码「有值」的字段——默认状态得到干净的 URL（/repos/o/n，不带 ?）；
// 2. 解码只认白名单值——URL 是外部输入，非法值一律丢弃，绝不让它决定出奇怪的界面状态。

import { isExplainMode, type ExplainMode } from "./glossary";
import {
  DEFAULT_TIMELINE_DENSITY,
  isTimelineDensity,
  type TimelineDensity,
} from "./timeline-density";
import {
  EMPTY_TIMELINE_FILTER,
  type TimelineEventKind,
  type TimelineFilterState,
  type TimelineRange,
} from "./timeline-filters";

export type TimelineShareState = {
  branch: string | null;
  filters: TimelineFilterState;
  density: TimelineDensity;
  explain: ExplainMode;
};

/** 解码结果：只包含 URL 里真正给出的字段，调用方按需合并。 */
export type TimelineSharePatch = {
  branch: string | null;
  filters?: Partial<TimelineFilterState>;
  density?: TimelineDensity;
  explain?: ExplainMode;
};

const EVENT_KINDS: readonly string[] = ["all", "merge", "pullRequest", "issue"];
const RANGES: readonly string[] = ["all", "week", "month", "custom"];
/** 文本类参数的长度上限：URL 不是输入框，超长的一律截断而不是拒绝整条链接。 */
const MAX_TEXT = 200;
/** 分支名的合理上限（GitHub 侧为 255）。 */
const MAX_BRANCH = 255;

function cleanText(value: string | null): string {
  return (value ?? "").slice(0, MAX_TEXT).trim();
}

function parseTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.trunc(parsed);
}

/** 视图状态 → 查询串（默认值不写，保持链接短）。 */
export function encodeTimelineShare(state: TimelineShareState): URLSearchParams {
  const params = new URLSearchParams();
  const { filters } = state;

  if (state.branch) {
    params.set("branch", state.branch);
  }
  const query = filters.query.trim();
  if (query) {
    params.set("q", query);
  }
  if (filters.author) {
    params.set("author", filters.author);
  }
  if (filters.kind !== "all") {
    params.set("kind", filters.kind);
  }
  if (filters.range !== "all") {
    params.set("range", filters.range);
  }
  if (filters.window) {
    params.set("from", String(filters.window.from));
    params.set("to", String(filters.window.to));
  }
  if (state.density !== DEFAULT_TIMELINE_DENSITY) {
    params.set("density", state.density);
  }
  if (state.explain !== "off") {
    params.set("explain", state.explain);
  }
  return params;
}

/**
 * 查询串 → 视图状态补丁。
 * - `from` / `to` 同时有效才生成自定义窗口（并强制 range=custom，容忍两端顺序颠倒）；
 * - 只有 range=custom 但没有窗口时丢弃 custom（那本来就不裁剪任何提交）。
 */
export function decodeTimelineShare(params: URLSearchParams): TimelineSharePatch {
  const filters: Partial<TimelineFilterState> = {};

  const query = cleanText(params.get("q"));
  if (query) {
    filters.query = query;
  }
  const author = cleanText(params.get("author"));
  if (author) {
    filters.author = author;
  }
  const kind = params.get("kind");
  if (kind && EVENT_KINDS.includes(kind)) {
    filters.kind = kind as TimelineEventKind;
  }

  const from = parseTimestamp(params.get("from"));
  const to = parseTimestamp(params.get("to"));
  if (from !== null && to !== null) {
    filters.window = { from: Math.min(from, to), to: Math.max(from, to) };
    filters.range = "custom";
  } else {
    const range = params.get("range");
    if (range && RANGES.includes(range) && range !== "custom") {
      filters.range = range as TimelineRange;
    }
  }

  const branchValue = cleanText(params.get("branch")).slice(0, MAX_BRANCH);
  const densityValue = params.get("density");
  const explainValue = params.get("explain");

  return {
    branch: branchValue || null,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    density: isTimelineDensity(densityValue) ? densityValue : undefined,
    explain: explainValue && isExplainMode(explainValue) ? explainValue : undefined,
  };
}

/** 用解码补丁覆盖默认筛选状态（只覆盖 URL 给出的字段）。 */
export function mergeShareFilters(
  patch: Partial<TimelineFilterState> | undefined,
): TimelineFilterState {
  return { ...EMPTY_TIMELINE_FILTER, ...patch };
}
