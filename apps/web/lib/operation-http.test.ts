import { describe, expect, it } from "vitest";

import type { OperationAuditQuery, OperationAuditStoreLike } from "./operation-audit";
import { enforceWriteRateLimit } from "./operation-http";

function auditStub(options: { recent: number; oldest?: string | null }) {
  const queries: OperationAuditQuery[] = [];
  let oldestCalls = 0;
  const store = {
    find: async () => null,
    append: async () => {},
    list: async () => [],
    listOperations: async () => [],
    count: async (query: OperationAuditQuery = {}) => {
      queries.push(query);
      return options.recent;
    },
    oldestRecordedAt: async () => {
      oldestCalls += 1;
      return options.oldest ?? null;
    },
    prune: async () => 0,
  } satisfies OperationAuditStoreLike;
  return { store, queries, oldestCalls: () => oldestCalls };
}

const ENV = { WRITE_OPERATION_LIMIT: "20", WRITE_OPERATION_WINDOW_MS: "60000" };
const NOW = new Date("2026-10-10T00:01:00.000Z");

describe("写操作频率限制守卫", () => {
  it("未超限放行，只查一次计数（不额外查最早记录）", async () => {
    const { store, queries, oldestCalls } = auditStub({ recent: 19 });
    const response = await enforceWriteRateLimit("u1", { audit: store, env: ENV, now: NOW });

    expect(response).toBeNull();
    expect(queries).toEqual([
      { actor: "u1", status: "started", since: "2026-10-10T00:00:00.000Z" },
    ]);
    expect(oldestCalls()).toBe(0);
  });

  it("达到上限返回 429，Retry-After 取最早记录滑出窗口的剩余时间", async () => {
    const { store } = auditStub({ recent: 20, oldest: "2026-10-10T00:00:30.000Z" });
    const response = await enforceWriteRateLimit("u1", { audit: store, env: ENV, now: NOW });

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("30");
    await expect(response?.json()).resolves.toMatchObject({
      error: "too_many_requests",
      limit: 20,
      retryAfterMs: 30_000,
    });
  });

  it("拿不到最早记录时回退为整个窗口（保守值）", async () => {
    const { store } = auditStub({ recent: 20, oldest: null });
    const response = await enforceWriteRateLimit("u1", { audit: store, env: ENV, now: NOW });

    expect(response?.headers.get("retry-after")).toBe("60");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    await expect(response?.json()).resolves.toMatchObject({ retryAfterMs: 60_000 });
  });
});
