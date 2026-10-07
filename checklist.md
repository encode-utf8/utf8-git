# 验收清单 · 任务：M1-6 部署形态与多实例一致性（含追加任务 M1-7 真实仓库性能验证）

> 任务：确定并落地部署形态（Vercel + 托管 Postgres），并解决多实例下的缓存 / 限流 / 续期去重问题
> 分支：`feat/m1-6-deployment`
> 开始日期：2026-10-07
> 参照：`docs/roadmap.md` M1-6 · `docs/technical-analysis.md` §2 / §6.2 / §10 · `docs/todo.md` TODO-104

## 1. 任务目标

- 明确部署形态：Next.js 应用部署到 Vercel，数据库使用托管 PostgreSQL（Neon / Supabase 免费层），环境变量由平台注入；产出可直接照做的部署文档。
- 解决多实例（Serverless 多实例 / 多 region）下的三处进程内状态问题：
  1. TTL 缓存不跨实例共享，缓存命中率随实例数下降；
  2. 限流快照各实例独立，降级判定不一致，可能多打请求；
  3. 令牌续期在同一用户并发时可能重复刷新（refresh token 每次轮换），导致误判「授权失效」。
- Vercel / Neon 的真实部署需要用户账号：本次完成代码与文档侧，实际部署与公网验收作为遗留项明确列出。

## 2. 范围

- 包含：共享存储抽象与 Postgres 实现（`shared-store.ts` / `pg-stores.ts` + 新增 Prisma 模型与迁移）；`data-stores.ts` 按 `STORE_BACKEND` 选择后端；数据服务兼容同步 / 异步存储；续期竞态的幂等恢复；`docs/deployment.md`；README / todo / development-log / checklist 同步。
- 不包含：真实 Vercel / Neon 部署（需用户账号）、Redis 等外部缓存服务、多 region 复制拓扑。

## 3. 验收项

- [x] 新增 `TtlCacheLike` / `RateLimitStoreLike` 抽象，现有内存实现无需改动即满足
- [x] 新增 Postgres 实现：TTL 缓存（读 / 写 / 删除 + 过期清理）与限流快照（读写 + 降级判定）
- [x] Prisma 新增共享缓存 / 限流快照模型与迁移
- [x] `STORE_BACKEND` 选择后端（默认 memory，`postgres` 走数据库；非法值回退 memory）并有单测
- [x] 数据服务（repos / timeline / commit）兼容同步与异步存储
- [x] 续期竞态：刷新被拒时重读库中最新令牌，其他实例已完成续期则直接复用，不误报「授权失效」
- [x] `docs/deployment.md`：部署形态、环境变量清单、Prisma 连接池、冷启动与超时注意、多实例一致性、预览环境与回滚
- [x] `pnpm lint / typecheck / test / build` 全绿
- [x] 端到端（本地两个实例 + 同一数据库）：实例 A 写入的缓存被实例 B 命中
- [ ] 文档同步与合并记录

## 4. 验证方式

- 单测：后端选择与纯函数（新鲜度 / 降级判定）、Postgres 存储的数据库用例（`RUN_DB_TESTS=1` 门控）、续期竞态恢复用例。
- 端到端：同一数据库启动两个 `next start` 实例（不同端口），验证跨实例缓存命中；`STORE_BACKEND=memory`（默认）行为与现状一致（无回归）。
- 回归：`/repos` 与时间线页面的既有端到端路径。

**本轮验证记录（2026-10-07）**

- 单测：`pnpm --filter @utf8-git/web test` → 20 文件通过 / 2 跳过（138 通过 / 4 跳过）；
  `RUN_DB_TESTS=1` 时 22 文件 / 142 例全通过（含跨实例缓存、限流快照、续期竞态恢复、越界翻页空页）。
- 构建：`lint` / `typecheck` / `build` 全绿（`next build` 编译 5.0s）。
- 端到端：`next start` 起两个实例（3101 / 3102）+ 同一 PostgreSQL（`STORE_BACKEND=postgres`）：
  - 缓存：实例 A `/api/repos?page=1` → `cached=false`（回源 GitHub，写入 `shared_cache_entries`）；
    实例 B 同请求 → `cached=true` 且 `fetchedAt` 与 A 完全一致。
  - cursor 链：实例 A 取时间线 page=1，实例 B 取 page=2 → 200（未出现 `cursor_expired`）。
  - 续期去重：4 轮「两实例同时请求」并发竞态，每轮 A/B 均 200，`refresh_token_enc` 每轮仅轮换一次，
    `expires_at` 推进到 now+8h（落败实例复用获胜实例写入的令牌）。
  - 限流快照：`rate_limit_states` 出现该用户行（`remaining` / `source` / `reset_at`），跨实例共享。
- 修复的真实缺陷：`cacheKey` 原用 NUL（`\u0000`）分隔，Postgres `text` 不接受 `0x00`，
  共享缓存查询报 `invalid byte sequence for encoding "UTF8": 0x00`；改为 U+001F 后通过（同步更新单测）。
- 环境说明：本机可直连 `api.github.com`，但 `github.com`（令牌续期端点）需经本地代理，
  双实例验证时通过启动包装脚本注入 `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY`；生产环境不需要该配置。

## 5. 通过标准

- 部署形态有明确文档与配置清单；多实例下缓存与限流快照共享、续期不再误报授权失效；单实例默认行为不变。

## 6. 风险与假设

- 真实 Vercel / Neon 部署需用户账号：本次只完成代码与文档，公网验收留待用户提供账号或授权。
- Postgres 作为缓存会带来额外数据库往返（每页约 1 读 + 1 写）；MVP 以一致性优先，必要时再引入 Redis。
- 「冷启动 < 3s」需在真实平台测量；本次用本地生产模式启动耗时做近似参考。

## 附：M1-7 追加任务 · 真实仓库性能验证（TODO-143）

**目标**：用小 / 中 / 大三个真实仓库量测时间线与仓库列表的关键指标，验证「单页 1 次请求、翻页无重复、缓存有效」，并沉淀可复现的验证手段。

**验收项**

- [x] 可复现的性能验证脚本（`scripts/perf-validate.mjs`，根目录 `pnpm perf`）
- [x] 覆盖小 `encode-utf8/utf8-git`（17 commits）/ 中 `encode-utf8/stock-analysis` / 大 `torvalds/linux`
- [x] 量测时间线翻页耗时、每页请求数、提交去重、缓存命中（`meta.cached`）
- [x] 大仓库深度翻页：11 页 × 50 = 550 条，跨页重复 0、顺序正确
- [x] 报告留痕：`docs/reports/tech-analysis/M1-7-perf-validation.md` + `M1-7-raw.json` / `M1-7-raw-linux-deep.json`
- [x] 修复验证中发现的越界翻页重复问题（`timeline-data.ts` + 2 个单测）
- [x] `pnpm lint / typecheck / test / build` 全绿

**关键数据**：仓库列表回源 1795.8 ms → 命中缓存 37.0 ms（≈48×）；时间线命中页 23–42 ms、回源页 2.1–3.1 s（本地经代理访问 GitHub 的口径）；热缓存首屏 HTML TTFB 58–64 ms；生产模式冷启动 Ready 1.5–2.3 s。

**未达标 / 未验证**：冷缓存首屏 1.83–2.27 s（本地代理链路导致，需公网复测）；Lighthouse ≥ 80 与 1000+ 提交虚拟滚动流畅度需浏览器环境实测。

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
