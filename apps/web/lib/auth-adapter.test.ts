import { describe, expect, it } from "vitest";

// 需要本地 PostgreSQL 与 apps/web/.env：
//   $env:DATABASE_URL="..." ; $env:AUTH_TOKEN_ENC_KEY="..." ; $env:RUN_DB_TESTS=1 ; pnpm --filter @utf8-git/web test
const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!runDbTests)("upsertAccountTokens（数据库用例）", () => {
  it("首次写入密文令牌；重新授权更新令牌与过期时间且保留旧 refresh token", async () => {
    const { decryptToken } = await import("./crypto");
    const { upsertAccountTokens } = await import("./auth-adapter");
    const { getPrismaClient } = await import("./prisma");

    const prisma = getPrismaClient();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const userId = `test-upsert-user-${suffix}`;
    const providerAccountId = `upsert-account-${suffix}`;

    await prisma.user.create({
      data: { id: userId, name: "重新授权测试", email: `upsert-${suffix}@example.com` },
    });

    try {
      await upsertAccountTokens(userId, {
        type: "oauth",
        provider: "github",
        providerAccountId,
        access_token: "gho_first_token",
        refresh_token: "ghr_first_refresh",
        expires_at: 1000,
        token_type: "bearer",
        scope: "read:user,repo",
      });

      const created = await prisma.account.findFirstOrThrow({ where: { userId } });
      expect(decryptToken(created.accessTokenEnc)).toBe("gho_first_token");
      expect(decryptToken(created.refreshTokenEnc)).toBe("ghr_first_refresh");
      expect(created.accessTokenEnc).not.toContain("gho_first_token");
      expect(created.expiresAt).toBe(1000);
      expect(created.scope).toBe("read:user,repo");

      // 二次授权：响应未携带 refresh_token 时应保留旧值，且不产生重复行
      await upsertAccountTokens(userId, {
        type: "oauth",
        provider: "github",
        providerAccountId,
        access_token: "gho_second_token",
        expires_at: 2000,
        token_type: "bearer",
        scope: "read:user,repo",
      });

      expect(await prisma.account.count({ where: { userId } })).toBe(1);
      const updated = await prisma.account.findFirstOrThrow({ where: { userId } });
      expect(decryptToken(updated.accessTokenEnc)).toBe("gho_second_token");
      expect(decryptToken(updated.refreshTokenEnc)).toBe("ghr_first_refresh");
      expect(updated.expiresAt).toBe(2000);
    } finally {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });
});
