import path from "node:path";

import { defineConfig } from "vitest/config";

// 与 apps/web/tsconfig.json 的 paths（"@/*": ["./*"]）保持一致，
// 让路由 / 页面里的 "@/..." 导入在 vitest 下也能解析（Next 运行时不经过此配置）。
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd(), ".") },
  },
  test: {
    environment: "node",
  },
});
