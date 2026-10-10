import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// E2E 运行参数（端口可通过环境变量覆盖，避免与本地 dev 端口冲突）
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3210);
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 3211);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

// 测试专用固定值（非敏感，仅本地 / CI 使用）；库指向独立的 *_e2e，避免污染开发库
const TEST_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql://utf8git:utf8git_dev@localhost:5432/utf8git_e2e?schema=public";
const TEST_SECRETS = {
  AUTH_SECRET: "e2e-auth-secret",
  AUTH_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_GITHUB_ID: "e2e-github-id",
  AUTH_GITHUB_SECRET: "e2e-github-secret",
};

// globalSetup（落库会话）在 Playwright 主进程执行，需要与 webServer 相同的变量
process.env.DATABASE_URL ??= TEST_DATABASE_URL;
process.env.AUTH_TRUST_HOST ??= "true";
for (const [key, value] of Object.entries(TEST_SECRETS)) {
  process.env[key] ??= value;
}

// 传给 next start 运行期：数据库 + 密钥 + 把上游指向本地 mock
const APP_ENV: Record<string, string> = {
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_TRUST_HOST: "true",
  ...TEST_SECRETS,
  STORE_BACKEND: "memory",
  // 频率限制在 E2E 中放宽：整轮用例共用一个登录态，会连续发起十余次写操作
  WRITE_OPERATION_LIMIT: "200",
  GITHUB_API_BASE_URL: MOCK_URL,
  GITHUB_GRAPHQL_ENDPOINT: `${MOCK_URL}/graphql`,
  GITHUB_TOKEN_ENDPOINT: `${MOCK_URL}/login/oauth/access_token`,
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  // 时间线依赖服务端内存游标链（STORE_BACKEND=memory），串行执行更稳定
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: APP_URL,
    storageState: path.resolve(process.cwd(), "e2e/.auth/state.json"),
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: "./e2e/global-setup.ts",
  webServer: [
    {
      command: "node e2e/mock-github.mjs",
      url: `${MOCK_URL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { E2E_MOCK_PORT: String(MOCK_PORT) },
    },
    {
      // 需要先执行 next build（CI 已构建；本地用根目录 pnpm test:e2e 会自动构建）
      // 注意：Playwright 先起 webServer 再跑 globalSetup，而 /api/health 在缺表时返回 503；
      // 所以必须先把迁移跑完再启动应用，否则就绪探针等不到 200 会直接超时。
      command: `pnpm exec prisma migrate deploy && pnpm exec next start -p ${APP_PORT}`,
      url: `${APP_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: APP_ENV,
    },
  ],
});
