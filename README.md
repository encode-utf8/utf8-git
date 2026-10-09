# utf8-git 🚂

> 把晦涩的 Git 仓库，变成一条可以点着走的时间线。

utf8-git 是一个面向 **Git 新手 / 团队新人** 的仓库可视化与交互式操作平台。
用 GitHub 账号登录后，你可以像看地图一样浏览仓库的分支、提交、合并与 Issue，
并通过点击完成创建分支、提交 Issue、合并或删除分支等常用操作——**不需要记住任何 Git 命令**。

![status](https://img.shields.io/badge/status-M2%20%E5%8F%AA%E8%AF%BB%E5%A2%9E%E5%BC%BA-blue)
![license](https://img.shields.io/badge/license-MIT-green)

---

## 为什么做 utf8-git

刚加入一个项目的开发者，面对动辄成百上千次提交、十几个分支的仓库时，常见困境是：

- `git log --graph` 的输出像天书，看不懂分支从哪来、为什么合并；
- 不知道自己该从哪个提交开始读代码，也看不懂「谁在什么时候动了什么」；
- 想做个简单的操作（拉分支、提 Issue、合 PR），却要背一串命令，还容易出错；
- 仓库的「开发过程」散落在 Commits / Branches / Pull Requests / Issues 四个页面里，没有整体叙事。

utf8-git 的目标是：**把仓库的开发过程还原成一条可交互的时间线，让「理解项目」和「执行操作」都变成点击。**

## 核心能力（规划）

| 阶段        | 能力                                       | 说明                                                                                                                                                                                                               |
| ----------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1 只读闭环 | GitHub 登录 · 仓库列表 · 提交时间线        | 登录后可浏览自己创建/参与的**公有与私有**仓库，查看**按提交聚合**的时间线（虚拟滚动 + 提交详情）与分支起点                                                                                                         |
| M2 只读增强 | 分支泳道 · PR / Issue 标注 · 过滤与搜索    | 分支泳道以 SVG 分层渲染 + 虚拟窗口呈现（50 分支 / 5000+ 提交仍可交互）；提交上挂载 PR / Issue 关联标注并可跳转 GitHub；支持按关键词 / 作者 / 事件类型即时过滤与近一周 / 近一月时间缩放（分支由顶部分支选择器切换） |
| M3 交互操作 | 创建分支 · 提交 Issue · 合并 PR · 删除分支 | 点击式写操作，带二次确认、影响预览与审计记录                                                                                                                                                                       |
| M4 体验工程 | 性能 · 缓存 · 测试 · 国际化 · 可访问性     | 面向真实大仓库打磨，形成可持续开发节奏                                                                                                                                                                             |
| M5 生态扩展 | 教学引导 · 多平台（GitLab 等）· 插件       | 从工具走向「Git 学习平台」                                                                                                                                                                                         |

## 目标用户

- **项目新人**：刚加入团队或开源项目，想快速搞清「这个项目是怎么长出来的」。
- **Git 不熟练者**：会用但是怕用错，希望通过界面完成低频/高风险操作。
- **导师 / 维护者**：想快速向新人解释项目结构，或检查仓库健康度。

## 产品原则

1. **先看懂，再操作**：可视化优先于功能堆砌，任何写操作前都可预览影响。
2. **安全第一**：默认最小权限；危险操作（删分支、合并）必须二次确认且可追溯。
3. **不重复造轮子**：Git 数据以 GitHub 为准，utf8-git 只做展示、编排与守护。
4. **渐进式披露**：新手看到的是「故事」，进阶用户能展开看到 SHA、命令与原始数据。
5. **零配置**：平台内置 OAuth App，用户登录即用，不需要自建应用或填任何配置。
6. **在线协作**：数据以 GitHub 实时状态为准，不提供离线模式。

## 技术栈

- 全栈：TypeScript · Next.js（App Router）
- 界面：Tailwind CSS · shadcn/ui
- 可视化：自研泳道布局（`packages/git-graph`，提交 DAG）· SVG 分层渲染 + 虚拟窗口 · 时间线组件
- 数据：GitHub GraphQL API v4（读）+ REST API v3（写）· PostgreSQL + Prisma
- 鉴权：Auth.js（GitHub OAuth App）
- 部署：Vercel + Neon/Supabase · GitHub Actions CI

选型对比与理由见 [docs/technical-analysis.md](docs/technical-analysis.md)。

## 文档导航

| 文档                                                                                                     | 内容                                                                           |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [docs/requirements.md](docs/requirements.md)                                                             | 需求分析：用户画像、用户故事、功能/非功能需求、验收标准、范围边界              |
| [docs/technical-analysis.md](docs/technical-analysis.md)                                                 | 技术分析：架构选型、GitHub API 策略、提交图渲染、安全设计、风险                |
| [docs/roadmap.md](docs/roadmap.md)                                                                       | 实现路线：M0–M5 里程碑、交付物、退出标准、迭代节奏                             |
| [docs/deployment.md](docs/deployment.md)                                                                 | 部署形态：Vercel + 托管 PostgreSQL、环境变量清单、多实例一致性、预览环境与回滚 |
| [docs/reports/tech-analysis/M1-7-perf-validation.md](docs/reports/tech-analysis/M1-7-perf-validation.md) | 性能验证：小 / 中 / 大真实仓库的时间线耗时、请求数与缓存命中率                 |
| [docs/development-log.md](docs/development-log.md)                                                       | 开发记录：按时间记录目标、产出、决策与问题                                     |
| [docs/todo.md](docs/todo.md)                                                                             | 待办日志：当前迭代任务与分类 Backlog                                           |

## 仓库结构（规划）

```text
utf8-git/
├── apps/web/          # Next.js 应用（前端 + API 路由）
├── packages/          # 共享包：git-graph 布局、GitHub 客户端、UI 组件
├── docs/              # 项目文档
└── .github/           # CI、Issue/PR 模板
```

> 注：仓库骨架已按上述结构初始化（pnpm workspace：`apps/web` + `packages/*`）；其中 `packages/git-graph` 已落地泳道布局、窗口切片与合成历史基准。本地开发说明见下文。

## 本地开发

环境要求：

- **Node.js 22 LTS**（`>= 22.12`，版本见 `.nvmrc`）
- **pnpm 12**（推荐 `corepack enable` 启用；无权限时可用 `npm i -g pnpm@12`）

常用命令（在仓库根目录执行）：

```bash
pnpm install    # 安装 workspace 全部依赖
pnpm dev        # 启动 apps/web 开发服务器（http://localhost:3000）
pnpm lint       # ESLint 全量检查
pnpm typecheck  # TypeScript 类型检查（web 会先生成 Next 路由类型）
pnpm test       # Vitest 单元测试
pnpm test:e2e   # Playwright 端到端测试（需本地 PostgreSQL 与 Chromium，见下文）
pnpm build      # 构建全部 workspace
```

提交信息遵循 Conventional Commits（`feat` / `fix` / `docs` / `chore` 等），commit-msg 钩子会自动校验。

### 本地数据库与登录（M1-2 起）

登录、会话与令牌存储需要本地 PostgreSQL（Docker）与环境变量：

```bash
docker compose -f docker-compose.dev.yml up -d          # 启动开发数据库（postgres:18，localhost:5432）
cp apps/web/.env.example apps/web/.env                  # 复制后按注释生成密钥
pnpm --filter @utf8-git/web exec prisma migrate dev     # 应用迁移并生成 Prisma Client（首次）
pnpm dev                                                # 启动后访问 http://localhost:3000/login
```

- 环境变量说明见 `apps/web/.env.example`；`apps/web/.env` 已被 gitignore，请勿提交。
- 登录后访问 `/repos` 查看仓库列表（含私有仓库与可见性标识；支持搜索、排序、过滤）。
- 进入 `/repos/[owner]/[name]` 浏览提交时间线（M1-5 起）：虚拟滚动（支持 1000+ 提交）、分支切换、节点详情（文件变更统计与「在 GitHub 打开」）；详情走 REST 查询并在服务端缓存 30 min。
- 数据层（M1-4 起）：时间线走 GraphQL 聚合查询（单页 1 次请求）；服务端 TTL 缓存（仓库列表 5 min、时间线 2 min）；GitHub 配额不足时降级展示缓存并提示恢复时间。
- GitHub OAuth App 本地联调：在 GitHub → Settings → Developer settings 创建 OAuth App，回调地址填 `http://localhost:3000/api/auth/callback/github`，将 Client ID / Secret 填入 `.env` 的 `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`。
- access / refresh / id token 在数据库中均为 AES-256-GCM 密文，加密密钥（`AUTH_TOKEN_ENC_KEY`）只存在于环境变量中。
- 令牌自动续期：access token 临近过期（默认提前 5 min）时自动用 refresh token 换取新令牌并轮换入库，无需每 8 小时重新授权；仅在刷新令牌失效时才要求重新授权。
- 在线状态（M1-9 起）：断网 / 请求超时 / GitHub 限流都有明确提示与「重试」入口——服务端渲染阶段给出可读错误页，客户端请求按指数退避自动重试（401 / 403 / 404 / 429 不重试），断网时页面顶部显示全局横幅，限流时提示恢复时间；降级缓存会标注获取时间，不冒充最新数据。
- 分支泳道与事件标注（M2-1 ~ M2-3 起）：时间线左侧以 SVG 分层渲染分支泳道（`packages/git-graph` 负责布局与窗口切片，虚拟滚动下每帧只绘窗口内元素）；提交行与详情面板展示关联 PR / Issue 徽标，点击直达 GitHub。
- 多实例与部署（M1-6 起）：默认（`STORE_BACKEND` 未设置或为 `memory`）用进程内内存缓存，适合单实例与本地开发；设为 `postgres` 后 TTL 缓存与限流快照改存数据库（`shared_cache_entries` / `rate_limit_states`），多实例 / Serverless 下跨实例共享，令牌续期竞态也会复用其他实例已刷新的令牌。部署形态、环境变量清单、连接池与回滚见 [docs/deployment.md](docs/deployment.md)。

> 网络说明：仓库根目录 `.npmrc` 已配置国内镜像（registry.npmmirror.com）；若可直连 npm 官方源，可删除该文件。

## 参与贡献

项目处于早期，欢迎通过 Issue 提出想法与使用场景。贡献指南与 Issue / PR 模板见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE) © 2026 encode-utf8
