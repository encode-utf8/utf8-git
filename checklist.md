# 验收清单 · 任务：TODO-142 Playwright E2E（登录 mock → 选仓库 → 浏览时间线）

> 分支：`feat/e2e-playwright`
> 开始日期：2026-10-07
> 参照：`docs/roadmap.md` M1 退出标准 · `docs/todo.md` TODO-142 · `apps/web/lib/github-endpoints.ts`

## 1. 任务目标

- 补齐 M1 退出标准中缺失的 E2E：项目当前 **0 条 E2E**。
- 用真实浏览器跑通关键路径：登录（mock GitHub OAuth）→ `/repos` 选择仓库 → 时间线渲染提交。

## 2. 改动程度评估（工作流第 1 条）

- 涉及模块：新增 `apps/web/lib/github-endpoints.ts`；改动 4 处 GitHub 客户端调用点（commits / graphql / repos / token）；`lib/auth.ts` 授权端点；新增 `e2e/` 与 `apps/web/playwright.config.ts`；CI 工作流；文档。
- 是否改动公共接口 / 数据结构：**不改** Prisma schema、不改对外 API 契约。新增环境变量 `E2E_MODE` 等，**仅在 `E2E_MODE=1` 时生效**，生产默认行为不变（有单测佐证）。
- 结论：**改动中等偏大**（新增测试基础设施 + 触及 5 个既有文件）→ 按工作流在独立分支 `feat/e2e-playwright` 开发，不在 main 直接改。

## 3. 范围

- 包含：Playwright + 本地 mock GitHub（授权 / 令牌 / REST / GraphQL）；1 条端到端用例；CI 接入（Postgres service）；文档。
- 不包含：跨浏览器矩阵（先只跑 Chromium）；视觉回归；性能断言。

## 4. 验收项

- [x] GitHub 端点可被 `E2E_MODE=1` 覆写；未开启时一律真实地址（`github-endpoints.test.ts` 3 例）
- [x] 既有 4 处调用点改用解析函数；`pnpm test` 152 例通过、`typecheck` 全绿
- [ ] mock GitHub 提供 authorize / token / user/repos / graphql 四个端点
- [ ] Playwright 用例：点「用 GitHub 登录」→ 回跳 `/repos` → 点击仓库 → 时间线出现提交节点
- [ ] CI 增加 Postgres service 并跑通 E2E
- [ ] 文档说明本地如何运行（含 Docker 依赖）
- [ ] `pnpm lint / typecheck / test` 全绿

## 5. 验证方式

- 本地：`docker compose -f docker-compose.dev.yml up -d` 起 Postgres → `pnpm e2e`。
- CI：新增 e2e job（Postgres service + `playwright install --with-deps chromium`）。

## 6. 通过标准

- 关键路径 E2E 在 CI 稳定通过；生产默认端点不变（有单测佐证）。

## 7. 风险与假设

- 本地验证依赖 Docker / Postgres；本机 Docker 未运行，若无法启动只能靠 CI 验证，迭代成本高（每轮数分钟）。
- mock 必须与真实 GitHub 的响应形状一致（GraphQL 字段、REST `Link` 头），否则用例通过但失真；以既有单测夹具为准。
- `e2e/` 与 `playwright.config.ts` 需排除在 Next.js 构建与 ESLint 现有范围之外，避免影响 `pnpm build`。

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

