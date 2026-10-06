import { describe, expect, it } from "vitest";

import { type ReposCacheValue } from "./data-stores";
import { GitHubRateLimitError, GitHubUnauthorizedError } from "./github-errors";
import { type RepoPage, fetchViewerReposPage } from "./github-repos";
import { RateLimitStore } from "./rate-limit-store";
import { loadReposPage } from "./repos-data";
import { TtlCache } from "./server-cache";

function makePage(overrides: Partial<RepoPage> = {}): RepoPage {
  return { repos: [], hasMore: false, nextPage: null, sso: null, rateLimit: null, ...overrides };
}

function makeDeps(options: { now: () => number; ttlMs?: number }) {
  const cache = new TtlCache<ReposCacheValue>({ ttlMs: options.ttlMs ?? 1000, now: options.now });
  const rateLimitStore = new RateLimitStore();
  return { cache, rateLimitStore, now: options.now };
}

describe("loadReposPage", () => {
  it("首次请求后写入 TTL 缓存；TTL 内重复请求不再访问 GitHub", async () => {
    let calls = 0;
    const fetchPage = (async () => {
      calls += 1;
      return makePage({ rateLimit: { limit: 5000, remaining: 4999, resetAt: null } });
    }) as unknown as typeof fetchViewerReposPage;
    const deps = makeDeps({ now: () => 1_000_000 });

    const first = await loadReposPage(
      { userId: "u1", token: "t" },
      { fetchPage, ...deps, threshold: 100 },
    );
    const second = await loadReposPage(
      { userId: "u1", token: "t" },
      { fetchPage, ...deps, threshold: 100 },
    );

    expect(first.meta.cached).toBe(false);
    expect(second.meta.cached).toBe(true);
    expect(second.meta.degraded).toBe(false);
    expect(calls).toBe(1);
  });

  it("缓存过期后重新请求", async () => {
    let calls = 0;
    const fetchPage = (async () => {
      calls += 1;
      return makePage();
    }) as unknown as typeof fetchViewerReposPage;
    let now = 1_000_000;
    const deps = makeDeps({ now: () => now });

    await loadReposPage({ userId: "u1", token: "t" }, { fetchPage, ...deps, threshold: 100 });
    now += 1000;
    const refreshed = await loadReposPage(
      { userId: "u1", token: "t" },
      { fetchPage, ...deps, threshold: 100 },
    );

    expect(calls).toBe(2);
    expect(refreshed.meta.cached).toBe(false);
  });

  it("配额低于阈值 + 有新缓存 → 降级展示，不发新请求", async () => {
    let calls = 0;
    const fetchPage = (async () => {
      calls += 1;
      return makePage({
        rateLimit: { limit: 5000, remaining: 20, resetAt: new Date(3_600_000_000) },
      });
    }) as unknown as typeof fetchViewerReposPage;
    const deps = makeDeps({ now: () => 1_000_000 });

    await loadReposPage({ userId: "u1", token: "t" }, { fetchPage, ...deps, threshold: 100 });
    const degraded = await loadReposPage(
      { userId: "u1", token: "t" },
      { fetchPage, ...deps, threshold: 100 },
    );

    expect(calls).toBe(1);
    expect(degraded.meta.cached).toBe(true);
    expect(degraded.meta.stale).toBe(false);
    expect(degraded.meta.degraded).toBe(true);
    expect(degraded.meta.resetAt).not.toBeNull();
  });

  it("配额低于阈值 + 陈旧缓存 → 降级展示陈旧数据（stale=true）", async () => {
    let calls = 0;
    const fetchPage = (async () => {
      calls += 1;
      return makePage({
        rateLimit: { limit: 5000, remaining: 10, resetAt: new Date(3_600_000_000) },
      });
    }) as unknown as typeof fetchViewerReposPage;
    let now = 1_000_000;
    const deps = makeDeps({ now: () => now });

    await loadReposPage({ userId: "u1", token: "t" }, { fetchPage, ...deps, threshold: 100 });
    now += 2000;
    const degraded = await loadReposPage(
      { userId: "u1", token: "t" },
      { fetchPage, ...deps, threshold: 100 },
    );

    expect(calls).toBe(1);
    expect(degraded.meta.degraded).toBe(true);
    expect(degraded.meta.stale).toBe(true);
  });

  it("配额低于阈值且无缓存 → 抛出带恢复时间的 GitHubRateLimitError", async () => {
    const fetchPage = (async () => makePage()) as unknown as typeof fetchViewerReposPage;
    const deps = makeDeps({ now: () => 1_000_000 });
    deps.rateLimitStore.record("u1", {
      limit: null,
      remaining: 0,
      resetAt: new Date(3_600_000_000),
      cost: null,
      source: "rest",
      recordedAt: 1_000_000,
    });

    const error = await loadReposPage(
      { userId: "u1", token: "t" },
      { fetchPage, ...deps, threshold: 100 },
    ).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect((error as GitHubRateLimitError).resetAt).toEqual(new Date(3_600_000_000));
  });

  it("GitHub 返回 429 且有陈旧缓存 → 降级展示", async () => {
    let calls = 0;
    const okFetch = (async () => {
      calls += 1;
      return makePage();
    }) as unknown as typeof fetchViewerReposPage;
    let now = 1_000_000;
    const deps = makeDeps({ now: () => now });

    await loadReposPage(
      { userId: "u1", token: "t" },
      { fetchPage: okFetch, ...deps, threshold: 0 },
    );
    now += 2000;
    const failFetch = (async () => {
      calls += 1;
      throw new GitHubRateLimitError("配额超限", new Date(3_600_000_000));
    }) as unknown as typeof fetchViewerReposPage;
    const degraded = await loadReposPage(
      { userId: "u1", token: "t" },
      { fetchPage: failFetch, ...deps, threshold: 0 },
    );

    expect(calls).toBe(2);
    expect(degraded.meta.degraded).toBe(true);
    expect(degraded.meta.stale).toBe(true);
    expect(degraded.meta.resetAt).toBe(new Date(3_600_000_000).toISOString());
  });

  it("GitHub 返回 429 且无缓存 → 抛出限流错误（含回退恢复时间）", async () => {
    const failFetch = (async () => {
      throw new GitHubRateLimitError("配额超限", null);
    }) as unknown as typeof fetchViewerReposPage;
    const deps = makeDeps({ now: () => 1_000_000 });

    const error = await loadReposPage(
      { userId: "u1", token: "t" },
      { fetchPage: failFetch, ...deps, threshold: 100 },
    ).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect((error as GitHubRateLimitError).resetAt).not.toBeNull();
  });

  it("401 不写入缓存，重复请求会再次尝试 GitHub", async () => {
    let calls = 0;
    const failFetch = (async () => {
      calls += 1;
      throw new GitHubUnauthorizedError();
    }) as unknown as typeof fetchViewerReposPage;
    const deps = makeDeps({ now: () => 1_000_000 });

    await expect(
      loadReposPage({ userId: "u1", token: "t" }, { fetchPage: failFetch, ...deps }),
    ).rejects.toBeInstanceOf(GitHubUnauthorizedError);
    await expect(
      loadReposPage({ userId: "u1", token: "t" }, { fetchPage: failFetch, ...deps }),
    ).rejects.toBeInstanceOf(GitHubUnauthorizedError);

    expect(calls).toBe(2);
  });
});
