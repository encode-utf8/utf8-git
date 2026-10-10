"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { computeLaneLayout, sliceLaneLayout } from "@utf8-git/git-graph";

import {
  createBranchDescriptor,
  describeCreateBranchFailure,
  validateBranchName,
} from "@/lib/branch-ops";
import { formatRelativeTime, formatUtcDateTime, shortSha } from "@/lib/commit-format";
import { mergeCommits } from "@/lib/commit-list";
import { fetchWithRetry } from "@/lib/client-fetch";
import { OnlineRequestError, describeApiFailure, type OnlineErrorInfo } from "@/lib/error-state";
import { collectIssues, type TimelineBranch, type TimelineCommit } from "@/lib/github-timeline";
import { EXPLAIN_MODES, isExplainMode, type ExplainMode } from "@/lib/glossary";
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
import { computeVirtualWindow } from "@/lib/virtual-window";

import { CommitDetailPanel } from "./commit-detail";
import { ConfirmCard } from "./confirm-card";
import { CreateIssuePanel } from "./create-issue-panel";
import { CreatePullPanel } from "./create-pull-panel";
import { GlossaryHint } from "./glossary-hint";
import { LaneGraph } from "./lane-graph";

const ROW_HEIGHT = 76;
const AUTO_LOAD_THRESHOLD = 8;
const EXPLAIN_MODE_STORAGE_KEY = "utf8-git:explain-mode";

