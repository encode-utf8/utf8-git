import { describe, expect, it } from "vitest";

import type { RepoSummary } from "./github-repos";
import { filterRepos } from "./repo-filters";

function makeRepo(overrides: Partial<RepoSummary>): RepoSummary {
  return {
    id: 1,
    name: "repo",
    fullName: "owner/repo",
    owner: "owner",
    description: null,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    defaultBranch: "main",
    language: "TypeScript",
    stars: 0,
    updatedAt: "2026-10-01T00:00:00Z",
    htmlUrl: "https://github.com/owner/repo",
    ...overrides,
  };
}

const repos: RepoSummary[] = [
  makeRepo({
    id: 1,
    name: "alpha",
    fullName: "team/alpha",
    description: "时间线可视化",
    updatedAt: "2026-10-03T00:00:00Z",
  }),
  makeRepo({
    id: 2,
    name: "beta",
    fullName: "team/beta",
    isPrivate: true,
    updatedAt: "2026-10-04T00:00:00Z",
  }),
  makeRepo({
    id: 3,
    name: "gamma",
    fullName: "other/gamma",
    description: "PRIVATE dashboard",
    updatedAt: "2026-10-02T00:00:00Z",
  }),
];

describe("filterRepos", () => {
  it("按可见性过滤", () => {
    expect(
      filterRepos(repos, { query: "", visibility: "private", sort: "updated" }).map((r) => r.id),
    ).toEqual([2]);
    expect(
      filterRepos(repos, { query: "", visibility: "public", sort: "updated" }).map((r) => r.id),
    ).toEqual([1, 3]);
  });

  it("按名称/描述搜索且不区分大小写", () => {
    expect(
      filterRepos(repos, { query: "ALPHA", visibility: "all", sort: "updated" }).map((r) => r.id),
    ).toEqual([1]);
    expect(
      filterRepos(repos, { query: "private", visibility: "all", sort: "updated" }).map((r) => r.id),
    ).toEqual([3]);
  });

  it("按最近更新倒序或按名称排序", () => {
    expect(
      filterRepos(repos, { query: "", visibility: "all", sort: "updated" }).map((r) => r.id),
    ).toEqual([2, 1, 3]);
    expect(
      filterRepos(repos, { query: "", visibility: "all", sort: "name" }).map((r) => r.fullName),
    ).toEqual(["other/gamma", "team/alpha", "team/beta"]);
  });

  it("不修改原数组", () => {
    const snapshot = repos.map((repo) => repo.id);
    filterRepos(repos, { query: "", visibility: "all", sort: "name" });
    expect(repos.map((repo) => repo.id)).toEqual(snapshot);
  });
});
