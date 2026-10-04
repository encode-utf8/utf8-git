import type { RepoSummary } from "./github-repos";

export type VisibilityFilter = "all" | "public" | "private";
export type RepoSort = "updated" | "name";

export type RepoFilterOptions = {
  query: string;
  visibility: VisibilityFilter;
  sort: RepoSort;
};

// 前端即时过滤/排序（纯函数，便于单测与复用）
export function filterRepos(repos: RepoSummary[], options: RepoFilterOptions): RepoSummary[] {
  const query = options.query.trim().toLowerCase();

  const filtered = repos.filter((repo) => {
    if (options.visibility === "public" && repo.isPrivate) {
      return false;
    }
    if (options.visibility === "private" && !repo.isPrivate) {
      return false;
    }
    if (!query) {
      return true;
    }
    return (
      repo.name.toLowerCase().includes(query) ||
      repo.fullName.toLowerCase().includes(query) ||
      (repo.description?.toLowerCase().includes(query) ?? false)
    );
  });

  return [...filtered].sort((a, b) => {
    if (options.sort === "name") {
      return a.fullName.localeCompare(b.fullName, "en");
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}
