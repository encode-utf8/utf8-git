"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import type { LaneLayout } from "@utf8-git/git-graph";

import { formatRelativeTime, formatUtcDateTime, shortSha } from "@/lib/commit-format";
import { collectIssues, type TimelineCommit } from "@/lib/github-timeline";
import type { ExplainMode } from "@/lib/glossary";
import { computeHorizontalTimeline, visibleCardRange } from "@/lib/horizontal-timeline";
import { useTranslator } from "@/lib/i18n/client";
import type { MessageKey, Translate } from "@/lib/i18n/translate";
import type { TimelineDensity } from "@/lib/timeline-density";

import { GlossaryHint } from "./glossary-hint";

/** 密度 → 泳道高度 / 卡片尺寸。行高语义在横版里变成泳道高度。 */
const CARD_METRICS: Record<
  TimelineDensity,
  { laneGap: number; cardWidth: number; cardHeight: number }
> = {
  compact: { laneGap: 48, cardWidth: 116, cardHeight: 32 },
  comfy: { laneGap: 64, cardWidth: 136, cardHeight: 48 },
};

/** 标尺高度（px）：时间刻度与轴向提示。 */
const RULER_HEIGHT = 30;
/** 画布左右留白；右侧要多留出删除竖轨的宽度。 */
const PAD_LEFT = 24;
const PAD_RIGHT = 72;
const PAD_BOTTOM = 24;

export type HorizontalCanvasProps = {
  owner: string;
  name: string;
  /** 已过滤的提交（与 laneLayout.nodes 下标对齐）。 */
  commits: TimelineCommit[];
  laneLayout: LaneLayout;
  density: TimelineDensity;
  mode: ExplainMode;
  nowMs: number | null;
  selectedOid: string | null;
  /** 覆盖层（右侧删除竖轨等），由父组件持有 ref 做几何命中。 */
  overlay?: ReactNode;
  /** 变化时把视口滚到「最新」一端（切换分支 / 首次挂载）。 */
  resetKey?: string;
  /**
   * 筛选条件变化时把视口重新锚定到结果上（与旧竖向列表的「过滤后保持选中提交居中」同一语义）：
   * 选中提交仍在结果里 → 把它滚到视口中央；否则滚到最新的一条结果。
   */
  filterKey?: unknown;
  /** 把滚动容器交给父组件：提交拖拽的边缘自动滚动需要它。 */
  onScrollerChange?: (element: HTMLDivElement | null) => void;
  onSelectCommit: (commit: TimelineCommit) => void;
  onCommitPointerDown: (event: ReactPointerEvent<HTMLDivElement>, commit: TimelineCommit) => void;
  /** 滚到最旧一端（左端）时回调：触发「加载更多」。 */
  onReachOldest?: () => void;
};

/**
 * 横向时间轴画布：x = 时间（左旧右新），y = 泳道。
 *
 * 与原来的竖向列表相比，只有「滚动轴」和「行/列语义」变了：
 * 虚拟裁剪按 scrollLeft 二分，卡片仍是绝对定位，边的坐标来自 laneLayout.edges。
 */
