"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  LaneComputation,
  sliceLaneLayout,
  type CommitLike,
  type LaneLayout,
} from "@utf8-git/git-graph";

import {
  createBranchDescriptor,
  describeCreateBranchFailure,
  validateBranchName,
} from "@/lib/branch-ops";
import { formatRelativeTime, formatUtcDateTime, shortSha } from "@/lib/commit-format";
import { mergeCommits } from "@/lib/commit-list";
import { fetchJsonWithRetry, fetchWithRetry } from "@/lib/client-fetch";
import { OnlineRequestError, describeApiFailure, type OnlineErrorInfo } from "@/lib/error-state";
import { collectIssues, type TimelineBranch, type TimelineCommit } from "@/lib/github-timeline";
import { EXPLAIN_MODES, isExplainMode, type ExplainMode } from "@/lib/glossary";
import { useTranslator } from "@/lib/i18n/client";
import type { MessageKey, Translate } from "@/lib/i18n/translate";
import { computeLaneMetrics } from "@/lib/lane-geometry";
import { confirmationView } from "@/lib/operations";
import {
  EMPTY_TIMELINE_FILTER,
  filterTimelineCommits,
  hasActiveTimelineFilter,
  indexOfCommit,
  timelineAuthors,
  type TimelineEventKind,
  type TimelineRange,
  type TimelineFilterState,
} from "@/lib/timeline-filters";
import {
  DEFAULT_TIMELINE_DENSITY,
  TIMELINE_DENSITIES,
  TIMELINE_DENSITY_STORAGE_KEY,
  parseTimelineDensity,
  timelineRowHeight,
  type TimelineDensity,
} from "@/lib/timeline-density";
import { computeVirtualWindow } from "@/lib/virtual-window";

import { BranchBar, type DragPoint } from "./branch-bar";
import { TimeBrush } from "./time-brush";
import { BranchPopover } from "./branch-popover";
import { CommitDetailPanel } from "./commit-detail";
import { ConceptNote } from "./concept-note";
import { ConfirmCard } from "./confirm-card";
import { CreateIssuePanel } from "./create-issue-panel";
import { CreatePullPanel } from "./create-pull-panel";
import { DeleteBranchPanel } from "./delete-branch-panel";
import { GlossaryHint } from "./glossary-hint";
import { LaneGraph } from "./lane-graph";
import { RestoreBranchPanel } from "./restore-branch-panel";

const AUTO_LOAD_THRESHOLD = 8;
const EXPLAIN_MODE_STORAGE_KEY = "utf8-git:explain-mode";
// 拖拽判定阈值：超过它才算「拖动」，否则仍按一次点击处理（与分支芯片一致）
const COMMIT_DRAG_THRESHOLD = 8;

// 泳道布局回填走 layout effect：同帧内生效，不会出现「先渲染无泳道、下一帧才有」的闪帧；
// 服务端渲染时退化为 useEffect（避免 useLayoutEffect 的 SSR 告警）。
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// 布局尚未计算（深页首帧、集合为空）时的占位布局。
const EMPTY_LANE_LAYOUT: LaneLayout = {
  nodes: [],
  segments: [],
  edges: [],
  laneCount: 0,
};

