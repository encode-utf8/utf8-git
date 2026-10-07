import { describe, expect, it } from "vitest";

// 注入依赖的续期用例需要固定加密密钥（不依赖 apps/web/.env）
process.env.AUTH_TOKEN_ENC_KEY ??= Buffer.alloc(32, 7).toString("base64");

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

describe("getGitHubAccessToken（令牌续期，注入依赖）", () => {
  const nowMs = 1_700_000_000_000;

  async function buildAccount(options: { expiresAt: number | null; refresh?: boolean }) {
    const { encryptToken } = await import("./crypto");
    return {
      type: "oauth",
      provider: "github",
      providerAccountId: "308028751",
      accessTokenEnc: encryptToken("gho_stored", process.env.AUTH_TOKEN_ENC_KEY),
      refreshTokenEnc:
        options.refresh === false
          ? null
          : encryptToken("ghr_stored", process.env.AUTH_TOKEN_ENC_KEY),
      expiresAt: options.expiresAt,
    };
  }

  it("未临近过期时不发起续期", async () => {
    const { getGitHubAccessToken } = await import("./access-token");
    let refreshCalls = 0;

    const token = await getGitHubAccessToken("user-fresh", {
      loadAccount: async () => buildAccount({ expiresAt: Math.floor(nowMs / 1000) + 3600 }),
      refresh: async () => {
        refreshCalls += 1;
        throw new Error("不应发起续期");
      },
      now: () => nowMs,
    });

    expect(token).toBe("gho_stored");
    expect(refreshCalls).toBe(0);
  });

  it("临近过期时自动续期并轮换入库", async () => {
    const { getGitHubAccessToken } = await import("./access-token");
    const stored: Array<{ userId: string; accessToken: string; refreshToken: string | null }> = [];

    const token = await getGitHubAccessToken("user-expired", {
      loadAccount: async () => buildAccount({ expiresAt: Math.floor(nowMs / 1000) - 60 }),
      refresh: async ({ refreshToken }) => {
        expect(refreshToken).toBe("ghr_stored");
        return {
          accessToken: "gho_refreshed",
          refreshToken: "ghr_rotated",
          expiresAt: Math.floor(nowMs / 1000) + 28800,
          tokenType: "bearer",
          scope: "read:user,repo",
        };
      },
      store: async (userId, tokens) => {
        stored.push({ userId, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
      },
      now: () => nowMs,
      clientId: "cid",
      clientSecret: "secret",
    });

    expect(token).toBe("gho_refreshed");
    expect(stored).toEqual([
      { userId: "user-expired", accessToken: "gho_refreshed", refreshToken: "ghr_rotated" },
    ]);
  });

  it("无 refresh token 时返回 null 且不发起请求", async () => {
    const { getGitHubAccessToken } = await import("./access-token");
    let refreshCalls = 0;

    const token = await getGitHubAccessToken("user-no-refresh", {
      loadAccount: async () => buildAccount({ expiresAt: 1, refresh: false }),
      refresh: async () => {
        refreshCalls += 1;
        throw new Error("不应发起续期");
      },
      now: () => nowMs,
    });

    expect(token).toBeNull();
    expect(refreshCalls).toBe(0);
  });

  it("续期被拒绝 → 返回 null（引导重新授权）", async () => {
    const { GitHubUnauthorizedError } = await import("./github-errors");
    const { getGitHubAccessToken } = await import("./access-token");

    const token = await getGitHubAccessToken("user-rejected", {
      loadAccount: async () => buildAccount({ expiresAt: Math.floor(nowMs / 1000) - 60 }),
      refresh: async () => {
        throw new GitHubUnauthorizedError("被拒绝");
      },
      now: () => nowMs,
      clientId: "cid",
      clientSecret: "secret",
    });

    expect(token).toBeNull();
  });

  it("续期网络异常 → 抛出 GitHubApiError（不误判为未授权）", async () => {
    const { GitHubApiError } = await import("./github-errors");
    const { getGitHubAccessToken } = await import("./access-token");

    const error = await getGitHubAccessToken("user-network", {
      loadAccount: async () => buildAccount({ expiresAt: Math.floor(nowMs / 1000) - 60 }),
      refresh: async () => {
        throw new GitHubApiError("无法连接 GitHub 令牌端点", 502);
      },
      now: () => nowMs,
      clientId: "cid",
      clientSecret: "secret",
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GitHubApiError);
  });

  it("同一用户并发请求只发起一次续期", async () => {
    const { getGitHubAccessToken } = await import("./access-token");
    let refreshCalls = 0;
    const deferred: { resolve?: () => void } = {};
    const gate = new Promise<void>((resolve) => {
      deferred.resolve = resolve;
    });

    const deps = {
      loadAccount: async () => buildAccount({ expiresAt: Math.floor(nowMs / 1000) - 60 }),
      refresh: async () => {
        refreshCalls += 1;
        await gate;
        return {
          accessToken: "gho_refreshed",
          refreshToken: "ghr_rotated",
          expiresAt: Math.floor(nowMs / 1000) + 28800,
          tokenType: "bearer",
          scope: null,
        };
      },
      store: async () => {},
      now: () => nowMs,
      clientId: "cid",
      clientSecret: "secret",
    };

    const first = getGitHubAccessToken("user-concurrent", deps);
    const second = getGitHubAccessToken("user-concurrent", deps);
    // 等两个请求都进入续期等待（refresh 被调用一次后阻塞在 gate 上）
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshCalls).toBe(1);

    deferred.resolve?.();

    expect(await first).toBe("gho_refreshed");
    expect(await second).toBe("gho_refreshed");
  });

  it("续期被拒但其他实例已写入新令牌 → 复用新令牌（不误报授权失效）", async () => {
    const { encryptToken } = await import("./crypto");
    const { GitHubUnauthorizedError } = await import("./github-errors");
    const { getGitHubAccessToken } = await import("./access-token");

    let loads = 0;
    const token = await getGitHubAccessToken("user-race", {
      loadAccount: async () => {
        loads += 1;
        if (loads === 1) {
          // 本实例读到的是过期令牌（其 refresh token 即将被其他实例消费）
          return buildAccount({ expiresAt: Math.floor(nowMs / 1000) - 60 });
        }
        // 第二次读取：其他实例已完成续期并写库（令牌与过期时间都已更新）
        return {
          type: "oauth",
          provider: "github",
          providerAccountId: "308028751",
          accessTokenEnc: encryptToken("gho_peer_refreshed", process.env.AUTH_TOKEN_ENC_KEY),
          refreshTokenEnc: encryptToken("ghr_peer_rotated", process.env.AUTH_TOKEN_ENC_KEY),
          expiresAt: Math.floor(nowMs / 1000) + 28800,
        };
      },
      refresh: async () => {
        throw new GitHubUnauthorizedError("旧 refresh token 已被其他实例消费");
      },
      now: () => nowMs,
      clientId: "cid",
      clientSecret: "secret",
    });

    expect(token).toBe("gho_peer_refreshed");
    expect(loads).toBe(2);
  });
});