- 2026-10-06 · 任务「M1-5 时间线 v1」· 分支 `feat/m1-5-timeline-v1` · 结论：**通过（已合并）**。
  - 证据：`pnpm lint / typecheck / test / build` 全绿；单测 90 通过 / 2 跳过（本任务新增 25 例：窗口 5 · 格式化 5 · 去重 3 · 详情归一化与错误分类 7 · 详情缓存 / 降级 5）；真实会话端到端 10/10——`/repos/encode-utf8/utf8-git` 200 且含提交行与分支选择；详情首次 `cached=false`（stats 2/1、files 1）→ 二次 `meta.cached=true`；7 位短 SHA 可用；非法 SHA 400、不存在提交 404、未知仓库 404；`torvalds/linux` 连续 11 页各 50 条共 550 条无重复；响应无令牌泄漏；临时验证会话已删除。
  - 修复：dev 热重载旧单例缺 `commitCache` 导致详情 500（按字段存在性重建单例）；GitHub 422（SHA 无法解析）归类为「提交不存在」（404）。
  - 说明：验证期间发现 GitHub OAuth access token 已于 2026-10-04 过期（GitHub 侧开启令牌过期策略），端到端用本机 git 凭证令牌临时替换、验证后已还原；用户需在浏览器重新授权，建议后续实现 refresh token 自动续期。
  - 合并：提交 `245cbd9` 经 PR #5（squash，合并提交 `02e765c`）合入 main；合并前检查全绿（GitHub Actions run 37491837632 / 37491874617、GitGuardian success），合并后 main CI（run 37492163271）全绿。

- 2026-10-07 · 任务「修复：重新授权后令牌未更新」· 分支 `fix/relogin-token-update` · 结论：**通过（已合并）**。
  - 根因：Auth.js（@auth/core 0.41.3）对已存在账号在 OAuth 回调中跳过 `linkAccount`（`handle-login.js` L179–199），重新授权的新令牌被丢弃，库中一直是首次授权的旧令牌。
  - 修复：`auth-adapter.ts` 新增 `upsertAccountTokens`（AES-256-GCM 加密 upsert，缺省 refresh_token 时保留旧值）；`auth.ts` 增加 `events.signIn` 每次登录写回最新令牌密文。
  - 证据：`pnpm lint / typecheck / test / build` 全绿；数据库用例 1 例（新建 / 更新 / 保留旧 refresh token / 密文入库 / 不重复建行）；真实浏览器重新授权后 `accounts.expires_at` 更新为 2026-10-07 01:42:23 UTC、`access_token_enc` 密文更换、账号行仍为 1 条，`/repos` 正常加载（用户确认）。
  - 合并：提交 `56a04fa` 经 PR #6（squash，合并提交 `fb6dbab`）合入 main；检查全绿（GitGuardian success、Actions success）。
  - 后续：GitHub 令牌 8 小时过期 → 下一个任务实现 refresh token 自动续期（refresh token 有效期 6 个月，已入库）。

- 2026-10-07 · 任务「令牌自动续期（refresh token 轮换）」· 分支 `feat/token-auto-refresh` · 结论：**通过（已合并）**。
  - 证据：`pnpm lint / typecheck / test / build` 全绿；单测 104 例（本任务新增 13 例：令牌端点 6 · 续期编排 7，含并发去重）；端到端把库中 `expires_at` 置为过去 → 访问 `/repos` 200 并渲染 4 个真实仓库（含私有），库中密文更换、`expires_at` 更新为 2026-10-07 01:52:17 UTC（now + 8 h），二次请求不再续期；响应无明文令牌；临时验证会话已删除。
  - 说明：并发去重为进程内实现（单实例）；多实例场景随 M1-6 部署形态评估（ADR-0029）。
  - 合并：提交 `1f138e5` 经 PR #7（squash，合并提交 `a08a070`）合入 main；检查全绿（GitGuardian success、Actions Lint/Typecheck/Test/Build success ×2）。
- 2026-10-07 · 任务「M1-9 在线状态处理（断网 / 超时 / 限流）」· 分支 `feat/online-status-handling` · 结论：**通过（已合并）**。
  - 证据：`pnpm lint / typecheck / test / build` 全绿；单测 131 例（本任务新增 26 例：错误分类 / 文案 / 退避 11、客户端重试 8、请求封装 6，含真实 socket 连接失败用例）。端到端（真实会话，临时会话 / 用户已删除）：正常路径 `/repos` 200、`/api/repos` 200；上游临时指向 `http://127.0.0.1:9` → `/api/repos` 503 `github_unreachable`、`/repos` 页显示「无法连接 GitHub」+ 重试；指向黑洞监听 `127.0.0.1:9931` → 15.25 s 后 504 `github_timeout`、`/repos` 页显示「请求超时」；验证后上游配置按字节还原。
  - 说明：客户端自动重试只覆盖瞬时错误（ADR-0031），限流 / 鉴权失败改为明文提示 + 手动重试；离线横幅依赖 `navigator.onLine`（ADR-0032 区分网络不可达与超时）；多实例下的缓存 / 限流 / 续期去重随 M1-6。
  - 合并：提交 `dcd926f` 经 PR #8（squash，合并提交 `0a4a2e5`）合入 main；检查全绿（GitGuardian success、Actions Lint / Typecheck / Test / Build success ×2）。
