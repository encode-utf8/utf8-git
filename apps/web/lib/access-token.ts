import { upsertAccountTokens } from "./auth-adapter";
import { decryptToken } from "./crypto";
import { GitHubApiError, GitHubUnauthorizedError } from "./github-errors";
import { refreshGitHubToken, type RefreshedGitHubToken } from "./github-token";
import { getPrismaClient } from "./prisma";

// 提前续期窗口：避免请求发出后令牌才过期（GitHub access token 有效期 8 小时）
export const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

// 数据库中的 GitHub 账号（Prisma 返回值的最小子集）
export type StoredGitHubAccount = {
  type: string;
  provider: string;
  providerAccountId: string;
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  expiresAt: number | null;
};

export type AccessTokenDeps = {
  loadAccount?: (userId: string) => Promise<StoredGitHubAccount | null>;
  refresh?: typeof refreshGitHubToken;
  store?: (userId: string, tokens: RefreshedGitHubToken) => Promise<void>;
  now?: () => number;
  clientId?: string | null;
  clientSecret?: string | null;
};

async function loadGitHubAccount(userId: string): Promise<StoredGitHubAccount | null> {
  const account = await getPrismaClient().account.findFirst({
    where: { userId, provider: "github" },
    orderBy: { id: "desc" },
  });
  if (!account) {
    return null;
  }
  return {
    type: account.type,
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    accessTokenEnc: account.accessTokenEnc,
    refreshTokenEnc: account.refreshTokenEnc,
    expiresAt: account.expiresAt,
  };
}

// 续期结果轮换入库（新 refresh token 覆盖旧值；缺省时 upsertAccountTokens 会保留旧值）
async function persistRefreshedTokens(
  userId: string,
  account: StoredGitHubAccount,
  tokens: RefreshedGitHubToken,
): Promise<void> {
  await upsertAccountTokens(userId, {
    type: account.type,
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: tokens.expiresAt,
    token_type: tokens.tokenType,
    scope: tokens.scope,
  });
}

// 同一用户的并发请求只发起一次续期（refresh token 每次刷新都会轮换，重复请求会互相作废）
const inflightRefreshes = new Map<string, Promise<RefreshedGitHubToken>>();

function refreshOnce(userId: string, run: () => Promise<RefreshedGitHubToken>) {
  const existing = inflightRefreshes.get(userId);
  if (existing) {
    return existing;
  }
  const promise = run().finally(() => inflightRefreshes.delete(userId));
  inflightRefreshes.set(userId, promise);
  return promise;
}

/**
 * 读取并解密当前用户的 GitHub access token（仅限服务端调用，禁止返回前端）。
 * 令牌临近过期时用 refresh token 自动续期并轮换入库：
 * - 返回 null：无账号 / 无令牌 / 无 refresh token / 续期被拒绝（调用方应引导重新授权）
 * - 抛出 GitHubApiError：网络、超时或令牌端点异常（可重试）
 * - 多实例（M1-6）：续期被拒时先重读库中最新令牌，其他实例已完成续期则直接复用
 */
export async function getGitHubAccessToken(
  userId: string,
  deps: AccessTokenDeps = {},
): Promise<string | null> {
  const account = await (deps.loadAccount ?? loadGitHubAccount)(userId);
  if (!account?.accessTokenEnc) {
    return null;
  }
  const accessToken = decryptToken(account.accessTokenEnc);
  if (!accessToken) {
    return null;
  }

  const now = deps.now ?? Date.now;
  const expiresAtMs = account.expiresAt === null ? null : account.expiresAt * 1000;
  if (expiresAtMs === null || expiresAtMs - now() > TOKEN_REFRESH_SKEW_MS) {
    return accessToken;
  }

  const refreshToken = account.refreshTokenEnc ? decryptToken(account.refreshTokenEnc) : null;
  if (!refreshToken) {
    return null; // 无法续期 → 上层引导重新授权
  }

  const clientId = deps.clientId ?? process.env.AUTH_GITHUB_ID ?? null;
  const clientSecret = deps.clientSecret ?? process.env.AUTH_GITHUB_SECRET ?? null;
  if (!clientId || !clientSecret) {
    throw new GitHubApiError("缺少 AUTH_GITHUB_ID / AUTH_GITHUB_SECRET，无法续期 GitHub 令牌", 500);
  }

  const refresh = deps.refresh ?? refreshGitHubToken;
  const store = deps.store ?? ((id, tokens) => persistRefreshedTokens(id, account, tokens));

  try {
    const refreshed = await refreshOnce(userId, () =>
      refresh({ clientId, clientSecret, refreshToken, now }),
    );
    await store(userId, refreshed);
    return refreshed.accessToken;
  } catch (error) {
    if (error instanceof GitHubUnauthorizedError) {
      // 多实例竞态（M1-6）：refresh token 每次刷新都会轮换，其他实例可能刚用同一个旧令牌
      // 完成续期并写库，导致本次请求被拒。先重读库中最新令牌，避免误报「授权失效」。
      const latest = await (deps.loadAccount ?? loadGitHubAccount)(userId);
      const latestToken = latest?.accessTokenEnc ? decryptToken(latest.accessTokenEnc) : null;
      if (latestToken && latest && latest.expiresAt !== account.expiresAt) {
        return latestToken;
      }
      return null; // refresh token 确实失效 → 走重新授权
    }
    throw error;
  }
}
