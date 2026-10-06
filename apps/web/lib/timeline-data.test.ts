import { describe, expect, it } from "vitest";

import { type CursorChain, type TimelineCacheValue } from "./data-stores";
import { GitHubRateLimitError } from "./github-errors";
import { type TimelineData, fetchTimelinePage } from "./github-timeline";
import { RateLimitStore } from "./rate-limit-store";
import { TtlCache } from "./server-cache";
import { TimelineCursorExpiredError, loadTimelinePage } from "./timeline-data";

function makeTimeline(overrides: Partial<TimelineData> = {}): TimelineData {
  return {
    repo: { nameWithOwner: "o/n", description: null, isPrivate: false, defaultBranch: "main" },
    branch: "main",
    commits: [
      {
        oid: "c1",
        headline: "feat: 提交",
        committedDate: "2026-10-05T00:00:00Z",
        author: { login: "l", name: "n", avatarUrl: null },
        parents: [],
        pullRequests: [],
      },
    ],
    branches: [{ name: "main", headOid: "c1", committedDate: "2026-10-05T00:00:00Z" }],
    pageInfo: { hasNextPage: true, endCursor: "cursor-page1" },
    ...overrides,
  };
}

function makeDeps(options: { now: () => number; ttlMs?: number }) {
  const cache = new TtlCache<TimelineCacheValue>({
    ttlMs: options.ttlMs ?? 2000,
    now: options.now,
  });
  const cursorCache = new TtlCache<CursorChain>({ ttlMs: 30_000, now: options.now });
  const rateLimitStore = new RateLimitStore();
  return { cache, cursorCache, rateLimitStore, now: options.now };
}

