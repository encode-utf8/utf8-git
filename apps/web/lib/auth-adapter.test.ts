import { describe, expect, it } from "vitest";

// 需要本地 PostgreSQL 与 apps/web/.env：
//   $env:DATABASE_URL="..." ; $env:AUTH_TOKEN_ENC_KEY="..." ; $env:RUN_DB_TESTS=1 ; pnpm --filter @utf8-git/web test
// 未设置 RUN_DB_TESTS 时整组用例跳过（CI 默认不依赖数据库）。
const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!runDbTests)("自定义 Prisma 适配器（数据库用例）", () => {
  it("令牌以密文入库，且可用同一密钥解密", async () => {
    const { decryptToken } = await import("./crypto");
    const { createAuthAdapter } = await import("./auth-adapter");
    const { getPrismaClient } = await import("./prisma");

    const prisma = getPrismaClient();
    const adapter = createAuthAdapter();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const providerAccountId = `test-account-${suffix}`;

    const user = await adapter.createUser!({
      id: `test-user-${suffix}`,
      name: "测试用户",
      email: `test-${suffix}@example.com`,
      emailVerified: null,
      image: null,
    });

    try {
      await adapter.linkAccount!({
        userId: user.id,
        type: "oauth",
        provider: "github",
        providerAccountId,
        access_token: `plain-access-${suffix}`,
        refresh_token: `plain-refresh-${suffix}`,
        id_token: `plain-id-${suffix}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        scope: "read:user repo",
      });

      const account = await prisma.account.findUniqueOrThrow({
        where: { provider_providerAccountId: { provider: "github", providerAccountId } },
      });

      // 库中不出现明文，且密文可解回原文
      expect(JSON.stringify(account)).not.toContain("plain-");
      expect(account.accessTokenEnc).toMatch(/^v1\./);
      expect(decryptToken(account.accessTokenEnc)).toBe(`plain-access-${suffix}`);
      expect(decryptToken(account.refreshTokenEnc)).toBe(`plain-refresh-${suffix}`);
      expect(decryptToken(account.idTokenEnc)).toBe(`plain-id-${suffix}`);
      expect(account.scope).toBe("read:user repo");
      expect(account.expiresAt).toBeGreaterThan(0);

      // 会话读写路径
      const sessionToken = `test-session-${suffix}`;
      const session = await adapter.createSession!({
        sessionToken,
        userId: user.id,
        expires: new Date(Date.now() + 60 * 60 * 1000),
      });
      expect(session.sessionToken).toBe(sessionToken);

      const loaded = await adapter.getSessionAndUser!(sessionToken);
      expect(loaded?.user.id).toBe(user.id);
      expect(loaded?.session.userId).toBe(user.id);

      await adapter.deleteSession!(sessionToken);
      expect(await adapter.getSessionAndUser!(sessionToken)).toBeNull();
    } finally {
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });
});