export function HorizontalCanvas({
  owner,
  name,
  commits,
  laneLayout,
  density,
  mode,
  nowMs,
  selectedOid,
  overlay,
  resetKey,
  filterKey,
  onScrollerChange,
  onSelectCommit,
  onCommitPointerDown,
  onReachOldest,
}: HorizontalCanvasProps) {
  const { t } = useTranslator();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(1200);
  const metrics = CARD_METRICS[density];

  // 视口宽度：随容器变化更新（窗口缩放 / 侧栏折叠）
  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) {
      return;
    }
    const update = () => setViewportWidth(element.clientWidth);
    const timer = window.setTimeout(update, 0);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  const times = useMemo(
    () => commits.map((commit) => (commit.committedDate ? Date.parse(commit.committedDate) : null)),
    [commits],
  );
  const lanes = useMemo(
    () => commits.map((_, index) => laneLayout.nodes[index]?.lane ?? 0),
    [commits, laneLayout.nodes],
  );

  const layout = useMemo(
    () =>
      computeHorizontalTimeline({
        lanes,
        times: times.map((time) => (time !== null && Number.isFinite(time) ? time : null)),
        laneCount: Math.max(1, laneLayout.laneCount),
        cardWidth: metrics.cardWidth,
        cardGap: 12,
        laneGap: metrics.laneGap,
        padLeft: PAD_LEFT,
        padRight: PAD_RIGHT,
        // 泳道 0 的卡片顶边 = RULER_HEIGHT + 8 + 卡片半高，不与标尺相贴
        padTop: RULER_HEIGHT + 8 + metrics.cardHeight / 2,
        padBottom: PAD_BOTTOM,
      }),
    [lanes, times, laneLayout.laneCount, metrics.cardWidth, metrics.cardHeight, metrics.laneGap],
  );

  const range = useMemo(
    () => visibleCardRange(layout, scrollLeft, viewportWidth, metrics.cardWidth, 2),
    [layout, scrollLeft, viewportWidth, metrics.cardWidth],
  );
  // order 按 x 升序（最旧在前）；渲染时反转，让最新提交排在最前——
  // 一是 Tab / 读屏顺序与旧竖向列表一致（先遇见最新的），
  // 二是「列表里第一个按钮」仍是最新提交，E2E 与用户预期都不变。
  const visible = useMemo(
    () => layout.order.slice(range.start, range.end).reverse(),
    [layout.order, range.start, range.end],
  );

  // 把滚动容器暴露给父组件（提交拖拽的边缘自动滚动要用）
  const setScroller = useCallback(
    (element: HTMLDivElement | null) => {
      scrollerRef.current = element;
      onScrollerChange?.(element);
    },
    [onScrollerChange],
  );

  // 首次挂载 / 切换分支：滚到最新一端（右端）。
  // 依赖里带 layout.width：切换分支后提交是异步换的，布局宽度会再变一次，
  // 那时补滚一次，避免「新分支的数据到了但视口还在旧位置」。
  const scrollToEndRef = useRef(true);
  useEffect(() => {
    scrollToEndRef.current = true;
  }, [resetKey]);
  useEffect(() => {
    if (!scrollToEndRef.current) {
      return;
    }
    const element = scrollerRef.current;
    if (!element || element.scrollWidth <= element.clientWidth) {
      return;
    }
    element.scrollLeft = element.scrollWidth;
    scrollToEndRef.current = false;
  }, [resetKey, layout.width]);

  // 把指定的提交滚到视口中央；不在当前结果里就回到「最旧的一段」——
  // 筛选后的结果通常要通读，从最早的一条开始符合阅读方向
  const centerCommit = useCallback(
    (oid: string | null) => {
      const element = scrollerRef.current;
      if (!element) {
        return;
      }
      const maxScroll = Math.max(0, layout.width - element.clientWidth);
      const index = oid === null ? -1 : commits.findIndex((commit) => commit.oid === oid);
      if (index >= 0) {
        const target = layout.x[index] - element.clientWidth / 2;
        element.scrollLeft = Math.max(0, Math.min(target, maxScroll));
        return;
      }
      const oldest = layout.order[0];
      element.scrollLeft =
        oldest === undefined ? 0 : Math.max(0, Math.min(layout.x[oldest] - 24, maxScroll));
    },
    [commits, layout],
  );

  // 选中的提交发生变化（点选）时，把它滚进视口中央
  const lastSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedOid || selectedOid === lastSelectedRef.current) {
      return;
    }
    lastSelectedRef.current = selectedOid;
    centerCommit(selectedOid);
  }, [selectedOid, centerCommit]);

  // 筛选条件变化时重新锚定：沿用旧竖向列表的语义——选中提交还在就居中它，
  // 否则回到结果起点。与 resetKey（切分支 → 滚到最新端）是两条不同的路径。
  //
  // 三个刻意的设计：
  // 1. 依赖只有 filterKey——centerCommit / selectedOid 的身份会随「加载更多」变化，
  //    把它们写进依赖会让翻页也触发重锚，视口被强行拽走；
  // 2. 首次挂载跳过：那一次的定位归 resetKey 管（滚到最新端）；
  // 3. 函数与选中态经 ref 读取：触发时用的总是当次渲染里最新的布局。
  const anchorRef = useRef({ center: centerCommit, oid: selectedOid });
  useEffect(() => {
    anchorRef.current = { center: centerCommit, oid: selectedOid };
  });
  const anchorArmedRef = useRef(false);
  useEffect(() => {
    if (!anchorArmedRef.current) {
      anchorArmedRef.current = true;
      return;
    }
    anchorRef.current.center(anchorRef.current.oid);
  }, [filterKey]);

  // 滚到最旧一端（左端）→ 请求加载更多
  const reachOldestRef = useRef(onReachOldest);
  useEffect(() => {
    reachOldestRef.current = onReachOldest;
  }, [onReachOldest]);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    setScrollLeft(element.scrollLeft);
    if (element.scrollLeft < 240) {
      reachOldestRef.current?.();
    }
  }, []);

  // 只画与可见卡片相关的边：跨越视口的长边也会被保留（端点之一可见即可）
  const edges = useMemo(() => {
    if (laneLayout.edges.length === 0 || visible.length === 0) {
      return [];
    }
    const visibleSet = new Set(visible);
    return laneLayout.edges.filter(
      (edge) => visibleSet.has(edge.fromRow) || (edge.toRow !== null && visibleSet.has(edge.toRow)),
    );
  }, [laneLayout.edges, visible]);

  const ticks = useMemo(
    () =>
      layout.ticks.filter(
        (tick) => tick.x >= scrollLeft - 80 && tick.x <= scrollLeft + viewportWidth + 80,
      ),
    [layout.ticks, scrollLeft, viewportWidth],
  );

  return (
    <div className="relative mt-3">
      <div
        ref={setScroller}
        onScroll={handleScroll}
        role="list"
        aria-label={t("timeline.listLabel")}
        className="max-h-[65vh] overflow-auto overscroll-contain rounded-xl border border-black/[.08] bg-white dark:border-white/[.145] dark:bg-zinc-950"
        style={{ height: Math.min(layout.height + 2, 520) }}
      >
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          {/* 时间标尺：sticky 在顶部，纵向滚动（泳道很多）时仍然可见 */}
          <div
            className="sticky top-0 z-20 border-b border-dashed border-black/[.12] bg-white/95 backdrop-blur-sm dark:border-white/[.16] dark:bg-zinc-950/95"
            style={{ height: RULER_HEIGHT }}
          >
            {ticks.map((tick) => (
              <div
                key={tick.time}
                className="absolute bottom-0 top-0 border-l border-black/[.08] dark:border-white/[.1]"
                style={{ left: tick.x }}
              >
                <span className="absolute left-1.5 top-1.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                  {formatUtcDateTime(new Date(tick.time).toISOString()).slice(0, 10)}
                </span>
              </div>
            ))}
            <span className="absolute right-2 top-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
              {t("timeline.axisNewest")}
            </span>
            <span className="absolute left-2 top-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
              {t("timeline.axisOldest")}
            </span>
          </div>

          {/* 泳道轨 + 父子曲线 */}
          <svg
            className="absolute left-0 top-0"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            {layout.laneY.map((y, lane) => (
              <line
                key={`rail-${lane}`}
                x1={0}
                x2={layout.width}
                y1={y}
                y2={y}
                stroke={laneColor(lane)}
                strokeOpacity={0.16}
                strokeWidth={2}
                strokeLinecap="round"
              />
            ))}
            {edges.map((edge) => {
              const child = edge.fromRow;
              const parent = edge.toRow;
              if (parent === null) {
                return null;
              }
              return (
                <path
                  key={`${edge.fromOid}-${edge.toOid}`}
                  d={edgePath(layout.x[child], layout.y[child], layout.x[parent], layout.y[parent])}
                  fill="none"
                  stroke={edge.color}
                  strokeWidth={2}
                  strokeOpacity={0.55}
                  strokeLinecap="round"
                />
              );
            })}
          </svg>

          {/* 提交卡片 */}
          {visible.map((index) => {
            const commit = commits[index];
            if (!commit) {
              return null;
            }
            return (
              <CommitCard
                key={commit.oid}
                commit={commit}
                index={index}
                x={layout.x[index]}
                y={layout.y[index]}
                width={metrics.cardWidth}
                height={metrics.cardHeight}
                lane={lanes[index] ?? 0}
                mode={mode}
                nowMs={nowMs}
                selected={commit.oid === selectedOid}
                repoUrl={`https://github.com/${owner}/${name}`}
                onSelect={onSelectCommit}
                onPointerDown={onCommitPointerDown}
              />
            );
          })}
        </div>
      </div>
      {overlay}
    </div>
  );
}

