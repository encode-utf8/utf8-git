import { describe, expect, it } from "vitest";

// 需要本地 PostgreSQL 与 apps/web/.env：
//   $env:DATABASE_URL="..." ; $env:AUTH_TOKEN_ENC_KEY="..." ; $env:RUN_DB_TESTS=1 ; pnpm --filter @utf8-git/web test
const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!runDbTests)("getGitHubAccessToken（数据库用例）", () => {
  it("从账号表解密出明文令牌；无账号或未存令牌时返回 null", async () => {
    const { encryptToken } = await import("./crypto");
    const { getGitHubAccessToken } = await import("./access-token");
    const { getPrismaClient } = await import("./prisma");

    const prisma = getPrismaClient();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const userId = `test-token-user-${suffix}`;
    const plainToken = `gho_plain-token-${suffix}`;

    await prisma.user.create({
      data: { id: userId, name: "令牌测试用户", email: `token-${suffix}@example.com` },
    });

    try {
      // 尚未绑定账号
      expect(await getGitHubAccessToken(userId)).toBeNull();

      await prisma.account.create({
        data: {
          userId,
          type: "oauth",
          provider: "github",
          providerAccountId: `token-account-${suffix}`,
          accessTokenEnc: encryptToken(plainToken),
        },
      });

      expect(await getGitHubAccessToken(userId)).toBe(plainToken);

      // 库中必须仍是密文
      const account = await prisma.account.findFirstOrThrow({ where: { userId } });
      expect(account.accessTokenEnc).not.toContain("gho_plain-token");
    } finally {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });
});
