import { describe, expect, it } from "vitest";

import { loadCommitDetail } from "./commit-data";
import { type CommitCacheValue } from "./data-stores";
import { GitHubNotFoundError, GitHubRateLimitError } from "./github-errors";
import { type CommitDetail, fetchCommitDetail } from "./github-commits";
import { RateLimitStore } from "./rate-limit-store";
import { TtlCache } from "./server-cache";

function makeCommit(sha: string): CommitDetail {
  return {
    sha,
    message: "feat: 提交",
    headline: "feat: 提交",
    author: { login: "u", name: "u", avatarUrl: null, date: "2026-10-06T00:00:00Z" },
    committerDate: "2026-10-06T00:00:00Z",
    stats: { additions: 1, deletions: 0, total: 1 },
    files: [],
    filesTruncated: false,
    parents: [],
    htmlUrl: null,
  };
}

function makeDeps(options: { now: () => number; ttlMs?: number }) {
  const cache = new TtlCache<CommitCacheValue>({
    ttlMs: options.ttlMs ?? 1000,
    now: options.now,
  });
  const rateLimitStore = new RateLimitStore();
  return { cache, rateLimitStore, now: options.now };
}

const params = { userId: "u1", token: "t", owner: "o", name: "n", sha: "abcdef1" };

describe("loadCommitDetail", () => {
  it("首次请求写入缓存；TTL 内重复请求命中缓存", async () => {
    let calls = 0;
    const fetchDetail = (async () => {
      calls += 1;
      return {
        commit: makeCommit("abcdef1"),
        rateLimit: { limit: 5000, remaining: 4999, resetAt: null },
      };
    }) as unknown as typeof fetchCommitDetail;
    const deps = makeDeps({ now: () => 1_000_000 });

    const first = await loadCommitDetail(params, { fetchDetail, ...deps, threshold: 100 });
    const second = await loadCommitDetail(params, { fetchDetail, ...deps, threshold: 100 });

    expect(calls).toBe(1);
    expect(first.meta.cached).toBe(false);
    expect(second.meta.cached).toBe(true);
    expect(second.meta.degraded).toBe(false);
  });

  it("配额低于阈值 + 陈旧缓存 → 降级展示（stale=true）", async () => {
    let calls = 0;
    const fetchDetail = (async () => {
      calls += 1;
      return {
        commit: makeCommit("abcdef1"),
        rateLimit: { limit: 5000, remaining: 10, resetAt: new Date(3_600_000_000) },
      };
    }) as unknown as typeof fetchCommitDetail;
    let now = 1_000_000;
    const deps = makeDeps({ now: () => now });

    await loadCommitDetail(params, { fetchDetail, ...deps, threshold: 100 });
    now += 2000;
    const degraded = await loadCommitDetail(params, { fetchDetail, ...deps, threshold: 100 });

    expect(calls).toBe(1);
    expect(degraded.meta.degraded).toBe(true);
    expect(degraded.meta.stale).toBe(true);
    expect(degraded.meta.resetAt).not.toBeNull();
  });

  it("配额低于阈值且无缓存 → 抛出带恢复时间的限流错误（不发请求）", async () => {
    let calls = 0;
    const fetchDetail = (async () => {
      calls += 1;
      return { commit: makeCommit("abcdef1"), rateLimit: null };
    }) as unknown as typeof fetchCommitDetail;
    const deps = makeDeps({ now: () => 1_000_000 });
    deps.rateLimitStore.record("u1", {
      limit: null,
      remaining: 0,
      resetAt: new Date(3_600_000_000),
      cost: null,
      source: "rest",
      recordedAt: 1_000_000,
    });

    const error = await loadCommitDetail(params, {
      fetchDetail,
      ...deps,
      threshold: 100,
    }).catch((value: unknown) => value);

    expect(calls).toBe(0);
    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect((error as GitHubRateLimitError).resetAt).toEqual(new Date(3_600_000_000));
  });

  it("GitHub 返回 429 且有陈旧缓存 → 降级展示", async () => {
    let calls = 0;
    const okFetch = (async () => {
      calls += 1;
      return { commit: makeCommit("abcdef1"), rateLimit: null };
    }) as unknown as typeof fetchCommitDetail;
    let now = 1_000_000;
    const deps = makeDeps({ now: () => now });

    await loadCommitDetail(params, { fetchDetail: okFetch, ...deps, threshold: 0 });
    now += 2000;
    const failFetch = (async () => {
      calls += 1;
      throw new GitHubRateLimitError("配额超限", new Date(3_600_000_000));
    }) as unknown as typeof fetchCommitDetail;
    const degraded = await loadCommitDetail(params, {
      fetchDetail: failFetch,
      ...deps,
      threshold: 0,
    });

    expect(calls).toBe(2);
    expect(degraded.meta.degraded).toBe(true);
    expect(degraded.meta.stale).toBe(true);
  });

  it("404 不写入缓存，重复请求会再次尝试", async () => {
    let calls = 0;
    const failFetch = (async () => {
      calls += 1;
      throw new GitHubNotFoundError();
    }) as unknown as typeof fetchCommitDetail;
    const deps = makeDeps({ now: () => 1_000_000 });

    await expect(
      loadCommitDetail(params, { fetchDetail: failFetch, ...deps }),
    ).rejects.toBeInstanceOf(GitHubNotFoundError);
    await expect(
      loadCommitDetail(params, { fetchDetail: failFetch, ...deps }),
    ).rejects.toBeInstanceOf(GitHubNotFoundError);

    expect(calls).toBe(2);
  });
});