const PR_STATE_LABEL: Record<string, MessageKey> = {
  OPEN: "timeline.prState.open",
  MERGED: "timeline.prState.merged",
  CLOSED: "timeline.prState.closed",
};

function prStateLabel(state: string, t: Translate): string {
  const key = PR_STATE_LABEL[state];
  return key ? t(key) : state;
}

function prBadgeClass(state: string): string {
  if (state === "MERGED") {
    return "border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-200";
  }
  if (state === "OPEN") {
    return "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200";
  }
  return "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
}

const ISSUE_STATE_LABEL: Record<string, MessageKey> = {
  OPEN: "timeline.issueState.open",
  CLOSED: "timeline.issueState.closed",
};

function issueStateLabel(state: string, t: Translate): string {
  const key = ISSUE_STATE_LABEL[state];
  return key ? t(key) : state;
}

function issueBadgeClass(state: string): string {
  if (state === "OPEN") {
    return "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200";
  }
  return "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
}

/** 泳道配色：与竖向泳道图保持同一套。 */
function laneColor(lane: number): string {
  const palette = ["#378add", "#1d9e75", "#ba7517", "#7f77dd", "#d4537e"];
  return palette[lane % palette.length];
}

/** 子提交 → 父提交的 S 形曲线（时间向左，纵向跨泳道）。 */
function edgePath(childX: number, childY: number, parentX: number, parentY: number): string {
  const dx = Math.max(24, Math.abs(childX - parentX) * 0.42);
  const startX = childX - 2;
  const endX = parentX + 2;
  return `M ${startX} ${childY} C ${startX - dx} ${childY}, ${endX + dx} ${parentY}, ${endX} ${parentY}`;
}

