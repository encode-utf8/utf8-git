# 验收清单 · M1-3 仓库列表页（含 TODO-113 / 114 / 116）

> 任务：`/repos` 仓库列表（含私有仓库、可见性标识、搜索/排序/过滤、分页、权限与空状态引导）
> 分支：`feat/m1-3-repos-list`
> 开始日期：2026-10-04

## 1. 任务目标

- `/repos` 展示当前用户创建/参与（含组织）的仓库，**包含私有仓库**并有可见性标识（FR-2.1 / US-02）。
- 仓库卡片展示：名称、描述、可见性、默认分支、语言、最近更新时间（FR-2.2）。
- 支持按名称/描述搜索、按最近更新或名称排序、按可见性过滤，且为前端即时过滤（FR-2.3，列表已加载时 < 100ms）。
- 分页：首屏 100 条 + 「加载更多」（FR-2.1 接受分页方案）。
- 令牌从账号表解密后仅在服务端使用，不返回前端（承接 M1-2 的安全约定）。
- 异常与引导（FR-1.4 / TODO-116）：令牌失效（401）→ 重新授权；限流（403）→ 恢复时间提示；组织 SSO 部分结果（`X-GitHub-SSO: partial-results`）→ 授权引导；空列表 → 自助排查路径。

## 2. 范围

- 包含：token 解密读取、GitHub 仓库列表 REST 客户端（错误分类）、`/repos` 页面与客户端列表组件、`/api/repos` 分页接口、proxy 保护、权限/空状态引导、单测（含 `RUN_DB_TESTS` 门控）、文档同步。
- 不包含：公开仓库直搜（FR-2.4，P2）、时间线页（M1-5）、TTL 缓存与限流降级缓存（M1-4）、组织 SSO 自动授权（需 GitHub 侧操作，仅提供引导）。

## 3. 验收项

- [x] 未登录访问 `/repos` → 302 `/login?callbackUrl=/repos`；登录后回跳
- [x] 列表展示用户仓库（含私有），私有仓库有可见性标识；卡片含名称/描述/默认分支/语言/更新时间
- [x] 搜索（名称/描述）、排序（最近更新/名称）、可见性过滤（全部/公开/私有）均为前端即时过滤
- [x] 「加载更多」分页可用；加载失败有重试入口
- [x] 401 / 403 限流 / SSO 部分结果 / 空列表 均有明确文案与行动入口（重新授权 / SSO 说明 / GitHub 设置链接）
- [x] access token 仅存在于服务端请求中，页面/接口响应/日志无明文令牌
- [x] 单测：响应归一化、Link 分页解析、错误分类（401 / 403 / 限流 / SSO）、过滤排序纯函数；DB 门控用例验证 `getAccessToken` 解密
- [x] `pnpm lint / typecheck / test / build` 全绿；CI 无 `.env` 场景通过
- [x] 文档同步：README、`docs/todo.md`、`docs/development-log.md`（含 ADR）

## 4. 验证方式

- 单测：Vitest（fetch mock；数据层用例需 `RUN_DB_TESTS=1`）。
- 真实端到端：使用本地真实会话（用户已完成 M1-2 人工登录，库中 token 为密文）访问 `/repos`，确认真实仓库（含私有）渲染与标识；再验证未登录/无效令牌的引导路径。
- 冒烟：未登录 `/repos` 302 → `/login?callbackUrl=/repos`；`/repos` 有效会话 200。

## 5. 通过标准

- 上述命令全部通过；真实仓库列表可见且私有仓库有标识；异常路径均有可操作引导；过滤/排序无外部请求。

## 6. 风险与假设

- 每次进入页面实时拉取首页（不加缓存），限流风险由 M1-4 的缓存策略统一处理。
- SSO 部分结果依赖 GitHub 返回的 `X-GitHub-SSO` 头；非 SSO 用户无感。
- 真实端到端验证依赖本地已有会话（若会话过期，需用户重新登录一次）。

## 7. 遗留与风险事项

- 2026-10-04 · 任务「M1-1 工程骨架初始化」· 分支 `feat/m1-monorepo-skeleton` · 结论：**通过（已确认，已提交并推送）**。
  - 证据：`pnpm install / lint / typecheck / test / build` 全部退出码 0；13 个单测通过（git-graph 4 · github-client 6 · ui 3）；`next build` 成功；生产服务冒烟测试 HTTP 200（137ms）。
  - 提交与 CI：提交 `0000e1c` 已推送远端；GitHub Actions 全绿（lint / typecheck / test / build 均 success，run 37207642647）。
  - 前提/风险：本机 `corepack enable` 因 D:\node.js 权限受限失败，改用用户级 `npm i -g pnpm@12`；仓库 `.npmrc` 使用 npmmirror 镜像。
- 2026-10-04 · M1-1 收尾（合并）· 结论：**已合并**。
  - 提交 `0000e1c` / `d5a098a` 经 PR #1（squash，合并提交 `2aafbdc`）合入 main；合并后 main 上 CI（run 37208804365）全绿。
  - 说明：合并时一处工具编码失误曾使 squash 标题中文丢失，已修正提交信息并 `--force-with-lease` 更新 main（当时无保护规则、无其他协作者）。
- 2026-10-04 · 任务「M1-2 GitHub OAuth 登录」· 分支 `feat/m1-2-github-oauth` · 结论：**通过（已合并）**。
  - 证据：`pnpm lint / typecheck / test / build` 全部退出码 0（21 个用例通过，其中数据库用例随 `RUN_DB_TESTS=1` 通过）；Prisma 迁移 `20261004144043_init_auth` 在 PostgreSQL 18 + Prisma 6.19.3 成功；生产冒烟 `/` 200、未登录 `/me` 302 → `/login?callbackUrl=%2Fme`、`/login` 200；OAuth 发起端点实测 scope=`read:user repo` + `state` + PKCE(S256)。
  - 合并：提交 `f21255a` 经 PR #2（squash，合并提交 `1efa708`）合入 main；合并前后 CI 均 success（run 37212709604）；收尾记录提交 `f026442`（CI success，run 37212842662）。
- 2026-10-04 · M1-2 遗留补齐 · 结论：**真实 GitHub 授权往返人工验证通过**（登录 → 回跳 `/me` → 账号/会话落库，令牌为密文），无问题。
- 2026-10-04 · 任务「M1-3 仓库列表页」· 分支 `feat/m1-3-repos-list` · 结论：**开发完成，待用户确认后提交**。
  - 证据：`pnpm lint / typecheck / test / build` 全绿；无 `.env` 的 CI 全真模拟同样通过；单测 24 例（本任务新增 16 例：客户端 11 · 过滤 4 · 令牌解密 1[门控]）；真实会话端到端：`/repos` 200 渲染 4 个真实仓库（含 1 个私有仓库及「私有」标识），首屏含搜索/过滤/排序控件，`/api/repos?page=2` 返回空页正常；未登录 `302 → /login?callbackUrl=%2Frepos`，伪造 Cookie `307 → /login`；页面与接口响应均无明文令牌。
