# 验收清单 · M1-4 GitHub 数据层（含 TODO-121 / 122 / 123）

> 任务：GraphQL 客户端封装（错误 / 重试 / 限流读取）、服务端 TTL 缓存与 cursor 分页管理、限流降级（缓存展示 + 恢复时间提示）
> 分支：`feat/m1-4-github-data-layer`
> 开始日期：2026-10-05

## 1. 任务目标

- 时间线读路径统一走 GraphQL v4 聚合查询（提交 + 分支头 + 关联 PR + `rateLimit`），单页仅 1 次 GitHub 请求（对应路线图验收「单仓库时间线 ≤3 次请求」）。
- 客户端封装：超时中止、瞬时错误重试（5xx / 网络 / 超时，指数退避）、错误分类（401 / 403 / 404 / 限流 / GraphQL 错误）。
- 服务端 TTL 缓存（技术分析 §6.2：仓库列表 5 min、时间线首页 2 min）；仅服务端内存，按用户隔离，不进入浏览器 / CDN 缓存。
- 分页 cursor 管理：按（用户, 仓库, 分支）维护 endCursor 链，翻页增量拉取，已加载页不重复请求。
- 限流降级：读取 `rateLimit` 剩余量，低于阈值（默认 100，可用环境变量调整）且有陈旧缓存时降级展示并标注恢复时间；无缓存时返回明确错误 + 恢复时间（不用过期缓存冒充最新数据）。
- 部分失败降级：GraphQL 返回 `data + errors` 时展示可得数据并标注警告（局部失败优于整体白屏）。

## 2. 范围

- 包含：共享错误抽取（`github-errors.ts`）、GraphQL 客户端（`github-graphql.ts`）、时间线查询与归一化（`github-timeline.ts`）、TTL 缓存（`server-cache.ts`）、限流快照（`rate-limit-store.ts`）、服务层（`repos-data.ts` / `timeline-data.ts`）、时间线接口 `/api/repos/[owner]/[name]/timeline`、`/repos` 与 `/api/repos` 接入缓存与降级、单测与文档同步。
- 不包含：时间线页面 UI / 虚拟滚动（M1-5）、断网与超时体验页（M1-9）、Redis 等外部缓存（多实例部署时再评估）、Webhook 准实时更新（BLOCK-03）。

## 3. 验收项

- [x] GraphQL 客户端：超时中止、瞬时错误重试、401/403/404/限流/GraphQL 错误分类、`rateLimit` 读取
- [x] 时间线聚合查询：提交 + 分支头 + 关联 PR + `rateLimit` 一次取回；归一化防御性解析
- [x] TTL 缓存生效：同页 2 min 内重复访问不再请求 GitHub（单测断言 fetch 次数）；仓库列表 5 min
- [x] cursor 分页：第 2 页使用第 1 页 endCursor；已加载页不重复请求；cursor 链缺失时返回 `cursor_expired`
- [x] 限流降级：低余额 + 有陈旧缓存 → 降级展示（标注 stale / degraded / resetAt）；无缓存 → 429 + 恢复时间
- [x] 部分失败：`data + errors` 时返回可得数据并带 warnings
- [x] `/api/repos?page=N` 与 `/repos` 接入 5 min 缓存与降级路径（页面提示缓存时间与恢复时间）
- [x] 单测覆盖数据层关键路径（客户端 / 缓存 / 降级 / cursor）；`pnpm lint / typecheck / test / build` 全绿
- [x] 真实端到端：真实会话请求时间线接口（真实仓库），二次请求命中缓存；页面与接口无明文令牌
- [x] 文档同步：README、`docs/todo.md`（TODO-121/122/123）、`docs/development-log.md`（ADR）

## 4. 验证方式

- 单测：Vitest + fetch mock + 注入时钟 / 侧依赖（缓存、限流快照、sleep 均注入），覆盖重试、超时、TTL、淘汰、降级、cursor 链。
- 真实端到端：本地 dev server + 临时真实会话（数据库插入临时 session 行）请求 `/api/repos` 与 `/api/repos/<owner>/<name>/timeline`，验证真实数据、二次请求 `meta.cached=true`、无明文令牌；验证后删除临时会话。
- 冒烟：未登录 401；伪造 Cookie 由 proxy 拦截跳登录。

## 5. 通过标准

- 单仓库时间线单页 1 次 GitHub 请求（≤3）；限流场景有降级展示与恢复时间；缓存 / 降级 / cursor 均有单测证明；CI 全绿。

## 6. 风险与假设

- 内存缓存仅在单实例内有效（MVP 单实例部署）；多实例 / Serverless 需外部缓存，作为后续评估项记录。
- 缓存只存元数据（提交 / 分支 / PR 元信息），按用户隔离，不落库、不写磁盘；令牌永不进入缓存键与日志。
- 限流阈值默认 remaining ≤ 100（环境变量可调）；GitHub 配额模型（REST 5000 req/h、GraphQL 5000 点/h）以官方为准。
- 分页 cursor 链为进程内状态：服务重启或缓存淘汰后，深页请求返回 `cursor_expired`，由客户端重载第 1 页（M1-5 处理）。

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
- 2026-10-04 · 任务「M1-3 仓库列表页」· 分支 `feat/m1-3-repos-list` · 结论：**通过（已合并）**。
  - 证据：`pnpm lint / typecheck / test / build` 全绿；无 `.env` 的 CI 全真模拟同样通过；单测 24 例（本任务新增 16 例：客户端 11 · 过滤 4 · 令牌解密 1[门控]）；真实会话端到端：`/repos` 200 渲染 4 个真实仓库（含 1 个私有仓库及「私有」标识），首屏含搜索/过滤/排序控件，`/api/repos?page=2` 返回空页正常；未登录 `302 → /login?callbackUrl=%2Frepos`，伪造 Cookie `307 → /login`；页面与接口响应均无明文令牌。
  - 合并：提交 `2d1b8c2` 经 PR #3（squash，合并提交 `7bae254`）合入 main；PR 检查全绿（run 37214959863 / 37214983465，含 GitGuardian）。

- 2026-10-05 · 任务「M1-4 GitHub 数据层」· 分支 `feat/m1-4-github-data-layer` · 结论：**通过（已合并）**。
  - 证据：`pnpm lint / typecheck / test / build` 全绿；单测 80 例（本任务新增 43 例）；真实会话端到端：`/api/repos` 首访 4 个真实仓库、二次 `meta.cached=true`；`/api/repos/encode-utf8/utf8-git/timeline` 返回 7 提交 / 4 分支、二次命中缓存；`stock-analysis` 第 1/2 页各 50 提交且 cursor 正确；`page=5` → 409 `cursor_expired`、`page=0` → 400、非法分支 400、未知仓库 404、未登录 401/302；响应无明文令牌；临时验证会话已删除。
  - 说明：限流降级（低配额 → 陈旧缓存）由 6 个单测用例覆盖；端到端触发需真实配额耗尽，待 M1-9 结合 UI 复验。
  - 合并：提交 `782668d` 经 PR #4（squash，合并提交 `2c65485`）合入 main；检查全绿（GitHub Actions run 37482944323、GitGuardian success）。
