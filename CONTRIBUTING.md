# 贡献指南（CONTRIBUTING）

感谢你关注 utf8-git。本文说明如何准备本地环境、提交改动与发起 Pull Request。项目当前处于 M1 阶段，欢迎通过 Issue 反馈问题与使用场景。

- 项目背景、核心能力与文档导航见 [README.md](README.md)
- 迭代节奏、分支模型与 Definition of Done 见 [docs/roadmap.md](docs/roadmap.md) 的「§8 迭代节奏与工程约定」
- 当前任务与里程碑见 [docs/todo.md](docs/todo.md) 与 [docs/development-log.md](docs/development-log.md)

---

## 1. 开发环境准备

| 依赖    | 版本                                        | 说明                                                     |
| ------- | ------------------------------------------- | -------------------------------------------------------- |
| Node.js | 22 LTS（`>= 22.12`，见 `.nvmrc`）           | 推荐用 nvm / fnm 按 `.nvmrc` 切换版本                    |
| pnpm    | 12（见 `package.json` 的 `packageManager`） | 推荐 `corepack enable` 启用；无权限时 `npm i -g pnpm@12` |
| Docker  | 任意较新版本                                | 仅用于本地 PostgreSQL，可复用已有实例替代                |

在仓库根目录执行：

```bash
# 1) 安装 workspace 全部依赖
pnpm install

# 2) 启动本地开发数据库（postgres:18，localhost:5432）
docker compose -f docker-compose.dev.yml up -d

# 3) 生成本地环境变量（Windows 用 copy 替代 cp）
cp apps/web/.env.example apps/web/.env
# 按 apps/web/.env.example 注释生成 AUTH_SECRET 与 AUTH_TOKEN_ENC_KEY（两者需为不同随机值）

# 4) 应用数据库迁移并生成 Prisma Client（首次）
pnpm --filter @utf8-git/web exec prisma migrate dev
```

- `apps/web/.env` 已被 gitignore，请勿提交。
- 需要 GitHub OAuth 本地联调时，按 `apps/web/.env.example` 注释创建 OAuth App 并填写 `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`。
- 登录、数据层与部署细节见 [README.md](README.md) 的「本地开发」与 [docs/deployment.md](docs/deployment.md)。

## 2. 常用命令

以下命令均在仓库根目录执行（定义见 `package.json`）：

| 命令                    | 作用                                                       |
| ----------------------- | ---------------------------------------------------------- |
| `pnpm dev`              | 启动 `apps/web` 开发服务器（http://localhost:3000）        |
| `pnpm build`            | 构建全部 workspace                                         |
| `pnpm lint`             | ESLint 全量检查                                            |
| `pnpm typecheck`        | TypeScript 类型检查                                        |
| `pnpm test`             | Vitest 单元测试                                            |
| `pnpm format`           | Prettier 全量格式化（`pnpm format:check` 仅检查）          |
| `pnpm perf`             | 用真实仓库做时间线性能验证（`scripts/perf-validate.mjs`）  |
| `pnpm deploy:selfcheck` | 对外部部署实例做部署自检（`scripts/deploy-selfcheck.mjs`） |

CI（`.github/workflows/ci.yml`）按 **lint → typecheck → test → build** 顺序执行，使用 pnpm 与 `.nvmrc` 指定的 Node LTS；请确保本地通过后再提交。

## 3. 分支模型

- `main` 为受保护分支，PR 合并前必须 CI 通过。
- 功能分支 `feat/<scope>`、修复分支 `fix/<scope>`；`<scope>` 用简短英文或拼音短语，例如 `feat/timeline-detail`。
- 分支从最新 `main` 检出，保持单一目的、粒度尽量小。

## 4. 提交规范

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，关键词优先使用：

`feat` · `fix` · `docs` · `chore` · `test` · `refactor`

格式为 `<type>(<scope>): <subject>`，例如 `feat(timeline): 支持按分支过滤`、`docs: 补充贡献指南`。

- commit-msg 钩子（`.husky/commit-msg`）会用 `commitlint.config.mjs` 自动校验，非法信息会被拒绝。
- 主题行使用祈使句、简洁描述「做了什么」，正文可补充「为什么」。

## 5. PR 流程与 Definition of Done

1. 从最新 `main` 检出分支并完成改动。
2. 本地跑通 `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build`。
3. 发起 PR，套用 [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md)，填写变更说明、关联 TODO/Issue、自测结果与文档/开发日志更新情况。
4. 通过 CI 与评审后合并到 `main`。

完成（Definition of Done）需同时满足：

- [ ] 功能可用
- [ ] 测试通过
- [ ] 文档更新
- [ ] 待办日志（`docs/todo.md`）同步
- [ ] 无 lint 错误

涉及架构、数据模型或安全的重要决策，请先在 Issue 中以文档形式讨论定稿，并在 [docs/development-log.md](docs/development-log.md) 追加一条记录（含理由）。

## 6. 代码风格

- 语言与类型：TypeScript，遵循仓库既有的目录与命名约定，不做与本次改动无关的重构。
- 静态检查：ESLint（`eslint.config.mjs`）与 TypeScript；提交前确保 `pnpm lint`、`pnpm typecheck` 通过。
- 格式化：Prettier（`.prettierrc.json`，行宽 100）；提交前运行 `pnpm format` 保持风格统一。
- 环境变量与密钥：不要提交任何密钥，`apps/web/.env` 等本地文件已在 `.gitignore` 中。

有问题欢迎在 Issue 中提出。
