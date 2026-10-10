import { describe, expect, it } from "vitest";

import type { OperationAuditQuery, OperationAuditStoreLike } from "./operation-audit";
import { enforceWriteRateLimit } from "./operation-http";

function auditStub(recent: number) {
  const queries: OperationAuditQuery[] = [];
  const store = {
    find: async () => null,
    append: async () => {},
    list: async () => [],
    count: async (query: OperationAuditQuery = {}) => {
      queries.push(query);
      return recent;
    },
    prune: async () => 0,
  } satisfies OperationAuditStoreLike;
  return { store, queries };
}

const ENV = { WRITE_OPERATION_LIMIT: "20", WRITE_OPERATION_WINDOW_MS: "60000" };

describe("写操作频率限制守卫", () => {
  it("未超限放行，并按窗口起点查询当前用户的 started 记录", async () => {
    const { store, queries } = auditStub(19);
    const response = await enforceWriteRateLimit("u1", {
      audit: store,
      env: ENV,
      now: new Date("2026-10-10T00:01:00.000Z"),
    });

    expect(response).toBeNull();
    expect(queries).toEqual([
      { actor: "u1", status: "started", since: "2026-10-10T00:00:00.000Z" },
    ]);
  });

  it("达到上限返回 429，并带 Retry-After 与 no-store", async () => {
    const { store } = auditStub(20);
    const response = await enforceWriteRateLimit("u1", {
      audit: store,
      env: ENV,
      now: new Date("2026-10-10T00:01:00.000Z"),
    });

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    await expect(response?.json()).resolves.toMatchObject({
      error: "too_many_requests",
      retryAfterMs: 60_000,
    });
  });
});
