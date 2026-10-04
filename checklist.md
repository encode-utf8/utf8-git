# 验收清单 · M1-1 工程骨架初始化

> 任务：M1-1 初始化 monorepo 骨架（含 TODO-008 环境约定、TODO-101/102/103）
> 分支：`feat/m1-monorepo-skeleton`
> 开始日期：2026-10-04
> 状态：✅ 已完成（2026-10-04）

## 1. 任务目标

- 落地 pnpm monorepo 骨架：`apps/web` + `packages/*`（git-graph、github-client、ui）。
- 完成本地开发环境约定：Node 22 LTS + pnpm（corepack 管理），写入文档。
- 配置 ESLint + Prettier + commitlint（Conventional Commits）。
- 配置 GitHub Actions CI（lint → typecheck → test → build）。

## 2. 范围

- 包含：仓库结构、工具链配置、CI 工作流、README 开发说明、文档状态同步。
- 不包含：GitHub OAuth 接入（M1-2）、数据库（TODO-105）、时间线页面（M1-5）、部署（M1-6）。

## 3. 验收项

- [x] 根 package.json 声明 packageManager（pnpm）与 engines（Node 版本）
- [x] pnpm-workspace.yaml 覆盖 apps/*、packages/*
- [x] apps/web 为 Next.js（App Router + TypeScript + Tailwind）且 `next build` 成功
- [x] packages/git-graph、packages/github-client、packages/ui 可构建、有单测
- [x] ESLint（flat config）、Prettier、commitlint + husky 配置完成
- [x] `.github/workflows/ci.yml` 覆盖 lint → typecheck → test → build，使用 frozen lockfile
- [x] 本地 `pnpm install / lint / typecheck / test / build` 全部通过
- [x] README 包含本地开发说明；docs/todo.md、docs/roadmap.md 状态同步
- [x] docs/development-log.md 追加本次开发记录

## 4. 验证方式

- 本地依次执行：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`，确认退出码为 0。
- CI 的真实运行需推送后在 GitHub Actions 查看；本次不推送，先本地执行等价命令并检查工作流文件。

## 5. 通过标准

- 上述命令全部通过、无 lint/类型错误、单测全绿、`next build` 成功产出。
- 陌生开发者按 README 说明可完成安装与构建。

## 6. 风险与假设

- 本机 registry.npmjs.org 直连不可达，本地安装使用 npmmirror 镜像（不修改全局配置、不写入仓库）。
- GitHub Actions 仅在推送后真实运行；本地已验证等价命令，CI 结果待推送后确认。
- 本机 Node v22.22.1；以 Node 22 LTS 为基线（仍在支持期内），后续里程碑再评估升级。

## 7. 遗留与风险事项

- 2026-10-04 · 任务「M1-1 工程骨架初始化」· 分支 `feat/m1-monorepo-skeleton` · 结论：**通过（待用户确认提交）**。
  - 证据：`pnpm install / lint / typecheck / test / build` 全部退出码 0；13 个单测通过（git-graph 4 · github-client 6 · ui 3）；`next build` 成功；生产服务冒烟测试 HTTP 200（137ms）。
  - 前提/风险：本机 `corepack enable` 因 D:\node.js 权限受限失败，改用用户级 `npm i -g pnpm@12`；仓库 `.npmrc` 使用 npmmirror 镜像；CI 真实执行结果需推送后在 GitHub Actions 确认。
  - 后续动作：M1-2 接入 Auth.js GitHub OAuth；M1-3 实现 `/repos` 仓库列表；本次改动未提交、未合并、未推送，等待用户手动确认。
