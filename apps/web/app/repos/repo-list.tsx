"use client";

import { useMemo, useState } from "react";

import type { RepoSummary } from "@/lib/github-repos";
import { filterRepos, type RepoSort, type VisibilityFilter } from "@/lib/repo-filters";

type RepoListProps = {
  initialRepos: RepoSummary[];
  initialHasMore: boolean;
  initialNextPage: number | null;
};

const VISIBILITY_OPTIONS: { value: VisibilityFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "public", label: "公开" },
  { value: "private", label: "私有" },
];

// 统一显示为 YYYY-MM-DD，保证服务端渲染与客户端水合结果一致
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
}

function VisibilityBadge({ isPrivate }: { isPrivate: boolean }) {
  if (isPrivate) {
    return (
      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        私有
      </span>
    );
  }
  return (
    <span className="rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      公开
    </span>
  );
}

export function RepoList({ initialRepos, initialHasMore, initialNextPage }: RepoListProps) {
  const [repos, setRepos] = useState(initialRepos);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextPage, setNextPage] = useState(initialNextPage);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");
  const [sort, setSort] = useState<RepoSort>("updated");

  const visibleRepos = useMemo(
    () => filterRepos(repos, { query, visibility, sort }),
    [repos, query, visibility, sort],
  );

  async function loadMore() {
    if (!nextPage || loading) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/repos?page=${nextPage}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as {
        repos: RepoSummary[];
        hasMore: boolean;
        nextPage: number | null;
      };
      setRepos((prev) => [...prev, ...data.repos]);
      setHasMore(data.hasMore);
      setNextPage(data.nextPage);
    } catch {
      setLoadError("加载更多失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索仓库名称或描述"
          aria-label="搜索仓库"
          className="h-10 w-full rounded-lg border border-black/[.08] bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-100 sm:max-w-xs"
        />
        <div className="flex items-center gap-2" role="group" aria-label="可见性过滤">
          {VISIBILITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setVisibility(option.value)}
              aria-pressed={visibility === option.value}
              className={`h-9 rounded-full px-3 text-xs transition-colors ${
                visibility === option.value
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-black/[.08] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as RepoSort)}
          aria-label="排序方式"
          className="h-9 rounded-lg border border-black/[.08] bg-white px-2 text-xs text-zinc-700 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
        >
          <option value="updated">最近更新</option>
          <option value="name">名称</option>
        </select>
      </div>

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        共 {repos.length} 个仓库
        {visibleRepos.length !== repos.length ? `，当前显示 ${visibleRepos.length} 个` : ""}
      </p>

      {visibleRepos.length === 0 ? (
        <div className="mt-6 rounded-xl border border-black/[.08] bg-white p-6 text-sm text-zinc-600 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-300">
          <p>没有匹配的仓库。</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setVisibility("all");
            }}
            className="mt-3 text-sm font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
          >
            清除筛选条件
          </button>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {visibleRepos.map((repo) => (
            <li
              key={repo.id}
              className="rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <a
                    href={repo.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
                  >
                    {repo.fullName}
                  </a>
                  {repo.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                      {repo.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <VisibilityBadge isPrivate={repo.isPrivate} />
                  {repo.isFork ? (
                    <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                      Fork
                    </span>
                  ) : null}
                  {repo.isArchived ? (
                    <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                      已归档
                    </span>
                  ) : null}
                </div>
              </div>
              <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                {repo.defaultBranch ? <span>默认分支 {repo.defaultBranch}</span> : null}
                {repo.language ? <span>{repo.language}</span> : null}
                <span>★ {repo.stars}</span>
                <span>更新于 {formatDate(repo.updatedAt)}</span>
              </dl>
            </li>
          ))}
        </ul>
      )}

      {hasMore ? (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="h-10 rounded-full border border-black/[.08] px-5 text-sm font-medium text-zinc-900 transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-white/[.08]"
          >
            {loading ? "加载中…" : "加载更多"}
          </button>
          {loadError ? (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{loadError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
