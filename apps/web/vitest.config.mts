import { defineConfig } from "vitest/config";

// 单元 / 集成测试配置。
// e2e/ 下的 Playwright 用例（*.spec.ts）由 `playwright test` 运行，必须从 vitest 的收集范围里排除，
// 否则 vitest 会按默认 include（**/*.spec.ts）把它们当测试文件加载并直接报错。
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
  },
});
