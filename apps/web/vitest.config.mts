import { defineConfig } from "vitest/config";

// 单元 / 集成测试配置。
// e2e/ 下的 Playwright 用例（*.spec.ts）由 `playwright test` 运行，必须从 vitest 的收集范围里排除，
// 否则 vitest 会按默认 include（**/*.spec.ts）把它们当测试文件加载并直接报错。
// 覆盖率口径 = lib/ 纯逻辑层；API 路由与 React 组件由 Playwright E2E 覆盖，不在 v8 统计范围。
// 排除：消息目录（纯数据）、prisma.ts（客户端单例）、auth.ts（依赖 Auth.js 运行时装配）。
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "lib/**/*.tsx"],
      exclude: [
        "lib/**/*.test.ts",
        "lib/**/*.test.tsx",
        "lib/i18n/messages/**",
        "lib/prisma.ts",
        "lib/auth.ts",
      ],
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
