import { defineConfig } from "vitest/config";

// 覆盖率配置：算法内核（git-graph）是路线图 M4 的「核心包」口径，阈值见 package.json 注释。
// *.bench.ts 是基准脚本（不进 build），不计入覆盖率。
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.bench.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
  },
});