describe("loadTimelinePage", () => {
  it("第 1 页单次请求；TTL 内重复请求命中缓存", async () => {
    let calls = 0;
    const fetchPage = (async () => {
      calls += 1;
      return {
        data: makeTimeline(),
        rateLimit: { limit: 5000, cost: 1, remaining: 4999, resetAt: new Date(3_600_000_000) },
        warnings: [],
      };
    }) as unknown as typeof fetchTimelinePage;
    const deps = makeDeps({ now: () => 1_000_000 });

    const first = await loadTimelinePage(
      { userId: "u1", token: "t", owner: "o", name: "n" },
      { fetchPage, ...deps, threshold: 100 },
    );
    const second = await loadTimelinePage(
      { userId: "u1", token: "t", owner: "o", name: "n" },
      { fetchPage, ...deps, threshold: 100 },
    );

    expect(calls).toBe(1);
    expect(first.meta.cached).toBe(false);
    expect(first.meta.pageSize).toBe(50);
    expect(second.meta.cached).toBe(true);
    expect(second.meta.degraded).toBe(false);
  });

  it("第 2 页使用第 1 页的 endCursor；已加载页不重复请求", async () => {
    const cursors: Array<string | null | undefined> = [];
    const fetchPage = (async (params: { cursor?: string | null }) => {
      cursors.push(params.cursor);
      return {
        data: makeTimeline({
          pageInfo: {
            hasNextPage: true,
            endCursor: params.cursor ? "cursor-page2" : "cursor-page1",
          },
        }),
        rateLimit: null,
        warnings: [],
      };
    }) as unknown as typeof fetchTimelinePage;
    const deps = makeDeps({ now: () => 1_000_000 });

    await loadTimelinePage(
      { userId: "u1", token: "t", owner: "o", name: "n" },
      { fetchPage, ...deps, threshold: 100 },
    );
    const page2 = await loadTimelinePage(
      { userId: "u1", token: "t", owner: "o", name: "n", page: 2 },
      { fetchPage, ...deps, threshold: 100 },
    );
    const page1Again = await loadTimelinePage(
      { userId: "u1", token: "t", owner: "o", name: "n", page: 1 },
      { fetchPage, ...deps, threshold: 100 },
    );

    expect(cursors).toEqual([null, "cursor-page1"]);
    expect(page2.meta.page).toBe(2);
    expect(page1Again.meta.cached).toBe(true);
  });

  it("跳到第 2 页但缺少 cursor 链 → TimelineCursorExpiredError", async () => {
    let calls = 0;
    const fetchPage = (async () => {
      calls += 1;
      return { data: makeTimeline(), rateLimit: null, warnings: [] };
    }) as unknown as typeof fetchTimelinePage;
    const deps = makeDeps({ now: () => 1_000_000 });

    await expect(
      loadTimelinePage(
        { userId: "u1", token: "t", owner: "o", name: "n", page: 2 },
        { fetchPage, ...deps, threshold: 100 },
      ),
    ).rejects.toBeInstanceOf(TimelineCursorExpiredError);
    expect(calls).toBe(0);
  });

  it("配额低于阈值 + 陈旧缓存 → 降级展示（stale=true，带恢复时间）", async () => {
    let calls = 0;
    const fetchPage = (async () => {
      calls += 1;
      return {
        data: makeTimeline(),
        rateLimit: { limit: 5000, cost: 1, remaining: 20, resetAt: new Date(3_600_000_000) },
        warnings: [],
      };
    }) as unknown as typeof fetchTimelinePage;
    let now = 1_000_000;
    const deps = makeDeps({ now: () => now });

    await loadTimelinePage(
      { userId: "u1", token: "t", owner: "o", name: "n" },
      { fetchPage, ...deps, threshold: 100 },
    );
    now += 3000;
    const degraded = await loadTimelinePage(
      { userId: "u1", token: "t", owner: "o", name: "n" },
      { fetchPage, ...deps, threshold: 100 },
    );

    expect(calls).toBe(1);
    expect(degraded.meta.degraded).toBe(true);
    expect(degraded.meta.stale).toBe(true);
    expect(degraded.meta.resetAt).toBe(new Date(3_600_000_000).toISOString());
  });

  it("GraphQL 抛限流错误且有陈旧缓存 → 降级展示", async () => {
    let calls = 0;
    const okFetch = (async () => {
      calls += 1;
      return { data: makeTimeline(), rateLimit: null, warnings: [] };
    }) as unknown as typeof fetchTimelinePage;
    let now = 1_000_000;
    const deps = makeDeps({ now: () => now });

    await loadTimelinePage(
      { userId: "u1", token: "t", owner: "o", name: "n" },
      { fetchPage: okFetch, ...deps, threshold: 0 },
    );
    now += 3000;
    const failFetch = (async () => {
      calls += 1;
      throw new GitHubRateLimitError("配额超限", new Date(3_600_000_000));
    }) as unknown as typeof fetchTimelinePage;
    const degraded = await loadTimelinePage(
      { userId: "u1", token: "t", owner: "o", name: "n" },
      { fetchPage: failFetch, ...deps, threshold: 0 },
    );

    expect(calls).toBe(2);
    expect(degraded.meta.degraded).toBe(true);
    expect(degraded.meta.stale).toBe(true);
  });

  it("GraphQL 抛限流错误且无缓存 → 抛出带恢复时间的限流错误", async () => {
    const failFetch = (async () => {
      throw new GitHubRateLimitError("配额超限", null);
    }) as unknown as typeof fetchTimelinePage;
    const deps = makeDeps({ now: () => 1_000_000 });

    const error = await loadTimelinePage(
      { userId: "u1", token: "t", owner: "o", name: "n" },
      { fetchPage: failFetch, ...deps, threshold: 100 },
    ).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect((error as GitHubRateLimitError).resetAt).not.toBeNull();
  });

  it("部分失败 warnings 透传到 meta", async () => {
    const fetchPage = (async () => ({
      data: makeTimeline(),
      rateLimit: null,
      warnings: ["部分字段失败"],
    })) as unknown as typeof fetchTimelinePage;
    const deps = makeDeps({ now: () => 1_000_000 });

    const result = await loadTimelinePage(
      { userId: "u1", token: "t", owner: "o", name: "n" },
      { fetchPage, ...deps, threshold: 100 },
    );
    expect(result.meta.warnings).toEqual(["部分字段失败"]);
  });
});