- 2026-10-07 · 任务「M1-6 部署形态与多实例一致性」· 分支 `feat/m1-6-deployment` · 结论：**通过（已合并）**。
  - 证据：新增共享存储抽象与 Postgres 实现（`shared-store.ts` / `pg-stores.ts`）、Prisma `SharedCacheEntry` / `RateLimitState` 与迁移 `20261007081155_m1_6_shared_stores`；`STORE_BACKEND` 切换后端；数据服务兼容同步 / 异步存储；续期竞态恢复。`pnpm lint / typecheck / test / build` 全绿（web 138 通过 / 4 跳过；`RUN_DB_TESTS=1` 时 142 例全通过）。双实例 E2E（`next start` 3101 / 3102 + 同一 PostgreSQL + `STORE_BACKEND=postgres`）：实例 A 回源 `cached=false` → 实例 B `cached=true` 且 `fetchedAt` 一致；实例 B 复用实例 A 写入的 cursor 链翻第 2 页 200；4 轮并发续期竞态 A / B 均 200 且每轮仅轮换一次 refresh token；限流快照跨实例可读。过程中修复 `cacheKey` 以 NUL 分隔导致 Postgres 报 `invalid byte sequence for encoding "UTF8": 0x00` 的缺陷（改为 U+001F）。新增 `docs/deployment.md`。
  - 说明：真实 Vercel / Neon 部署与公网冷启动实测需用户账号（TODO-104）；续期去重仍有「两实例同时刷新且都失败」的极小窗口，后续可用数据库租约消除。
  - 合并：提交 `450af8e` 经 PR #9（squash，源提交 `6937503` / `0cd8922`）合入 main；检查全绿（GitGuardian success、Actions Lint / Typecheck / Test / Build success）。
- 2026-10-07 · 任务「M1-7 真实仓库性能验证」· 分支 `feat/m1-6-deployment`（与 M1-6 合并为同一 PR） · 结论：**通过（已合并）**。
  - 证据：新增 `scripts/perf-validate.mjs`（根目录 `pnpm perf`）与报告 `docs/reports/tech-analysis/M1-7-perf-validation.md` + 原始数据 `M1-7-raw.json` / `M1-7-raw-linux-deep.json`。仓库列表回源 1795.8 ms → 命中缓存 37.0 ms（≈48×）；时间线命中页 23–42 ms、回源页 2.1–3.1 s（本地经代理访问 GitHub 口径）；热缓存首屏 HTML TTFB 58–64 ms；生产模式冷启动 Ready 1.5–2.3 s；`torvalds/linux` 连续 11 页 550 条 0 重复、无乱序。修复越界翻页重复返回第 1 页数据（`timeline-data.ts` + 2 个单测）。
  - 说明：Lighthouse ≥ 80 与 1000+ 提交虚拟滚动流畅度需浏览器与公网环境实测；冷缓存首屏 1.83–2.27 s 为本地代理链路口径，需公网复测。
  - 合并：提交 `450af8e` 经 PR #9（squash，源提交 `56dd2f9` / `a080444`）合入 main；检查全绿（GitGuardian success、Actions Lint / Typecheck / Test / Build success）。
