// Playwright 全局初始化：准备 E2E 数据库并写入有效会话，供测试复用。
// 设计：E2E 不真正走 GitHub OAuth（外部依赖、不可控），而是直接落一个数据库会话 +
// 加密令牌，等价于「已完成登录」。登录页本身由 auth.spec.ts 单独验证。
// TODO-232：「撤销授权 / 清除数据」会删掉自己的令牌、会话甚至账号记录，
// 因此这两个流程各用一个独立用户（各一份 storageState），跑完不影响其他用例。

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { encryptToken } from "../lib/crypto";
import { getPrismaClient } from "../lib/prisma";

// 与 auth.ts 的数据库会话策略一致：http 下 Cookie 名为 authjs.session-token
export const E2E_SESSION_COOKIE = "authjs.session-token";
export const E2E_USER_ID = "90000001";
export const E2E_GITHUB_LOGIN = "e2e-bot";
// 只用于「撤销授权」用例（令牌与会话会被该用例删除）
export const E2E_REVOKE_USER_ID = "90000002";
// 只用于「清除数据」用例（账号记录与用户记录都会被该用例删除）
export const E2E_PURGE_USER_ID = "90000003";

function storageStatePath(fileName: string): string {
  return path.resolve(process.cwd(), `e2e/.auth/${fileName}`);
}

// 会话状态文件路径（Playwright 以 apps/web 为 cwd 运行）
export const STORAGE_STATE_PATH = storageStatePath("state.json");
export const REVOKE_STORAGE_STATE_PATH = storageStatePath("revoke-state.json");
export const PURGE_STORAGE_STATE_PATH = storageStatePath("purge-state.json");

type SeededUser = {
  userId: string;
  login: string;
  name: string;
  statePath: string;
};

const SEEDED_USERS: SeededUser[] = [
  { userId: E2E_USER_ID, login: E2E_GITHUB_LOGIN, name: "E2E Bot", statePath: STORAGE_STATE_PATH },
  {
    userId: E2E_REVOKE_USER_ID,
    login: "e2e-revoker",
    name: "E2E Revoker",
    statePath: REVOKE_STORAGE_STATE_PATH,
  },
  {
    userId: E2E_PURGE_USER_ID,
    login: "e2e-purger",
    name: "E2E Purger",
    statePath: PURGE_STORAGE_STATE_PATH,
  },
];

export default async function globalSetup(): Promise<void> {
  // 迁移到最新（幂等）：CI / 本地都只依赖一个命令即可准备好 E2E 库
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit" });

  const prisma = getPrismaClient();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const fakeToken = "ghs_e2e_mock_token";

  for (const user of SEEDED_USERS) {
    await prisma.user.upsert({
      where: { id: user.userId },
      update: { name: user.name, githubLogin: user.login },
      create: {
        id: user.userId,
        name: user.name,
        email: `${user.login}@example.com`,
        githubLogin: user.login,
      },
    });

    // 令牌有效期设为 1 小时后：远大于 5 分钟续期窗口，测试期间不会触发续期分支
    const tokenData = {
      accessTokenEnc: encryptToken(fakeToken),
      expiresAt: nowSeconds + 3600,
      tokenType: "bearer",
      scope: "read:user repo",
    };
    await prisma.account.upsert({
      where: {
        provider_providerAccountId: { provider: "github", providerAccountId: user.userId },
      },
      update: tokenData,
      create: {
        userId: user.userId,
        type: "oauth",
        provider: "github",
        providerAccountId: user.userId,
        ...tokenData,
      },
    });

    const sessionToken = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.deleteMany({ where: { userId: user.userId } });
    await prisma.session.create({ data: { sessionToken, userId: user.userId, expires } });

    await mkdir(path.dirname(user.statePath), { recursive: true });
    await writeFile(
      user.statePath,
      JSON.stringify(
        {
          cookies: [
            {
              name: E2E_SESSION_COOKIE,
              value: sessionToken,
              domain: "127.0.0.1",
              path: "/",
              expires: Math.floor(expires.getTime() / 1000),
              httpOnly: true,
              secure: false,
              sameSite: "Lax",
            },
          ],
          origins: [],
        },
        null,
        2,
      ),
    );
  }

  await prisma.$disconnect();
}