type TimelinePageResponse = {
  commits: TimelineCommit[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  /** 仅首页下发：服务端算好并缓存的泳道布局（TODO-246） */
  laneLayout?: LaneLayout | null;
};

type TimelineViewProps = {
  owner: string;
  name: string;
  initialCommits: TimelineCommit[];
  initialHasNextPage: boolean;
  initialBranch: string | null;
  branches: TimelineBranch[];
  defaultBranch: string | null;
  /** 服务端下发的首页泳道布局（TODO-246，内容指纹缓存）；null 时客户端自行计算 */
  initialLaneLayout?: LaneLayout | null;
};

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

function CommitRow({
  commit,
  nowMs,
  mode,
  repoUrl,
  compact,
  onSelect,
}: {
  commit: TimelineCommit;
  nowMs: number | null;
  mode: ExplainMode;
  repoUrl: string;
  /** 紧凑密度：单行、不显示头像；舒适密度保留两行与头像。 */
  compact: boolean;
  onSelect: (commit: TimelineCommit) => void;
}) {
  const { t } = useTranslator();
  const authorLabel = commit.author.login ?? commit.author.name ?? t("timeline.unknownAuthor");
  const issues = collectIssues(commit.pullRequests);
  const timeLabel = commit.committedDate
    ? nowMs === null
      ? formatUtcDateTime(commit.committedDate)
      : formatRelativeTime(Date.parse(commit.committedDate), nowMs, t)
    : "—";

  // 徽标与概念提示在两种密度下共用，避免两套实现走偏
  const badges = (
    <>
      {commit.parents.length > 1 ? (
        <>
          <span className="shrink-0 rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] text-orange-800 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200">
            merge
          </span>
          <GlossaryHint id="merge" mode={mode} />
        </>
      ) : null}
      {commit.pullRequests.map((pullRequest) => (
        <a
          key={`pr-${pullRequest.number}`}
          href={pullRequest.url ?? `${repoUrl}/pull/${pullRequest.number}`}
          target="_blank"
          rel="noopener noreferrer"
          title={pullRequest.title}
          className={`pointer-events-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px] underline-offset-4 hover:underline ${prBadgeClass(pullRequest.state)}`}
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
          className={`pointer-events-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px] underline-offset-4 hover:underline ${issueBadgeClass(issue.state)}`}
        >
          #{issue.number} {issueStateLabel(issue.state, t)}
        </a>
      ))}
      {commit.pullRequests.length > 0 ? <GlossaryHint id="pull-request" mode={mode} /> : null}
      {issues.length > 0 ? <GlossaryHint id="issue" mode={mode} /> : null}
    </>
  );

  return (
    <div className="relative h-full w-full border-b border-black/[.06] dark:border-white/[.08]">
      {/* 整行可点：遮罩按钮负责选中；内容层 pointer-events-none，链接再单独放开 */}
      <button
        type="button"
        onClick={() => onSelect(commit)}
        aria-label={t("timeline.viewCommitDetail", { sha: shortSha(commit.oid) })}
        className="absolute inset-0 z-0 transition-colors hover:bg-black/[.03] focus-visible:bg-black/[.04] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-600 dark:hover:bg-white/[.05] dark:focus-visible:outline-sky-400"
      />
      {compact ? (
        // 紧凑：单行。行高只有 36px，塞不下头像与第二行，强行复用两行布局会互相压住
        <div className="pointer-events-none relative z-10 flex h-full w-full items-center gap-2 px-4">
          <span className="min-w-0 truncate text-xs font-medium text-zinc-900 dark:text-zinc-50">
            {commit.headline || t("timeline.noHeadline")}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">{badges}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="max-w-[7rem] truncate">{authorLabel}</span>
            {/* 概念提示在两种密度下都要在：新手模式的说明不能因为切换密度就消失 */}
            <GlossaryHint id="author" mode={mode} />
            <code className="font-mono">{shortSha(commit.oid)}</code>
            <GlossaryHint id="sha" mode={mode} />
            <time
              suppressHydrationWarning
              title={`${formatUtcDateTime(commit.committedDate)}${t("common.utcSuffix")}`}
            >
              {timeLabel}
            </time>
          </span>
        </div>
      ) : (
        <div className="pointer-events-none relative z-10 flex h-full w-full items-start gap-3 px-4 py-2">
          {commit.author.avatarUrl ? (
            <Image
              src={commit.author.avatarUrl}
              alt=""
              width={28}
              height={28}
              className="mt-0.5 h-7 w-7 shrink-0 rounded-full"
            />
          ) : (
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {authorLabel.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {commit.headline || t("timeline.noHeadline")}
              </span>
              {badges}
            </span>
            <span className="mt-1 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="truncate">{authorLabel}</span>
              <GlossaryHint id="author" mode={mode} />
              <span>·</span>
              <code className="font-mono">{shortSha(commit.oid)}</code>
              <GlossaryHint id="sha" mode={mode} />
              <span>·</span>
              <time
                suppressHydrationWarning
                title={`${formatUtcDateTime(commit.committedDate)}${t("common.utcSuffix")}`}
              >
                {timeLabel}
              </time>
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

export function TimelineView({
  owner,
  name,
  initialCommits,
  initialHasNextPage,
  initialBranch,
  branches,
  defaultBranch,
  initialLaneLayout,
}: TimelineViewProps) {
  const { t } = useTranslator();
  const [commits, setCommits] = useState(initialCommits);
  const [hasNextPage, setHasNextPage] = useState(initialHasNextPage);
  const [page, setPage] = useState(1);
  const [branch, setBranch] = useState(initialBranch);
  // 第 1 页由服务端渲染、未指定分支参数；分页请求必须沿用同样的「不传分支」，
  // 否则服务端的游标链 key（user / owner / name / branch）不一致，会返回 409 cursor_expired。
  // 用户手动切换分支后，这里同步为具体分支名。
  const [branchParam, setBranchParam] = useState<string | null>(null);
  // 切换分支时服务端随第 1 页下发的泳道布局（TODO-246）；未切换时为 null，回落到 SSR 下发的初始布局
  const [fetchedLaneLayout, setFetchedLaneLayout] = useState<LaneLayout | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<OnlineErrorInfo | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<TimelineCommit | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [filters, setFilters] = useState<TimelineFilterState>(EMPTY_TIMELINE_FILTER);
  const [explainMode, setExplainMode] = useState<ExplainMode>("off");
  const [createOpen, setCreateOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueSuccess, setIssueSuccess] = useState<string | null>(null);
  // 新建 PR 面板：null = 关闭；{head, base} = 打开（按钮路径给空串，手势路径带预填）
  const [pullPreset, setPullPreset] = useState<{ head: string; base: string } | null>(null);
  const [pullSuccess, setPullSuccess] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);

  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 画布容器（拖拽落点坐标、删除区命中判定都相对它计算）
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const trashRef = useRef<HTMLDivElement | null>(null);
  // 拖动结束后浏览器仍会补发 click：用它把这次 click 吞掉，避免「拖完顺带打开了详情」
  const suppressRowClickRef = useRef(false);

  // 显示密度（P0 画布改造）：只改行高，虚拟窗口按行高换算，布局算法不变
  const [density, setDensity] = useState<TimelineDensity>(DEFAULT_TIMELINE_DENSITY);
  const rowHeight = timelineRowHeight(density);

  // 分支芯片拖动：拖到删除区即删除该分支（删除仍走确认面板，不静默执行）
  const [branchDrag, setBranchDrag] = useState<{
    name: string;
    point: DragPoint;
    /** 指针当前悬停的另一个分支芯片（松手即「从 name 向 target 开 PR」）。 */
    target: string | null;
  } | null>(null);
  const [branchDragOverTrash, setBranchDragOverTrash] = useState(false);

  // 提交节点拖动：拖动中显示跟手 ghost，松手后在落点弹出就地命名气泡
  const [commitDrag, setCommitDrag] = useState<{ commit: TimelineCommit; point: DragPoint } | null>(
    null,
  );
  const [naming, setNaming] = useState<{
    commit: TimelineCommit;
    left: number;
    top: number;
    value: string;
    error: string | null;
  } | null>(null);
  const [namingPending, setNamingPending] = useState(false);
  // 由拖拽删除带进确认面板的预选分支（按钮路径为 null，沿用面板自己的默认候选）
  const [deleteInitialBranch, setDeleteInitialBranch] = useState<string | null>(null);

  // 打开任写操作面板时清掉上一次的成功提示，避免旧横幅误导当前操作
  const resetOperationAlerts = useCallback(() => {
    setCreateSuccess(null);
    setIssueSuccess(null);
    setPullSuccess(null);
    setDeleteSuccess(null);
    setRestoreSuccess(null);
  }, []);

  // 概念解释层：默认关闭，仅记住用户显式选择过的模式（localStorage 不可用时静默降级）。
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(EXPLAIN_MODE_STORAGE_KEY);
    } catch {
      // 隐私模式 / 禁用存储：保持默认关闭
    }
    if (!stored || !isExplainMode(stored)) {
      return;
    }
    const mode = stored;
    // 延迟到宏任务触发，避免在 effect 内同步 setState（react-hooks/set-state-in-effect）
    const timer = window.setTimeout(() => setExplainMode(mode), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const changeExplainMode = useCallback((next: ExplainMode) => {
    setExplainMode(next);
    try {
      window.localStorage.setItem(EXPLAIN_MODE_STORAGE_KEY, next);
    } catch {
      // 忽略写入失败
    }
  }, []);

  // 显示密度：与解释模式同一套约定——只记住用户显式选择过的档位，读不到就用默认
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(TIMELINE_DENSITY_STORAGE_KEY);
    } catch {
      // 隐私模式 / 禁用存储：保持默认密度
    }
    const next = parseTimelineDensity(stored);
    if (next === DEFAULT_TIMELINE_DENSITY) {
      return;
    }
    // 延迟到宏任务触发，避免在 effect 内同步 setState（react-hooks/set-state-in-effect）
    const timer = window.setTimeout(() => setDensity(next), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const changeDensity = useCallback((next: TimelineDensity) => {
    setDensity(next);
    try {
      window.localStorage.setItem(TIMELINE_DENSITY_STORAGE_KEY, next);
    } catch {
      // 忽略写入失败
    }
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const update = () => setViewportHeight(element.clientHeight);
    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 相对时间基准：挂载后取一次并每分钟刷新（SSR 阶段先用绝对时间占位）
  useEffect(() => {
    const update = () => setNowMs(Date.now());
    const frame = window.requestAnimationFrame(update);
    const timer = window.setInterval(update, 60_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);

  // 过滤：纯内存计算（数据已加载），实时反馈；作者候选取自当前已加载提交。
  const authors = useMemo(() => timelineAuthors(commits), [commits]);
  const filteredCommits = useMemo(
    () => filterTimelineCommits(commits, filters, nowMs),
    [commits, filters, nowMs],
  );
  const activeFilters = hasActiveTimelineFilter(filters);

  // 创建分支（M3-2）：起点默认取选中提交，否则取已加载的最新提交（即当前分支头）。
  const branchStart = selectedCommit ?? commits[0] ?? null;
  const branchNameError = newBranchName ? validateBranchName(newBranchName.trim(), t) : null;
  const branchDescriptor = useMemo(
    () =>
      branchStart
        ? createBranchDescriptor(
            {
              owner,
              name,
              branch: newBranchName.trim(),
              fromSha: branchStart.oid,
              fromLabel: t("timeline.commitLabel", { sha: shortSha(branchStart.oid) }),
            },
            t,
          )
        : null,
    [branchStart, name, newBranchName, owner, t],
  );

  const closeCreateBranch = useCallback(() => {
    if (creating) {
      return;
    }
    setCreateOpen(false);
    setCreateError(null);
  }, [creating]);

  const submitCreateBranch = useCallback(async () => {
    const trimmed = newBranchName.trim();
    if (!branchStart || creating) {
      return;
    }
    const nameError = validateBranchName(trimmed, t);
    if (nameError) {
      setCreateError(nameError);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetchJsonWithRetry(
        `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/operations/create-branch`,
        {
          body: JSON.stringify({ branch: trimmed, from: branchStart.oid, confirmed: true }),
          t,
        },
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string; branch?: string };
      if (!response.ok) {
        setCreateError(describeCreateBranchFailure(response.status, data.error, t));
        return;
      }
      setCreateSuccess(t("timeline.branchCreated", { branch: data.branch ?? trimmed }));
      setCreateOpen(false);
      setNewBranchName("");
      // 重新拉取服务端数据，让分支选择器立即包含新分支
      router.refresh();
    } catch {
      setCreateError(t("timeline.createBranchNetworkError"));
    } finally {
      setCreating(false);
    }
  }, [branchStart, creating, name, newBranchName, owner, router, t]);

  // 创建 Issue（M3-3）：成功后关闭面板、展示提示并刷新服务端数据（沿用创建分支的约定）。
  const handleIssueCreated = useCallback(
    (message: string) => {
      setIssueOpen(false);
      setIssueSuccess(message);
      router.refresh();
    },
    [router],
  );

  // 创建 PR（M3-4）：成功后关闭面板、展示提示并刷新服务端数据。
  const handlePullCreated = useCallback(
    (message: string) => {
      setPullPreset(null);
      setPullSuccess(message);
      router.refresh();
    },
    [router],
  );

  // 删除分支（M3-5）：成功后关闭面板、展示提示并刷新服务端数据（分支选择器立即去掉该分支）。
  const handleBranchDeleted = useCallback(
    (message: string) => {
      setDeleteOpen(false);
      setDeleteInitialBranch(null);
      setDeleteSuccess(message);
      router.refresh();
    },
    [router],
  );

  // 恢复分支（M3-6）：从审计里的删除记录重建引用，成功后刷新分支选择器。
  const handleBranchRestored = useCallback(
    (message: string) => {
      setRestoreOpen(false);
      setRestoreSuccess(message);
      router.refresh();
    },
    [router],
  );

  // 过滤 / 缩放变化时：把仍可见的选中提交重新锚定到视口中央（保持浏览上下文），否则回到顶部。
  const applyFilterPatch = useCallback(
    (patch: Partial<TimelineFilterState>) => {
      const next = { ...filters, ...patch };
      // 预设区间与自定义时间窗互斥：选预设就清掉窗口，设了窗口就一定是 custom
      if (patch.range && patch.range !== "custom") {
        next.window = null;
      }
      if (patch.window) {
        next.range = "custom";
      }
      setFilters(next);
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const nextCommits = filterTimelineCommits(commits, next, nowMs);
      const index = indexOfCommit(nextCommits, selectedCommit?.oid ?? null);
      if (index < 0) {
        container.scrollTo({ top: 0 });
        return;
      }
      const maxTop = Math.max(0, nextCommits.length * rowHeight - container.clientHeight);
      const centered = index * rowHeight - container.clientHeight / 2 + rowHeight / 2;
      container.scrollTo({ top: Math.max(0, Math.min(centered, maxTop)) });
    },
    [commits, filters, nowMs, rowHeight, selectedCommit],
  );

  // 时间刷子的域：已加载提交的最早 / 最晚时间戳；不足两个有效时间点就不渲染刷子
  const timeDomain = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const commit of commits) {
      const timestamp = Date.parse(commit.committedDate);
      if (!Number.isFinite(timestamp)) {
        continue;
      }
      min = Math.min(min, timestamp);
      max = Math.max(max, timestamp);
    }
    return Number.isFinite(min) && min < max ? { min, max } : null;
  }, [commits]);

  const windowRange = useMemo(
    () =>
      computeVirtualWindow({
        scrollTop,
        viewportHeight,
        rowHeight,
        total: filteredCommits.length,
      }),
    [scrollTop, viewportHeight, rowHeight, filteredCommits.length],
  );
  const visibleCommits = filteredCommits.slice(windowRange.start, windowRange.end);

  // 泳道布局（TODO-246：增量续算 + 服务端下发缓存布局）：
  // 1. 集合与「服务端下发的首页布局」逐条一致（挂载 / 切换分支后的首帧）→ 直接采用，
  //    省掉客户端一次全量 computeLaneLayout；
  // 2. 无过滤且集合只是「尾部追加」（加载更多）→ 从上一份增量计算续算，只处理新页，
  //    深分页时避免万级提交每次全量重算（M4-2 基准：万级满并发 ~190ms/次）；
  // 3. 其余情况（过滤变化 / 切换分支重置集合）→ 全量重算，过滤后集合通常更小。
  // 布局推导成本高但依赖集合，故在 layout effect 中计算并经 setState 回填：
  // 增量计算实例只从 effect 读写（react-hooks/refs 规则），push 幂等，
  // StrictMode 双次执行与并发重入都安全。首帧布局直接以服务端下发值播种（SSR/注水一致）。
  const [laneLayout, setLaneLayout] = useState<LaneLayout | null>(initialLaneLayout ?? null);
  const laneComputationRef = useRef<LaneComputation | null>(null);
  const laneInputRef = useRef<CommitLike[]>([]);
  const serverLaneLayout = fetchedLaneLayout ?? initialLaneLayout ?? null;
  useIsomorphicLayoutEffect(() => {
    const input = filteredCommits.map((commit) => ({
      oid: commit.oid,
      parents: commit.parents,
    }));

    const matchesServerLayout =
      serverLaneLayout !== null &&
      input.length === serverLaneLayout.nodes.length &&
      input.every((commit, index) => commit.oid === serverLaneLayout.nodes[index]?.oid);
    if (matchesServerLayout && serverLaneLayout) {
      // 同步维护增量计算，后续「加载更多」才能从这份集合续算
      const computation = new LaneComputation();
      computation.push(input);
      laneComputationRef.current = computation;
      laneInputRef.current = input;
      setLaneLayout(serverLaneLayout);
      return;
    }

    const previous = laneInputRef.current;
    const canExtend =
      !hasActiveTimelineFilter(filters) &&
      input.length >= previous.length &&
      previous.every((commit, index) => commit.oid === input[index]?.oid);
    if (canExtend && laneComputationRef.current) {
      laneComputationRef.current.push(input.slice(previous.length));
    } else {
      const computation = new LaneComputation();
      computation.push(input);
      laneComputationRef.current = computation;
    }
    laneInputRef.current = input;
    setLaneLayout(laneComputationRef.current.snapshot());
  }, [filteredCommits, filters, serverLaneLayout]);
  // 只切出当前窗口内的节点与连线，保证每帧 SVG 元素量恒定（不随总提交数增长）。
  const laneSlice = useMemo(
    () => sliceLaneLayout(laneLayout ?? EMPTY_LANE_LAYOUT, windowRange.start, windowRange.end),
    [laneLayout, windowRange.start, windowRange.end],
  );
  // 泳道几何：列宽只随整体 laneCount 变化，滚动时稳定。
  const { laneWidth, gutterWidth } = useMemo(
    () => computeLaneMetrics(laneSlice.laneCount),
    [laneSlice.laneCount],
  );

  const loadMore = useCallback(async () => {
    if (loading || !hasNextPage) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    const nextPage = page + 1;
    const query = new URLSearchParams({ page: String(nextPage) });
    if (branchParam) {
      query.set("branch", branchParam);
    }
    try {
      const response = await fetchWithRetry(
        `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/timeline?${query.toString()}`,
        { t },
      );
      const data = (await response.json()) as TimelinePageResponse;
      setCommits((previous) => mergeCommits(previous, data.commits));
      setHasNextPage(data.pageInfo.hasNextPage);
      setPage(nextPage);
      // 深页不下发布局：上面 setCommits 会让集合超出服务端布局覆盖范围，
      // 布局 memo 自动转入「增量续算」路径；这里清掉旧布局避免无谓的比对
      setFetchedLaneLayout(null);
    } catch (error) {
      const info =
        error instanceof OnlineRequestError ? error.info : describeApiFailure(500, null, t);
      setLoadError(info);
      // 游标过期无法在同一页继续翻页，停掉自动加载并提示刷新
      if (info.kind === "cursor_expired") {
        setHasNextPage(false);
      }
    } finally {
      setLoading(false);
    }
  }, [branchParam, hasNextPage, loading, name, owner, page, t]);

  useEffect(() => {
    // 存在错误时暂停自动翻页，等待用户手动重试，避免对限流 / 故障反复冲击
    // 过滤生效时暂停自动翻页：窗口只展示已加载提交的子集，底部判定无意义（仍可手动「加载更多」）
    if (activeFilters || !hasNextPage || loading || loadError || commits.length === 0) {
      return;
    }
    if (windowRange.end < commits.length - AUTO_LOAD_THRESHOLD) {
      return;
    }
    // 延迟到宏任务触发，避免在 effect 内同步 setState
    const timer = window.setTimeout(() => void loadMore(), 0);
    return () => window.clearTimeout(timer);
  }, [activeFilters, commits.length, hasNextPage, loadError, loadMore, loading, windowRange.end]);

  const switchBranch = useCallback(
    async (nextBranch: string) => {
      if (loading) {
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const query = new URLSearchParams({ page: "1" });
        if (nextBranch) {
          query.set("branch", nextBranch);
        }
        const response = await fetchWithRetry(
          `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/timeline?${query.toString()}`,
          { t },
        );
        const data = (await response.json()) as TimelinePageResponse;
        setCommits(data.commits);
        setHasNextPage(data.pageInfo.hasNextPage);
        setPage(1);
        setBranch(nextBranch);
        setBranchParam(nextBranch);
        setSelectedCommit(null);
        // 切换分支 → 第 1 页携带服务端算好并缓存的布局，客户端首帧直接采用（TODO-246）
        setFetchedLaneLayout(data.laneLayout ?? null);
        containerRef.current?.scrollTo({ top: 0 });
      } catch (error) {
        setLoadError(
          error instanceof OnlineRequestError ? error.info : describeApiFailure(500, null, t),
        );
      } finally {
        setLoading(false);
      }
    },
    [loading, name, owner, t],
  );

  // 选中提交：拖动结束时浏览器会补发 click，这里吞掉那一次，避免「拖完顺手打开了详情」
  const selectCommit = useCallback((commit: TimelineCommit) => {
    if (suppressRowClickRef.current) {
      return;
    }
    setSelectedCommit(commit);
  }, []);

  const pointOverTrash = useCallback((point: DragPoint) => {
    const rect = trashRef.current?.getBoundingClientRect();
    if (!rect) {
      return false;
    }
    return (
      point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
    );
  }, []);

  const handleBranchDragStart = useCallback((branchName: string) => {
    // 删除区常驻右侧竖轨；一开始拖动就把它切到「可放入」高亮态
    setBranchDrag({ name: branchName, point: { x: 0, y: 0 }, target: null });
    setBranchDragOverTrash(false);
  }, []);

  const handleBranchDragMove = useCallback(
    (branchName: string, point: DragPoint, target: string | null) => {
      setBranchDrag({ name: branchName, point, target });
      setBranchDragOverTrash(pointOverTrash(point));
    },
    [pointOverTrash],
  );

  const handleBranchDragEnd = useCallback(
    (branchName: string, point: DragPoint, target: string | null) => {
      const dropped = pointOverTrash(point);
      setBranchDrag(null);
      setBranchDragOverTrash(false);

      // 落在另一个分支芯片上：从被拖的分支向目标分支开 PR（方向即语义）
      if (target && target !== branchName) {
        resetOperationAlerts();
        setPullPreset({ head: branchName, base: target });
        return;
      }
      if (!dropped) {
        return;
      }
      // 拖进删除区只是「发起删除」：仍然走确认面板（影响预览 + 服务端预检），不静默执行
      resetOperationAlerts();
      setDeleteInitialBranch(branchName);
      setDeleteOpen(true);
    },
    [pointOverTrash, resetOperationAlerts],
  );

  const handleBranchDragCancel = useCallback(() => {
    setBranchDrag(null);
    setBranchDragOverTrash(false);
  }, []);

  // 提交节点拖动 → 落点就地命名（唯一需要打字的地方）
  const openNamingAt = useCallback((commit: TimelineCommit, point: DragPoint) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const popoverWidth = 260;
    const popoverHeight = 168;
    const left = rect
      ? Math.min(Math.max(8, point.x - rect.left), Math.max(8, rect.width - popoverWidth))
      : 8;
    const top = rect
      ? Math.min(Math.max(8, point.y - rect.top), Math.max(8, rect.height - popoverHeight))
      : 8;
    setNaming({
      commit,
      left,
      top,
      // 预填一个合法且大概率不冲突的名字，用户可直接回车
      value: `feature/${shortSha(commit.oid)}`,
      error: null,
    });
  }, []);

  const startCommitDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, commit: TimelineCommit) => {
      // 只处理鼠标左键：触摸端拖拽会与纵向滚动抢手势，触摸用户仍可点开详情
      if (event.pointerType !== "mouse" || event.button !== 0) {
        return;
      }
      // 行内的 PR / Issue 链接保持原生行为
      if ((event.target as HTMLElement).closest("a")) {
        return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      const handleMove = (moveEvent: PointerEvent) => {
        if (!moved) {
          const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
          if (distance < COMMIT_DRAG_THRESHOLD) {
            return;
          }
          moved = true;
          suppressRowClickRef.current = true;
        }
        setCommitDrag({ commit, point: { x: moveEvent.clientX, y: moveEvent.clientY } });
      };
      const handleUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        setCommitDrag(null);
        if (moved) {
          // 只认画布内的落点：拖到画布外（工具栏、页脚）不产生任何操作，
          // 避免「拖到哪儿都是新建分支」这种说不清的语义
          const rect = canvasRef.current?.getBoundingClientRect();
          const inside =
            rect !== undefined &&
            upEvent.clientX >= rect.left &&
            upEvent.clientX <= rect.right &&
            upEvent.clientY >= rect.top &&
            upEvent.clientY <= rect.bottom;
          if (inside) {
            openNamingAt(commit, { x: upEvent.clientX, y: upEvent.clientY });
          }
        }
        // click 紧随 pointerup 同步触发，宏任务里复位即可吞掉这一次
        window.setTimeout(() => {
          suppressRowClickRef.current = false;
        }, 0);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [openNamingAt],
  );

  const cancelNaming = useCallback(() => {
    setNaming(null);
  }, []);

  const submitNaming = useCallback(async () => {
    if (!naming || namingPending) {
      return;
    }
    const trimmed = naming.value.trim();
    const nameError = validateBranchName(trimmed, t);
    if (nameError) {
      setNaming({ ...naming, error: nameError });
      return;
    }
    setNamingPending(true);
    setNaming({ ...naming, error: null });
    try {
      const response = await fetchJsonWithRetry(
        `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/operations/create-branch`,
        {
          body: JSON.stringify({ branch: trimmed, from: naming.commit.oid, confirmed: true }),
          t,
        },
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string; branch?: string };
      if (!response.ok) {
        setNaming((current) =>
          current
            ? { ...current, error: describeCreateBranchFailure(response.status, data.error, t) }
            : current,
        );
        return;
      }
      setCreateSuccess(t("timeline.branchCreated", { branch: data.branch ?? trimmed }));
      setNaming(null);
      // 让分支芯片条立即包含新分支
      router.refresh();
    } catch {
      setNaming((current) =>
        current ? { ...current, error: t("timeline.createBranchNetworkError") } : current,
      );
    } finally {
      setNamingPending(false);
    }
  }, [name, naming, namingPending, owner, router, t]);

  return (
    <div>
      {/* 分支芯片条（替代下拉框）：点击切换分支，鼠标可拖动芯片到删除区 */}
      <BranchBar
        branches={
          branch && !branches.some((item) => item.name === branch)
            ? [{ name: branch, headOid: null, committedDate: null }, ...branches]
            : branches
        }
        current={branch}
        defaultBranch={defaultBranch}
        disabled={loading}
        mode={explainMode}
        onSelect={(nextBranch) => void switchBranch(nextBranch)}
        onOpenPull={(branchName) => {
          resetOperationAlerts();
          setPullPreset({ head: branchName, base: branch ?? defaultBranch ?? "" });
        }}
        onRequestDelete={(branchName) => {
          resetOperationAlerts();
          setDeleteInitialBranch(branchName);
          setDeleteOpen(true);
        }}
        onDragStart={handleBranchDragStart}
        onDragMove={handleBranchDragMove}
        onDragEnd={handleBranchDragEnd}
        onDragCancel={handleBranchDragCancel}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
          {explainMode === "off" ? null : (
            <span className="flex items-center gap-1">
              {t("timeline.lane")}
              <GlossaryHint id="lane" mode={explainMode} />
            </span>
          )}
          <span className="flex items-center gap-2">
            <span id="density-label">{t("timeline.densityLabel")}</span>
            <span
              role="group"
              aria-labelledby="density-label"
              className="inline-flex items-center rounded-full border border-black/[.08] p-0.5 dark:border-white/[.145]"
            >
              {TIMELINE_DENSITIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={density === value}
                  onClick={() => changeDensity(value)}
                  className={[
                    "h-7 rounded-full px-3 text-xs transition-colors",
                    density === value
                      ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.08]",
                  ].join(" ")}
                >
                  {value === "compact" ? t("timeline.densityCompact") : t("timeline.densityComfy")}
                </button>
              ))}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <label htmlFor="explain-mode">{t("timeline.explainLabel")}</label>
            <select
              id="explain-mode"
              aria-label={t("timeline.explainModeLabel")}
              value={explainMode}
              onChange={(event) => changeExplainMode(event.target.value as ExplainMode)}
              className="h-9 rounded-lg border border-black/[.08] bg-white px-2 text-xs text-zinc-700 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
            >
              {EXPLAIN_MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </span>
          <p>{t("timeline.loadedCommits", { count: commits.length })}</p>
        </div>
      </div>

      {/* 点击 / 键盘路径：与拖拽手势等价，可访问性与 E2E 都依赖这排按钮 */}
      {commits.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-400 dark:text-zinc-500">{t("timeline.actionsLabel")}</span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                resetOperationAlerts();
                setCreateOpen(true);
                setCreateError(null);
              }}
              className="h-8 rounded-full border border-black/[.08] px-3 text-xs text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
            >
              {t("timeline.actions.createBranch")}
            </button>
            <GlossaryHint id="branch" mode={explainMode} />
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                resetOperationAlerts();
                setIssueOpen(true);
              }}
              className="h-8 rounded-full border border-black/[.08] px-3 text-xs text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
            >
              {t("timeline.actions.createIssue")}
            </button>
            <GlossaryHint id="issue" mode={explainMode} />
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                resetOperationAlerts();
                setPullPreset({ head: "", base: "" });
              }}
              className="h-8 rounded-full border border-black/[.08] px-3 text-xs text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
            >
              {t("timeline.actions.createPull")}
            </button>
            <GlossaryHint id="pull-request" mode={explainMode} />
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                resetOperationAlerts();
                setDeleteInitialBranch(null);
                setDeleteOpen(true);
              }}
              className="h-8 rounded-full border border-black/[.08] px-3 text-xs text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
            >
              {t("timeline.actions.deleteBranch")}
            </button>
            <GlossaryHint id="branch" mode={explainMode} />
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                resetOperationAlerts();
                setRestoreOpen(true);
              }}
              className="h-8 rounded-full border border-black/[.08] px-3 text-xs text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
            >
              {t("timeline.actions.restoreBranch")}
            </button>
            <GlossaryHint id="branch" mode={explainMode} />
          </span>
          <span className="ml-auto text-[11px] text-zinc-400 dark:text-zinc-500">
            {t("timeline.canvasHint")}
          </span>
        </div>
      ) : null}

      {createSuccess || issueSuccess || pullSuccess || deleteSuccess || restoreSuccess ? (
        <p
          role="status"
          className="mt-3 rounded-lg border border-green-300 bg-green-50 p-3 text-xs text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200"
        >
          {createSuccess ?? issueSuccess ?? pullSuccess ?? deleteSuccess ?? restoreSuccess}
        </p>
      ) : null}

      {createOpen && branchDescriptor ? (
        <div className="mt-3">
          <ConfirmCard
            view={confirmationView(branchDescriptor, t)}
            pending={creating}
            error={createError}
            onConfirm={() => void submitCreateBranch()}
            onCancel={closeCreateBranch}
          >
            <ConceptNote id="branch" mode={explainMode} className="mt-3" />
            <label
              className="mt-1 block text-xs text-zinc-600 dark:text-zinc-300"
              htmlFor="new-branch-name"
            >
              {t("timeline.newBranchName")}
            </label>
            <input
              id="new-branch-name"
              value={newBranchName}
              onChange={(event) => setNewBranchName(event.target.value)}
              placeholder="feature/demo"
              className="mt-1 h-9 w-full max-w-sm rounded-lg border border-black/[.08] bg-white px-3 text-xs text-zinc-700 placeholder:text-zinc-500 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
            />
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {branchNameError ??
                t("timeline.branchStart", { sha: shortSha(branchStart?.oid ?? "") })}
            </p>
          </ConfirmCard>
        </div>
      ) : null}

      {issueOpen ? (
        <div className="mt-3">
          <CreateIssuePanel
            owner={owner}
            name={name}
            mode={explainMode}
            onCreated={handleIssueCreated}
            onCancel={() => setIssueOpen(false)}
          />
        </div>
      ) : null}

      {pullPreset ? (
        <div className="mt-3">
          <CreatePullPanel
            owner={owner}
            name={name}
            mode={explainMode}
            branches={branches.map((branch) => branch.name)}
            defaultBase={initialBranch}
            presetBase={pullPreset.base || null}
            presetHead={pullPreset.head || null}
            onCreated={handlePullCreated}
            onCancel={() => setPullPreset(null)}
          />
        </div>
      ) : null}

      {deleteOpen ? (
        <div className="mt-3">
          <DeleteBranchPanel
            owner={owner}
            name={name}
            mode={explainMode}
            initialBranchName={deleteInitialBranch}
            variant={deleteInitialBranch ? "overlay" : "inline"}
            branches={branches}
            defaultBranch={defaultBranch}
            currentBranch={branch}
            onDeleted={handleBranchDeleted}
            onCancel={() => {
              setDeleteOpen(false);
              setDeleteInitialBranch(null);
            }}
          />
        </div>
      ) : null}

      {restoreOpen ? (
        <div className="mt-3">
          <RestoreBranchPanel
            owner={owner}
            name={name}
            mode={explainMode}
            onRestored={handleBranchRestored}
            onCancel={() => setRestoreOpen(false)}
          />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <input
          type="search"
          value={filters.query}
          onChange={(event) => applyFilterPatch({ query: event.target.value })}
          placeholder={t("timeline.searchPlaceholder")}
          aria-label={t("timeline.searchLabel")}
          className="h-9 w-56 rounded-lg border border-black/[.08] bg-white px-3 text-xs text-zinc-700 placeholder:text-zinc-500 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
        />
        <select
          value={filters.author}
          onChange={(event) => applyFilterPatch({ author: event.target.value })}
          aria-label={t("timeline.filterByAuthor")}
          className="h-9 max-w-[12rem] rounded-lg border border-black/[.08] bg-white px-2 text-xs text-zinc-700 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
        >
          <option value="">{t("timeline.allAuthors")}</option>
          {authors.map((author) => (
            <option key={author} value={author}>
              {author}
            </option>
          ))}
        </select>
        <select
          value={filters.kind}
          onChange={(event) => applyFilterPatch({ kind: event.target.value as TimelineEventKind })}
          aria-label={t("timeline.filterByKind")}
          className="h-9 rounded-lg border border-black/[.08] bg-white px-2 text-xs text-zinc-700 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
        >
          <option value="all">{t("timeline.kindAll")}</option>
          <option value="merge">{t("timeline.kindMerge")}</option>
          <option value="pullRequest">{t("timeline.kindPull")}</option>
          <option value="issue">{t("timeline.kindIssue")}</option>
        </select>
        <select
          value={filters.range}
          onChange={(event) => applyFilterPatch({ range: event.target.value as TimelineRange })}
          aria-label={t("timeline.rangeLabel")}
          className="h-9 rounded-lg border border-black/[.08] bg-white px-2 text-xs text-zinc-700 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
        >
          <option value="all">{t("timeline.rangeAll")}</option>
          {filters.range === "custom" ? (
            <option value="custom">{t("timeline.rangeCustom")}</option>
          ) : null}
          <option value="week">{t("timeline.rangeWeek")}</option>
          <option value="month">{t("timeline.rangeMonth")}</option>
        </select>
        {activeFilters ? (
          <>
            <span className="text-zinc-500 dark:text-zinc-400">
              {t("timeline.filteredCount", {
                filtered: filteredCommits.length,
                total: commits.length,
              })}
            </span>
            <button
              type="button"
              onClick={() => applyFilterPatch(EMPTY_TIMELINE_FILTER)}
              className="h-9 rounded-full border border-black/[.08] px-4 text-xs text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
            >
              {t("timeline.clearFilters")}
            </button>
          </>
        ) : null}
      </div>

      {commits.length === 0 ? (
        <div className="mt-3 rounded-xl border border-black/[.08] bg-white p-6 text-sm text-zinc-600 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-300">
          {t("timeline.emptyBranch")}
        </div>
      ) : (
        <>
          {filteredCommits.length === 0 ? (
            <div className="mt-3 rounded-xl border border-black/[.08] bg-white p-6 text-sm text-zinc-600 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-300">
              <p>{t("timeline.noMatches", { count: commits.length })}</p>
              <button
                type="button"
                onClick={() => applyFilterPatch(EMPTY_TIMELINE_FILTER)}
                className="mt-2 underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                {t("timeline.clearFilters")}
              </button>
            </div>
          ) : (
            // 画布容器：滚动仍在内部容器里完成（虚拟窗口按 scrollTop 计算），
            // 拖拽落点、删除区命中都以这层为坐标基准。
            <div ref={canvasRef} className="relative mt-3">
              {/* 删除区：常驻右侧竖轨。用户反馈「原来右下角的小方块太淡、太远」——
                  竖轨贴着画布右边、整幅高度都是命中区，红色配色 + 图标 + 竖排文字常驻可见。
                  始终 pointer-events-none：命中判定走 trashRef 的几何矩形，不抢行内链接点击；
                  读屏隐藏：键盘 / 点击等价路径是分支芯片「⋯」菜单里的删除项。 */}
              <div
                ref={trashRef}
                aria-hidden="true"
                data-testid="branch-trash"
                className={[
                  "pointer-events-none absolute right-0 top-0 bottom-0 z-20 flex w-14 flex-col items-center justify-center gap-1.5 rounded-r-xl border-l transition-colors",
                  branchDragOverTrash
                    ? "border-red-500 bg-red-600 text-white"
                    : branchDrag
                      ? "border-red-400 bg-red-100 text-red-700 dark:border-red-500 dark:bg-red-900 dark:text-red-100"
                      : "border-red-200 bg-red-50/80 text-red-600 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400",
                ].join(" ")}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
                <span
                  className={
                    branchDrag
                      ? "text-[11px] font-medium"
                      : "text-[10px] [writing-mode:vertical-rl]"
                  }
                >
                  {branchDrag ? t("timeline.trashDrop") : t("timeline.trashIdle")}
                </span>
              </div>
              <div
                ref={containerRef}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                role="list"
                aria-label={t("timeline.listLabel")}
                className="h-[65vh] overflow-y-auto overscroll-contain rounded-xl border border-black/[.08] bg-white pr-14 dark:border-white/[.145] dark:bg-zinc-950"
              >
                <div style={{ height: windowRange.totalHeight, position: "relative" }}>
                  <div
                    style={{
                      transform: `translateY(${windowRange.offsetY}px)`,
                      position: "relative",
                    }}
                  >
                    {/* 泳道槽与行共用同一 translateY 坐标系，故绝对定位到窗口内容左上角 */}
                    {laneSlice.laneCount > 0 ? (
                      <LaneGraph
                        slice={laneSlice}
                        rowHeight={rowHeight}
                        laneWidth={laneWidth}
                        height={laneSlice.nodes.length * rowHeight}
                        className="absolute left-0 top-0"
                      />
                    ) : null}
                    {visibleCommits.map((commit) => (
                      <div
                        key={commit.oid}
                        style={{ height: rowHeight, paddingLeft: gutterWidth }}
                        role="listitem"
                        // 按下后移动超过阈值才算拖动：不移动则仍是「点击打开详情」
                        onPointerDown={(event) => startCommitDrag(event, commit)}
                      >
                        <CommitRow
                          commit={commit}
                          nowMs={nowMs}
                          mode={explainMode}
                          repoUrl={`https://github.com/${owner}/${name}`}
                          compact={density === "compact"}
                          onSelect={selectCommit}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {naming ? (
                <BranchPopover
                  fromLabel={shortSha(naming.commit.oid)}
                  value={naming.value}
                  error={naming.error}
                  pending={namingPending}
                  left={naming.left}
                  top={naming.top}
                  onChange={(value) =>
                    setNaming((current) => (current ? { ...current, value } : current))
                  }
                  onConfirm={() => void submitNaming()}
                  onCancel={cancelNaming}
                />
              ) : null}

              {branchDrag && (branchDrag.target || branchDragOverTrash) ? (
                <div
                  aria-hidden="true"
                  style={{ left: branchDrag.point.x + 14, top: branchDrag.point.y + 14 }}
                  className={[
                    "pointer-events-none fixed z-40 rounded-full border px-2.5 py-1 text-[11px] shadow-lg",
                    branchDrag.target
                      ? "border-sky-500 bg-white text-sky-700 dark:bg-zinc-900 dark:text-sky-300"
                      : "border-red-500 bg-white text-red-700 dark:bg-zinc-900 dark:text-red-300",
                  ].join(" ")}
                >
                  {branchDrag.target
                    ? t("timeline.dragToPull", { branch: branchDrag.target })
                    : t("timeline.trashDrop")}
                </div>
              ) : null}

              {commitDrag ? (
                <div
                  aria-hidden="true"
                  style={{ left: commitDrag.point.x + 14, top: commitDrag.point.y + 14 }}
                  className="pointer-events-none fixed z-40 flex items-center gap-1.5 rounded-full border border-sky-500 bg-white px-2.5 py-1 text-[11px] text-sky-700 shadow-lg dark:bg-zinc-900 dark:text-sky-300"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                  {t("timeline.dragCommitHint")}
                </div>
              ) : null}
            </div>
          )}

          {timeDomain ? (
            <TimeBrush
              min={timeDomain.min}
              max={timeDomain.max}
              value={filters.window ? { from: filters.window.from, to: filters.window.to } : null}
              onChange={(next) => applyFilterPatch({ range: "custom", window: next })}
              onReset={() => applyFilterPatch({ range: "all", window: null })}
            />
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-3 text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">
              {loading
                ? t("common.loading")
                : hasNextPage
                  ? t("timeline.autoLoadHint")
                  : t("timeline.reachedEnd")}
            </span>
            {hasNextPage ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loading}
                className="h-9 rounded-full border border-black/[.08] px-4 text-xs font-medium text-zinc-900 transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-white/[.08]"
              >
                {loading ? t("common.loading") : t("timeline.loadMore")}
              </button>
            ) : null}
          </div>
          {loadError ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
              <span className="font-medium">{loadError.title}</span>
              <span className="min-w-0 flex-1">{loadError.message}</span>
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loading}
                className="h-8 shrink-0 rounded-full border border-red-400 px-4 font-medium transition-colors hover:bg-red-100 disabled:opacity-60 dark:border-red-600 dark:hover:bg-red-900"
              >
                {loadError.action}
              </button>
            </div>
          ) : null}
        </>
      )}

      <CommitDetailPanel
        owner={owner}
        name={name}
        commit={selectedCommit}
        onClose={() => setSelectedCommit(null)}
      />
    </div>
  );
}
