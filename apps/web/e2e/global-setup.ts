// Playwright 全局初始化：准备 E2E 数据库并写入一个有效会话，供测试复用。
// 设计：E2E 不真正走 GitHub OAuth（外部依赖、不可控），而是直接落一个数据库会话 +
// 加密令牌，等价于「已完成登录」。登录页本身由 auth.spec.ts 单独验证。

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

// 会话状态文件路径（Playwright 以 apps/web 为 cwd 运行）
export const STORAGE_STATE_PATH = path.resolve(process.cwd(), "e2e/.auth/state.json");

export default async function globalSetup(): Promise<void> {
  // 迁移到最新（幂等）：CI / 本地都只依赖一个命令即可准备好 E2E 库
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit" });

  const prisma = getPrismaClient();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const fakeToken = "ghs_e2e_mock_token";

  await prisma.user.upsert({
    where: { id: E2E_USER_ID },
    update: { name: "E2E Bot", githubLogin: E2E_GITHUB_LOGIN },
    create: {
      id: E2E_USER_ID,
      name: "E2E Bot",
      email: "e2e@example.com",
      githubLogin: E2E_GITHUB_LOGIN,
    },
  });

  // 令牌有效期设为 1 小时后：远大于 5 分钟续期窗口，测试期间不会触发续期分支
  await prisma.account.upsert({
    where: { provider_providerAccountId: { provider: "github", providerAccountId: E2E_USER_ID } },
    update: { accessTokenEnc: encryptToken(fakeToken), expiresAt: nowSeconds + 3600 },
    create: {
      userId: E2E_USER_ID,
      type: "oauth",
      provider: "github",
      providerAccountId: E2E_USER_ID,
      accessTokenEnc: encryptToken(fakeToken),
      expiresAt: nowSeconds + 3600,
      tokenType: "bearer",
      scope: "read:user repo",
    },
  });

  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.session.deleteMany({ where: { userId: E2E_USER_ID } });
  await prisma.session.create({ data: { sessionToken, userId: E2E_USER_ID, expires } });

  await mkdir(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  await writeFile(
    STORAGE_STATE_PATH,
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

  await prisma.$disconnect();
}