type TimelinePageResponse = {
  commits: TimelineCommit[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

type TimelineViewProps = {
  owner: string;
  name: string;
  initialCommits: TimelineCommit[];
  initialHasNextPage: boolean;
  initialBranch: string | null;
  branches: TimelineBranch[];
};

const PR_STATE_LABEL: Record<string, string> = {
  OPEN: "开放",
  MERGED: "已合并",
  CLOSED: "已关闭",
};

function prBadgeClass(state: string): string {
  if (state === "MERGED") {
    return "border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-200";
  }
  if (state === "OPEN") {
    return "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200";
  }
  return "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
}

const ISSUE_STATE_LABEL: Record<string, string> = {
  OPEN: "开放",
  CLOSED: "已关闭",
};

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
  onSelect,
}: {
  commit: TimelineCommit;
  nowMs: number | null;
  mode: ExplainMode;
  repoUrl: string;
  onSelect: (commit: TimelineCommit) => void;
}) {
  const authorLabel = commit.author.login ?? commit.author.name ?? "未知作者";
  const issues = collectIssues(commit.pullRequests);
  return (
    <div className="relative h-full w-full border-b border-black/[.06] dark:border-white/[.08]">
      {/* 整行可点：遮罩按钮负责选中；内容层 pointer-events-none，链接再单独放开 */}
      <button
        type="button"
        onClick={() => onSelect(commit)}
        aria-label={`查看提交 ${shortSha(commit.oid)} 详情`}
        className="absolute inset-0 z-0 transition-colors hover:bg-black/[.03] focus-visible:bg-black/[.04] focus-visible:outline-none dark:hover:bg-white/[.05]"
      />
      <div className="pointer-events-none relative z-10 flex h-full w-full items-start gap-3 px-4 py-3">
        {commit.author.avatarUrl ? (
          <Image
            src={commit.author.avatarUrl}
            alt=""
            width={32}
            height={32}
            className="mt-0.5 h-8 w-8 shrink-0 rounded-full"
          />
        ) : (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {authorLabel.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {commit.headline || "（无提交信息）"}
            </span>
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
                #{pullRequest.number} {PR_STATE_LABEL[pullRequest.state] ?? pullRequest.state}
              </a>
            ))}
            {issues.map((issue) => (
              <a
                key={`issue-${issue.number}`}
                href={issue.url ?? `${repoUrl}/issues/${issue.number}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`Issue：${issue.title}`}
                className={`pointer-events-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px] underline-offset-4 hover:underline ${issueBadgeClass(issue.state)}`}
              >
                #{issue.number} {ISSUE_STATE_LABEL[issue.state] ?? issue.state}
              </a>
            ))}
            {commit.pullRequests.length > 0 ? <GlossaryHint id="pull-request" mode={mode} /> : null}
            {issues.length > 0 ? <GlossaryHint id="issue" mode={mode} /> : null}
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
              title={`${formatUtcDateTime(commit.committedDate)}（UTC）`}
            >
              {commit.committedDate
                ? nowMs === null
                  ? formatUtcDateTime(commit.committedDate)
                  : formatRelativeTime(Date.parse(commit.committedDate), nowMs)
                : "—"}
            </time>
          </span>
        </span>
      </div>
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
}: TimelineViewProps) {
  const [commits, setCommits] = useState(initialCommits);
  const [hasNextPage, setHasNextPage] = useState(initialHasNextPage);
  const [page, setPage] = useState(1);
  const [branch, setBranch] = useState(initialBranch);
  // 第 1 页由服务端渲染、未指定分支参数；分页请求必须沿用同样的「不传分支」，
  // 否则服务端的游标链 key（user / owner / name / branch）不一致，会返回 409 cursor_expired。
  // 用户手动切换分支后，这里同步为具体分支名。
  const [branchParam, setBranchParam] = useState<string | null>(null);
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
  const [pullOpen, setPullOpen] = useState(false);
  const [pullSuccess, setPullSuccess] = useState<string | null>(null);

  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);

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
  const branchNameError = newBranchName ? validateBranchName(newBranchName.trim()) : null;
  const branchDescriptor = useMemo(
    () =>
      branchStart
        ? createBranchDescriptor({
            owner,
            name,
            branch: newBranchName.trim(),
            fromSha: branchStart.oid,
            fromLabel: `提交 ${shortSha(branchStart.oid)}`,
          })
        : null,
    [branchStart, name, newBranchName, owner],
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
    const nameError = validateBranchName(trimmed);
    if (nameError) {
      setCreateError(nameError);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch(
        `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/operations/create-branch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ branch: trimmed, from: branchStart.oid, confirmed: true }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string; branch?: string };
      if (!response.ok) {
        setCreateError(describeCreateBranchFailure(response.status, data.error));
        return;
      }
      setCreateSuccess(`已创建分支 ${data.branch ?? trimmed}`);
      setCreateOpen(false);
      setNewBranchName("");
      // 重新拉取服务端数据，让分支选择器立即包含新分支
      router.refresh();
    } finally {
      setCreating(false);
    }
  }, [branchStart, creating, name, newBranchName, owner, router]);

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
      setPullOpen(false);
      setPullSuccess(message);
      router.refresh();
    },
    [router],
  );

  // 过滤 / 缩放变化时：把仍可见的选中提交重新锚定到视口中央（保持浏览上下文），否则回到顶部。
  const applyFilterPatch = useCallback(
    (patch: Partial<TimelineFilterState>) => {
      const next = { ...filters, ...patch };
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
      const maxTop = Math.max(0, nextCommits.length * ROW_HEIGHT - container.clientHeight);
      const centered = index * ROW_HEIGHT - container.clientHeight / 2 + ROW_HEIGHT / 2;
      container.scrollTo({ top: Math.max(0, Math.min(centered, maxTop)) });
    },
    [commits, filters, nowMs, selectedCommit],
  );

  const windowRange = useMemo(
    () =>
      computeVirtualWindow({
        scrollTop,
        viewportHeight,
        rowHeight: ROW_HEIGHT,
        total: filteredCommits.length,
      }),
    [scrollTop, viewportHeight, filteredCommits.length],
  );
  const visibleCommits = filteredCommits.slice(windowRange.start, windowRange.end);

  // 泳道布局：只依赖 commits（切换分支 / 加载更多时重算），窗口滚动不触发。
  const laneLayout = useMemo(
    () =>
      computeLaneLayout(
        filteredCommits.map((commit) => ({ oid: commit.oid, parents: commit.parents })),
      ),
    [filteredCommits],
  );
  // 只切出当前窗口内的节点与连线，保证每帧 SVG 元素量恒定（不随总提交数增长）。
  const laneSlice = useMemo(
    () => sliceLaneLayout(laneLayout, windowRange.start, windowRange.end),
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
      );
      const data = (await response.json()) as TimelinePageResponse;
      setCommits((previous) => mergeCommits(previous, data.commits));
      setHasNextPage(data.pageInfo.hasNextPage);
      setPage(nextPage);
    } catch (error) {
      const info = error instanceof OnlineRequestError ? error.info : describeApiFailure(500, null);
      setLoadError(info);
      // 游标过期无法在同一页继续翻页，停掉自动加载并提示刷新
      if (info.kind === "cursor_expired") {
        setHasNextPage(false);
      }
    } finally {
      setLoading(false);
    }
  }, [branchParam, hasNextPage, loading, name, owner, page]);

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
        );
        const data = (await response.json()) as TimelinePageResponse;
        setCommits(data.commits);
        setHasNextPage(data.pageInfo.hasNextPage);
        setPage(1);
        setBranch(nextBranch);
        setBranchParam(nextBranch);
        setSelectedCommit(null);
        containerRef.current?.scrollTo({ top: 0 });
      } catch (error) {
        setLoadError(
          error instanceof OnlineRequestError ? error.info : describeApiFailure(500, null),
        );
      } finally {
        setLoading(false);
      }
    },
    [loading, name, owner],
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <label htmlFor="branch-select">分支</label>
          <select
            id="branch-select"
            value={branch ?? ""}
            onChange={(event) => void switchBranch(event.target.value)}
            disabled={loading}
            className="h-9 max-w-[16rem] rounded-lg border border-black/[.08] bg-white px-2 text-xs text-zinc-700 disabled:opacity-60 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
          >
            {branch && !branches.some((item) => item.name === branch) ? (
              <option value={branch}>{branch}</option>
            ) : null}
            {branches.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
          {explainMode === "off" ? null : (
            <span className="flex items-center gap-1">
              泳道
              <GlossaryHint id="lane" mode={explainMode} />
            </span>
          )}
          {commits.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(true);
                  setCreateError(null);
                  setCreateSuccess(null);
                }}
                className="h-9 rounded-full border border-black/[.08] px-4 text-xs text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
              >
                新建分支
              </button>
              <button
                type="button"
                onClick={() => {
                  setIssueOpen(true);
                  setIssueSuccess(null);
                }}
                className="h-9 rounded-full border border-black/[.08] px-4 text-xs text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
              >
                新建 Issue
              </button>
              <button
                type="button"
                onClick={() => {
                  setPullOpen(true);
                  setPullSuccess(null);
                }}
                className="h-9 rounded-full border border-black/[.08] px-4 text-xs text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
              >
                新建 PR
              </button>
            </>
          ) : null}
          <span className="flex items-center gap-2">
            <label htmlFor="explain-mode">术语解释</label>
            <select
              id="explain-mode"
              aria-label="术语解释模式"
              value={explainMode}
              onChange={(event) => changeExplainMode(event.target.value as ExplainMode)}
              className="h-9 rounded-lg border border-black/[.08] bg-white px-2 text-xs text-zinc-700 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
            >
              {EXPLAIN_MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </span>
          <p>已加载 {commits.length} 条提交</p>
        </div>
      </div>

      {createSuccess || issueSuccess || pullSuccess ? (
        <p
          role="status"
          className="mt-3 rounded-lg border border-green-300 bg-green-50 p-3 text-xs text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200"
        >
          {createSuccess ?? issueSuccess ?? pullSuccess}
        </p>
      ) : null}

      {createOpen && branchDescriptor ? (
        <div className="mt-3">
          <ConfirmCard
            view={confirmationView(branchDescriptor)}
            pending={creating}
            error={createError}
            onConfirm={() => void submitCreateBranch()}
            onCancel={closeCreateBranch}
          >
            <label
              className="mt-3 block text-xs text-zinc-600 dark:text-zinc-300"
              htmlFor="new-branch-name"
            >
              新分支名称
            </label>
            <input
              id="new-branch-name"
              value={newBranchName}
              onChange={(event) => setNewBranchName(event.target.value)}
              placeholder="feature/demo"
              className="mt-1 h-9 w-full max-w-sm rounded-lg border border-black/[.08] bg-white px-3 text-xs text-zinc-700 placeholder:text-zinc-400 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
            />
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {branchNameError ?? `起点：提交 ${shortSha(branchStart?.oid ?? "")}`}
            </p>
          </ConfirmCard>
        </div>
      ) : null}

      {issueOpen ? (
        <div className="mt-3">
          <CreateIssuePanel
            owner={owner}
            name={name}
            onCreated={handleIssueCreated}
            onCancel={() => setIssueOpen(false)}
          />
        </div>
      ) : null}

      {pullOpen ? (
        <div className="mt-3">
          <CreatePullPanel
            owner={owner}
            name={name}
            branches={branches.map((branch) => branch.name)}
            defaultBase={initialBranch}
            onCreated={handlePullCreated}
            onCancel={() => setPullOpen(false)}
          />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <input
          type="search"
          value={filters.query}
          onChange={(event) => applyFilterPatch({ query: event.target.value })}
          placeholder="搜索提交 / SHA / 作者"
          aria-label="搜索提交"
          className="h-9 w-56 rounded-lg border border-black/[.08] bg-white px-3 text-xs text-zinc-700 placeholder:text-zinc-400 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
        />
        <select
          value={filters.author}
          onChange={(event) => applyFilterPatch({ author: event.target.value })}
          aria-label="按作者过滤"
          className="h-9 max-w-[12rem] rounded-lg border border-black/[.08] bg-white px-2 text-xs text-zinc-700 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
        >
          <option value="">全部作者</option>
          {authors.map((author) => (
            <option key={author} value={author}>
              {author}
            </option>
          ))}
        </select>
        <select
          value={filters.kind}
          onChange={(event) => applyFilterPatch({ kind: event.target.value as TimelineEventKind })}
          aria-label="按事件类型过滤"
          className="h-9 rounded-lg border border-black/[.08] bg-white px-2 text-xs text-zinc-700 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
        >
          <option value="all">全部事件</option>
          <option value="merge">仅合并提交</option>
          <option value="pullRequest">仅关联 PR</option>
          <option value="issue">仅关联 Issue</option>
        </select>
        <select
          value={filters.range}
          onChange={(event) => applyFilterPatch({ range: event.target.value as TimelineRange })}
          aria-label="时间范围"
          className="h-9 rounded-lg border border-black/[.08] bg-white px-2 text-xs text-zinc-700 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
        >
          <option value="all">全部时间</option>
          <option value="week">近一周</option>
          <option value="month">近一月</option>
        </select>
        {activeFilters ? (
          <>
            <span className="text-zinc-500 dark:text-zinc-400">
              筛选后 {filteredCommits.length} / {commits.length} 条
            </span>
            <button
              type="button"
              onClick={() => applyFilterPatch(EMPTY_TIMELINE_FILTER)}
              className="h-9 rounded-full border border-black/[.08] px-4 text-xs text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
            >
              清除筛选
            </button>
          </>
        ) : null}
      </div>

      {commits.length === 0 ? (
        <div className="mt-3 rounded-xl border border-black/[.08] bg-white p-6 text-sm text-zinc-600 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-300">
          该分支暂无提交（空仓库或分支没有历史）。
        </div>
      ) : (
        <>
          {filteredCommits.length === 0 ? (
            <div className="mt-3 rounded-xl border border-black/[.08] bg-white p-6 text-sm text-zinc-600 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-300">
              <p>没有匹配的提交（已加载 {commits.length} 条）。</p>
              <button
                type="button"
                onClick={() => applyFilterPatch(EMPTY_TIMELINE_FILTER)}
                className="mt-2 underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                清除筛选
              </button>
            </div>
          ) : (
            <div
              ref={containerRef}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              role="list"
              aria-label="提交时间线"
              className="mt-3 h-[65vh] overflow-y-auto overscroll-contain rounded-xl border border-black/[.08] bg-white dark:border-white/[.145] dark:bg-zinc-950"
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
                      rowHeight={ROW_HEIGHT}
                      laneWidth={laneWidth}
                      height={laneSlice.nodes.length * ROW_HEIGHT}
                      className="absolute left-0 top-0"
                    />
                  ) : null}
                  {visibleCommits.map((commit) => (
                    <div
                      key={commit.oid}
                      style={{ height: ROW_HEIGHT, paddingLeft: gutterWidth }}
                      role="listitem"
                    >
                      <CommitRow
                        commit={commit}
                        nowMs={nowMs}
                        mode={explainMode}
                        repoUrl={`https://github.com/${owner}/${name}`}
                        onSelect={setSelectedCommit}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3 text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">
              {loading ? "加载中…" : hasNextPage ? "滚动到底部自动加载更多" : "已到最底部"}
            </span>
            {hasNextPage ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loading}
                className="h-9 rounded-full border border-black/[.08] px-4 text-xs font-medium text-zinc-900 transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-white/[.08]"
              >
                {loading ? "加载中…" : "加载更多"}
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