function CommitCard({
  commit,
  index,
  x,
  y,
  width,
  height,
  lane,
  mode,
  nowMs,
  selected,
  repoUrl,
  onSelect,
  onPointerDown,
}: {
  commit: TimelineCommit;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  lane: number;
  mode: ExplainMode;
  nowMs: number | null;
  selected: boolean;
  repoUrl: string;
  onSelect: (commit: TimelineCommit) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, commit: TimelineCommit) => void;
}) {
  const { t } = useTranslator();
  const authorLabel = commit.author.login ?? commit.author.name ?? t("timeline.unknownAuthor");
  const issues = collectIssues(commit.pullRequests);
  const timeLabel = commit.committedDate
    ? nowMs === null
      ? formatUtcDateTime(commit.committedDate)
      : formatRelativeTime(Date.parse(commit.committedDate), nowMs, t)
    : "—";

  return (
    <div
      role="listitem"
      data-index={index}
      onPointerDown={(event) => onPointerDown(event, commit)}
      style={{ left: x, top: y - height / 2, width, height }}
      className={[
        "absolute flex select-none flex-col justify-center gap-0.5 rounded-lg border bg-white px-2 pl-2.5 text-left shadow-sm transition-shadow dark:bg-zinc-900",
        selected
          ? "border-sky-500 ring-2 ring-sky-500/25"
          : "border-black/[.12] hover:shadow-md dark:border-white/[.16]",
        "cursor-grab active:cursor-grabbing",
      ].join(" ")}
    >
      {/* 整卡可点：遮罩按钮负责选中；内容层 pointer-events-none，链接单独放开 */}
      <button
        type="button"
        onClick={() => onSelect(commit)}
        aria-label={t("timeline.viewCommitDetail", { sha: shortSha(commit.oid) })}
        className="absolute inset-0 z-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-600"
      />
      <span className="pointer-events-none relative z-10 truncate text-[11px] font-medium text-zinc-900 dark:text-zinc-50">
        {commit.headline || t("timeline.noHeadline")}
      </span>
      <span className="pointer-events-none relative z-10 flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
        <span className="truncate">{authorLabel}</span>
        <GlossaryHint id="author" mode={mode} />
        <code className="font-mono">{shortSha(commit.oid)}</code>
        <GlossaryHint id="sha" mode={mode} />
        <span className="ml-auto shrink-0">{timeLabel}</span>
      </span>

      {/* 徽标：合并 / PR / Issue，压在卡片右上角 */}
      <span className="absolute -top-2 right-1.5 z-10 flex items-center gap-1">
        {commit.parents.length > 1 ? (
          <span className="rounded-full border border-orange-300 bg-orange-50 px-1.5 text-[9px] leading-4 text-orange-800 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200">
            merge
          </span>
        ) : null}
        {commit.pullRequests.map((pullRequest) => (
          <a
            key={`pr-${pullRequest.number}`}
            href={pullRequest.url ?? `${repoUrl}/pull/${pullRequest.number}`}
            target="_blank"
            rel="noopener noreferrer"
            title={pullRequest.title}
            className={`pointer-events-auto rounded-full border bg-white px-1.5 text-[9px] leading-4 underline-offset-2 hover:underline dark:bg-zinc-900 ${prBadgeClass(pullRequest.state)}`}
          >
            #{pullRequest.number} {prStateLabel(pullRequest.state, t)}
          </a>
        ))}
        {issues.map((issue) => (
          <a
            key={`issue-${issue.number}`}
            href={issue.url ?? `${repoUrl}/issues/${issue.number}`}
            target="_blank"
            rel="noopener noreferrer"
            title={t("timeline.issueLinkTitle", { title: issue.title })}
            className={`pointer-events-auto rounded-full border bg-white px-1.5 text-[9px] leading-4 underline-offset-2 hover:underline dark:bg-zinc-900 ${issueBadgeClass(issue.state)}`}
          >
            #{issue.number} {issueStateLabel(issue.state, t)}
          </a>
        ))}
      </span>

      {/* 泳道色点：贴在卡片左边缘，落在泳道轨上 */}
      <span
        aria-hidden="true"
        className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-zinc-900"
        style={{ background: laneColor(lane) }}
      />
    </div>
  );
}
