"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useTranslator } from "@/lib/i18n/client";
import { fetchWithRetry } from "@/lib/client-fetch";
import { OnlineRequestError, describeApiFailure, type OnlineErrorInfo } from "@/lib/error-state";
import type { RepoSummary } from "@/lib/github-repos";
import type { MessageKey } from "@/lib/i18n/translate";
import { filterRepos, type RepoSort, type VisibilityFilter } from "@/lib/repo-filters";

type RepoListProps = {
  initialRepos: RepoSummary[];
  initialHasMore: boolean;
  initialNextPage: number | null;
};

const VISIBILITY_OPTIONS: { value: VisibilityFilter; labelKey: MessageKey }[] = [
  { value: "all", labelKey: "repoList.visibilityAll" },
  { value: "public", labelKey: "common.public" },
  { value: "private", labelKey: "common.private" },
];

// 统一显示为 YYYY-MM-DD，保证服务端渲染与客户端水合结果一致
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
}

function VisibilityBadge({ isPrivate }: { isPrivate: boolean }) {
  const { t } = useTranslator();
  if (isPrivate) {
    return (
      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        {t("common.private")}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      {t("common.public")}
    </span>
  );
}

export function RepoList({ initialRepos, initialHasMore, initialNextPage }: RepoListProps) {
  const { t } = useTranslator();
  const [repos, setRepos] = useState(initialRepos);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextPage, setNextPage] = useState(initialNextPage);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<OnlineErrorInfo | null>(null);
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
      const response = await fetchWithRetry(`/api/repos?page=${nextPage}`);
      const data = (await response.json()) as {
        repos: RepoSummary[];
        hasMore: boolean;
        nextPage: number | null;
      };
      setRepos((prev) => [...prev, ...data.repos]);
      setHasMore(data.hasMore);
      setNextPage(data.nextPage);
    } catch (error) {
      setLoadError(
        error instanceof OnlineRequestError ? error.info : describeApiFailure(500, null),
      );
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
          placeholder={t("repoList.searchPlaceholder")}
          aria-label={t("repoList.searchLabel")}
          className="h-10 w-full rounded-lg border border-black/[.08] bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-100 sm:max-w-xs"
        />
        <div className="flex items-center gap-2" role="group" aria-label={t("repoList.visibilityLabel")}>
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
              {t(option.labelKey)}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as RepoSort)}
          aria-label={t("repoList.sortLabel")}
          className="h-9 rounded-lg border border-black/[.08] bg-white px-2 text-xs text-zinc-700 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
        >
          <option value="updated">{t("repoList.sortUpdated")}</option>
          <option value="name">{t("repoList.sortName")}</option>
        </select>
      </div>

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        {t("repoList.count", { count: repos.length })}
        {visibleRepos.length !== repos.length
          ? t("repoList.countFiltered", { count: visibleRepos.length })
          : ""}
      </p>

      {visibleRepos.length === 0 ? (
        <div className="mt-6 rounded-xl border border-black/[.08] bg-white p-6 text-sm text-zinc-600 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-300">
          <p>{t("repoList.empty")}</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setVisibility("all");
            }}
            className="mt-3 text-sm font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
          >
            {t("repoList.clearFilters")}
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
                  <Link
                    href={`/repos/${repo.owner}/${repo.name}`}
                    className="break-all font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
                  >
                    {repo.fullName}
                  </Link>
                  {repo.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                      {repo.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <a
                    href={repo.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("repoList.openOnGithub", { name: repo.fullName })}
                    className="rounded-full border border-black/[.08] px-2 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-400 dark:hover:bg-white/[.08]"
                  >
                    GitHub ↗
                  </a>
                  <VisibilityBadge isPrivate={repo.isPrivate} />
                  {repo.isFork ? (
                    <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                      Fork
                    </span>
                  ) : null}
                  {repo.isArchived ? (
                    <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                      {t("repoList.archived")}
                    </span>
                  ) : null}
                </div>
              </div>
              <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                {repo.defaultBranch ? (
                  <span>{t("repoList.defaultBranch", { branch: repo.defaultBranch })}</span>
                ) : null}
                {repo.language ? <span>{repo.language}</span> : null}
                <span>{t("repoList.stars", { count: repo.stars })}</span>
                <span>{t("repoList.updatedAt", { date: formatDate(repo.updatedAt) })}</span>
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
            {loading ? t("common.loading") : loadError ? loadError.action : t("repoList.loadMore")}
          </button>
          {loadError ? (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              <span className="font-medium">{loadError.title}</span>：{loadError.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
