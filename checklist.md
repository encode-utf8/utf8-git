# 验收清单 · 任务：M1-9 在线状态处理（断网 / 超时 / 限流的提示与重试）

> 任务：断网、请求超时、GitHub 限流三类在线状态给出明确提示、可操作的重试入口与自动重试，且不用过期缓存冒充最新数据
> 分支：`feat/online-status-handling`
> 开始日期：2026-10-07
> 参照：`docs/roadmap.md` M1-9 · `docs/requirements.md` FR-5.1 / FR-5.2 / 场景表「断网」· `docs/todo.md` TODO-136

## 1. 任务目标

- 断网（网络不可达）、请求超时、GitHub 限流都要有明确文案与行动按钮（FR-5.1）。
- 断网 / 超时不再以「未知错误」或含糊的「异常（503）」呈现，也不落到未分类的 500。
- 命中限流时提示恢复时间；无缓存可降级时明确说明，不把过期缓存当作最新数据（FR-5.2）。
- 在线优先（D4 不支持离线模式）：前端给出全局离线横幅，离线时避免继续发起必然失败的请求。

## 2. 范围

- 包含：
  - 服务端：新增 `GitHubNetworkError`（503）与统一封装 `githubFetch`（超时中止 + 网络错误归一化）；REST 客户端（仓库列表 / 提交详情）此前无超时、网络异常直接冒泡 → 现在归一化；GraphQL 与令牌客户端的网络错误改用同一分类；三个 API 路由补齐 `github_unreachable`（503）/ `github_timeout`（504）；两个服务端页面新增「无法连接 GitHub / 请求超时」分支。
  - 前端：新增共享错误呈现模块 `error-state.ts`、带指数退避重试与在线检测的 `client-fetch.ts`、`useOnlineStatus` 钩子与全局离线横幅；仓库列表「加载更多」、时间线「加载更多 / 切换分支」、提交详情改用统一呈现 + 显式重试按钮 + 限流恢复时间。
  - 文档与测试同步。
- 不包含：离线模式（D4 明确不做）、Service Worker / IndexedDB、多实例分布式限流共享（随 M1-6）、写操作重试编排（M3 TODO-221）。

## 3. 验收项

- [x] 新增 `GitHubNetworkError`；`githubFetch` 把超时归类为 `GitHubTimeoutError`、把网络不可达归类为 `GitHubNetworkError`，并支持注入 `fetchImpl`
- [x] REST 客户端（`fetchViewerReposPage` / `fetchCommitDetail`）接入 `githubFetch`（默认超时），网络 / 超时异常可被上层识别
- [x] GraphQL 客户端网络错误由泛化的 502 改为 `GitHubNetworkError`（503），重试判定不变
- [x] 三个 API 路由把网络错误映射为 503 `github_unreachable`、超时映射为 504 `github_timeout`，判定顺序在通用 `GitHubApiError` 之前
- [x] `error-state.ts`：错误分类、用户文案（含限流恢复时间）、可重试判定、退避计算，纯函数，服务端与客户端共用
- [x] `client-fetch.ts`：瞬时错误（网络 / 超时 / 5xx）指数退避重试；401 / 403 / 404 / 409 / 429 不自动重试；离线短路不发起请求；支持外部 AbortSignal
- [x] 离线横幅：离线时全局提示「无法连接 GitHub」并提供重新加载入口；恢复在线后自动消失，SSR 快照稳定不引起 hydration 抖动
- [x] 仓库列表 / 时间线 / 提交详情：三类状态都有明确文案与「重试」按钮；限流展示恢复时间
- [x] 服务端页面：`/repos` 与 `/repos/{owner}/{name}` 对网络错误 / 超时给出明确提示与重试
- [x] 降级缓存仍明确标注「获取时间 + 恢复时间」，不伪装为最新数据
- [x] `pnpm lint / typecheck / test / build` 全绿
- [x] 文档同步（README / `docs/todo.md` 勾选 TODO-136 / `docs/development-log.md` ADR）与合并记录

## 4. 验证方式

- 单测：`error-state.test.ts`（分类 / 文案 / 可重试 / 退避）、`client-fetch.test.ts`（重试次数、不可重试状态、离线短路、中止、重试耗尽）、`github-fetch.test.ts`（超时 / 网络 / 透传 / 注入实现）；并更新既有网络错误断言。
- 端到端：真实会话访问 `/repos` 与时间线正常（不回归）；构造上游不可达 / 超时场景验证文案与重试入口。
- 手动：浏览器 DevTools 设 Offline → 横幅出现、「加载更多」给出断网提示；恢复在线 → 横幅消失。

## 5. 通过标准

- 断网 / 超时 / 限流三类状态均有明确文案与可操作的重试入口；不出现未分类的 500 或「异常（503）」这类含糊文案；降级缓存标注完整。

## 6. 风险与假设

- 本机 dev 需代理访问 github.com（`NODE_USE_ENV_PROXY`）；离线模拟在浏览器侧进行。
- 自动重试只覆盖瞬时错误，避免对限流 / 鉴权失败做无意义重试而浪费配额。
- 限流恢复时间依赖 GitHub 响应头（`x-ratelimit-reset` / `retry-after`），缺失时给出兜底时间。

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
- 2026-10-07 · 任务「M1-9 在线状态处理（断网 / 超时 / 限流）」· 分支 `feat/online-status-handling` · 结论：**开发完成，待用户确认**。
  - 证据：`pnpm lint / typecheck / test / build` 全绿；单测 131 例（本任务新增 26 例：错误分类 / 文案 / 退避 11、客户端重试 8、请求封装 6，含真实 socket 连接失败用例）。端到端（真实会话，临时会话 / 用户已删除）：正常路径 `/repos` 200、`/api/repos` 200；上游临时指向 `http://127.0.0.1:9` → `/api/repos` 503 `github_unreachable`、`/repos` 页显示「无法连接 GitHub」+ 重试；指向黑洞监听 `127.0.0.1:9931` → 15.25 s 后 504 `github_timeout`、`/repos` 页显示「请求超时」；验证后上游配置按字节还原。
  - 说明：客户端自动重试只覆盖瞬时错误（ADR-0031），限流 / 鉴权失败改为明文提示 + 手动重试；离线横幅依赖 `navigator.onLine`（ADR-0032 区分网络不可达与超时）；多实例下的缓存 / 限流 / 续期去重随 M1-6。
  - 待办：等待用户确认后提交 / 推送 / PR / 合并；合并结论将在完成后补记。
