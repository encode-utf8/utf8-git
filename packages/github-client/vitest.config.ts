import { defineConfig } from "vitest/config";

// 覆盖率配置：github-client 是纯逻辑层，单元测试覆盖；阈值与路线图 M4「总体 ≥70%」对齐。
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
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
