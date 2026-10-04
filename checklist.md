# 验收清单 · M1-2 GitHub OAuth 登录（含 TODO-105 / 111 / 112）

> 任务：M1-2 GitHub OAuth 登录（Auth.js 接入、会话持久化、令牌加密入库）
> 分支：`feat/m1-2-github-oauth`
> 开始日期：2026-10-04

## 1. 任务目标

- 接入 Auth.js（next-auth v5）GitHub Provider：scope `read:user` + `repo`；state 防 CSRF（PKCE 视 GitHub 支持情况启用）。
- 落地 PostgreSQL + Prisma 基线（本地 Docker 开发库），会话与账号持久化。
- access / refresh token 使用 AES-256-GCM 加密落库，密钥独立于数据库；令牌不返回前端、不写日志。
- 登录 / 登出 / 未登录跳转与回跳：`/login` 登录页、`/me` 受保护页、`proxy.ts` 乐观拦截。
- 面向最终用户的「零配置」：平台内置 OAuth App，用户无需填写任何配置。

## 2. 范围

- 包含：Prisma schema 与迁移、认证配置、自定义加密适配器、登录/登出页面与受保护页、环境变量说明（`.env.example`）、单测与本地验证、文档同步。
- 不包含：仓库列表页（M1-3）、时间线（M1-5）、组织 SSO 引导页（M1-8）、Vercel / Neon 生产部署（M1-6）、真实 GitHub 授权端到端点击验证（需用户提供 OAuth App 凭据，见风险）。

## 3. 验收项

- [x] 本地 PostgreSQL（docker compose）可启动；Prisma 迁移成功（User / Account / Session / VerificationToken）
- [x] next-auth v5 + GitHub Provider 配置完成（scope `read:user repo`，state，PKCE 支持时启用）
- [x] 自定义 Prisma 适配器：token 以 AES-256-GCM 密文入库，解密仅发生在服务端
- [x] 数据库会话 + HttpOnly / Secure / SameSite Cookie；登出清除会话记录
- [x] `/login` 提供 GitHub 登录入口与权限用途说明；未登录访问 `/me` 跳转 `/login?callbackUrl=/me`，登录后回跳
- [x] 令牌不出服务端：session 对象与页面不包含 token；日志无明文令牌
- [x] 单元测试：crypto 往返 / 篡改检测 / 错密钥失败；DB 加密落库用例（`RUN_DB_TESTS` 门控）
- [x] `pnpm lint / typecheck / test / build` 全绿
- [x] 文档同步：README 环境配置说明、`docs/todo.md`、`docs/roadmap.md`、`docs/development-log.md`

## 4. 验证方式

- 本地：启动 Docker Postgres → `prisma migrate dev` → `pnpm dev` → 冒烟（`/` 200、未登录 `/me` → 302 `/login`、`/login` 200 且含登录按钮）。
- 单测：Vitest（crypto；DB 用例验证密文 ≠ 明文，需 `RUN_DB_TESTS=1`）。
- 真实 GitHub 授权往返：需用户创建 OAuth App 并提供 Client ID / Secret 后手动点选验证（未完成前记为遗留）。

## 5. 通过标准

- 上述命令全部通过；未登录跳转与回跳逻辑正确；数据库内 token 为密文；页面 / 日志 / 会话对象均无明文令牌。

## 6. 风险与假设

- next-auth v5 为 beta 版本；以安装版本的类型定义与实际行为为准。
- 真实 OAuth 往返依赖用户提供 OAuth App 凭据；本地先覆盖可自动化验证的部分。
- Prisma 采用 6.19.3 稳定线（7.x / 8.x 引擎与配置模式有大改，MVP 期不冒险），M4 再评估升级。
- 本地 Docker Desktop 需保持运行（本次已启动引擎）。

## 7. 遗留与风险事项

- 2026-10-04 · 任务「M1-1 工程骨架初始化」· 分支 `feat/m1-monorepo-skeleton` · 结论：**通过（已确认，已提交并推送）**。
  - 证据：`pnpm install / lint / typecheck / test / build` 全部退出码 0；13 个单测通过（git-graph 4 · github-client 6 · ui 3）；`next build` 成功；生产服务冒烟测试 HTTP 200（137ms）。
  - 提交与 CI：提交 `0000e1c` 已推送远端；GitHub Actions 全绿（lint / typecheck / test / build 均 success，run 37207642647）。
  - 前提/风险：本机 `corepack enable` 因 D:\node.js 权限受限失败，改用用户级 `npm i -g pnpm@12`；仓库 `.npmrc` 使用 npmmirror 镜像。
- 2026-10-04 · M1-1 收尾（合并）· 结论：**已合并**。
  - 提交 `0000e1c` / `d5a098a` 经 PR #1（squash，合并提交 `2aafbdc`）合入 main；合并后 main 上 CI（run 37208804365）全绿。
  - 说明：合并时一处工具编码失误曾使 squash 标题中文丢失，已修正提交信息并 `--force-with-lease` 更新 main（当时无保护规则、无其他协作者）。
- 2026-10-04 · 任务「M1-2 GitHub OAuth 登录」· 分支 `feat/m1-2-github-oauth` · 结论：**开发完成，待用户确认后提交**。
  - 证据：`pnpm lint / typecheck / test / build` 全部退出码 0（21 个用例通过，其中数据库用例随 `RUN_DB_TESTS=1` 通过）；Prisma 迁移 `20261004144043_init_auth` 在 PostgreSQL 18 + Prisma 6.19.3 成功；生产冒烟 `/` 200、未登录 `/me` 302 → `/login?callbackUrl=%2Fme`、`/login` 200 且含登录按钮/权限用途/撤销说明；OAuth 发起端点实测 scope=`read:user repo` + `state` + PKCE(S256)；伪造 Cookie 被服务端会话校验拦截；写入真实会话后 `/me` 渲染 200（测试数据已清理）。
  - 遗留：真实 GitHub 授权往返未验证（需用户创建 OAuth App 并在 `.env` 填入 Client ID / Secret）；TODO-115 内容已由 `/login` 覆盖，待 M1-3 复核勾选。
  - 备注：`docs/roadmap.md` 任务表不跟踪单任务状态，本次无需改动。
- 2026-10-04 · M1-2 收尾（合并）· 结论：**已合并，CI 全绿**。
  - 提交 `f21255a`（PR #2：https://github.com/encode-utf8/utf8-git/pull/2）以 squash 方式合入 main，合并提交 `1efa708`；合并前 push / pull_request 两条 CI 均 success，合并后 main CI success（run 37212709604）。
  - 遗留：真实 GitHub 授权往返仍待人工点击验证（本地 `.env` 已配置凭据，`pnpm dev` 后访问 `/login` 即可）。