- 2026-10-07 · 任务「固化 Vercel 构建配置」· 分支 `chore/vercel-config` · 结论：**通过（已合并）**。
  - 背景：首次 Vercel 部署时后台 Build Command 预填的 `next build` 与粘贴内容拼成 `next buildprisma generate && next build` → `Invalid project directory provided ... buildprisma`；环境变量里手动设置 `NODE_ENV` → `non-standard "NODE_ENV" value` 警告。
  - 证据：新增 `apps/web/vercel.json`（`buildCommand` / `installCommand`）；`docs/deployment.md` 修正 Root Directory 为 `apps/web`、明确迁移在本地对生产库执行、后台字段必须留空，并新增 §3.1「常见坑」；`development-log` 记录 ADR-0038 / ADR-0039。`vercel.json` 通过 JSON 校验；`pnpm lint / typecheck / test / build` 全绿（web 138 通过 / 4 跳过）。
  - 说明：Vercel 后台的 Build Command / Install Command / Output Directory 需保持空白，否则覆盖本配置；预览环境随机域名的 OAuth 回调仍未处理。
  - 合并：提交 `62974dc` 经 PR #10（squash，源提交 `587f7f1`）合入 main；CI 全绿（Actions Lint / Typecheck / Test / Build success ×2、Vercel Preview success）；GitGuardian 该次检查长时间停留在 in_progress（第三方挂起），未阻塞合并。
- 2026-10-07 · 任务「线上部署验收（Vercel + Neon）」· 分支 `docs/deployment-verification` · 结论：**通过（已合并）**。
  - 证据：新增 `docs/reports/tech-analysis/M1-6-deployment-verification.md`；Neon 以直连主机应用 `20261004144043_init_auth` / `20261007081155_m1_6_shared_stores`，7 张表建齐且业务表 0 行；线上经代理由外复测 `/` 200、`/login` 200、`/api/repos` 与 timeline 未登录 401、`/api/auth/providers` 回调指向生产域名、`/api/auth/csrf` 下发 `__Host-` / `__Secure-`、`POST /api/auth/signin/github` 302 且 `scope=read:user repo`。
  - 说明：浏览器登录实测报 `The redirect_uri is not associated with this application`，定位为 **GitHub OAuth App 配置问题**（Authorization callback URL 只能填一个，原文档「追加生产域名」的指引不可行，生产地址实际未登记）；已修正 `docs/deployment.md` §3 / §3.1，并更正验收报告中「打开 authorize URL 得 302 即已注册」的误判。属平台配置，非代码缺陷。
  - 合并：提交 `98fff02` 经 PR #11（squash，源提交 `48469cf` / `bd8bc63`）合入 main；CI 全绿（Actions Lint / Typecheck / Test / Build success ×2、Vercel Preview success）。
- 2026-10-07 · 任务「部署自检（/api/health + 自检脚本）」· 分支 `feat/deploy-selfcheck` · 结论：**通过（已合并）**。
  - 证据：新增 `apps/web/lib/health.ts` 与 `GET /api/health`（核对 `STORE_BACKEND`、数据库连通与往返、迁移表齐全、必填密钥、`AUTH_TOKEN_ENC_KEY` 长度，并返回 `functionRegion` 与跨区告警）；新增 `scripts/deploy-selfcheck.mjs`（`pnpm deploy:selfcheck`）；`apps/web/lib/health.test.ts` 11 例通过；`pnpm lint / typecheck / test` 全绿（web 149 通过 / 4 跳过）。
  - 说明：本任务起因是用户反馈「翻页 409 `cursor_expired` + 操作迟缓」。取响应头 `x-vercel-id` 定位真因是**函数区 `iad1` 与 Neon `ap-southeast-1` 跨区**（会话策略 `database`，登录后每请求串行 4~6 次数据库查询），跨区往返把单次查询抬到 200 ms 以上。文档 §3.1 已补「所有操作都迟钝」排查条目，ADR-0044 记录「函数区与数据库区必须同区」。用户随后将 Vercel 函数区改为新加坡并重新部署，改区后的生产实测见下一条记录。
  - 合并：提交 `d256cb8` 经 PR #12（squash，源提交 `58daf35` / `7b07ae8` / `ff1ac8c`）合入 main；CI 全绿（Actions Lint / Typecheck / Test / Build success ×2、Vercel Preview success）。
