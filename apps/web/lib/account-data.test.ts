import { describe, expect, it } from "vitest";

import { clearAuthorizationData, purgeAccountData, type AccountDataDeps } from "./account-data";

function recorder() {
  const calls: string[] = [];
  const deps: AccountDataDeps = {
    deleteAuditRecords: async (actor) => {
      calls.push(`audit:${actor}`);
      return 3;
    },
    deleteTokensAndSessions: async (userId) => {
      calls.push(`tokens:${userId}`);
    },
    invalidateCaches: async (userId) => {
      calls.push(`caches:${userId}`);
    },
    deleteRateLimitSnapshot: async (userId) => {
      calls.push(`ratelimit:${userId}`);
    },
    deleteUser: async (userId) => {
      calls.push(`user:${userId}`);
    },
  };
  return { calls, deps };
}

describe("清除账号数据", () => {
  it("按「审计 → 令牌/会话 → 缓存 → 配额 → 用户」顺序清除，并返回删除的审计条数", async () => {
    const { calls, deps } = recorder();

    const summary = await purgeAccountData("u1", deps);

    expect(summary).toEqual({ auditRecords: 3 });
    expect(calls).toEqual(["audit:u1", "tokens:u1", "caches:u1", "ratelimit:u1", "user:u1"]);
  });

  it("撤销授权只清令牌 / 会话 / 缓存 / 配额，保留审计与用户记录", async () => {
    const { calls, deps } = recorder();

    await clearAuthorizationData("u2", deps);

    expect(calls).toEqual(["tokens:u2", "caches:u2", "ratelimit:u2"]);
  });
});
