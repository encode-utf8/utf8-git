# @utf8-git/web

utf8-git 的 Next.js 应用（App Router）：页面、API 路由、Prisma 数据层与 GitHub 集成都在这里。

- 项目介绍、技术栈与文档导航见仓库根目录 [README.md](../../README.md)。
- 本地环境、数据库与 OAuth 登录步骤见根 README 的「本地开发」；环境变量说明见 [.env.example](.env.example)。
- 共享包：`packages/git-graph`（泳道布局）、`packages/github-client`、`packages/ui`。

常用命令（在仓库根目录执行）：

```bash
pnpm dev        # 启动开发服务器（http://localhost:3000）
pnpm test       # Vitest 单元 / 集成测试
pnpm test:e2e   # Playwright 端到端测试（需本地 PostgreSQL 与 Chromium）
pnpm build      # 生产构建
```

贡献方式与提交规范见 [CONTRIBUTING.md](../../CONTRIBUTING.md)。
