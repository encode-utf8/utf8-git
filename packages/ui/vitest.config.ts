import { defineConfig } from "vitest/config";

// 覆盖率配置：ui 包当前只有 cn 工具函数，与路线图 M4「总体 ≥70%」对齐。
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
