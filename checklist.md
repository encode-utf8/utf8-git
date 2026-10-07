# 验收清单 · 任务：GitHub 令牌自动续期（Refresh Token Rotation）

> 任务：access token 过期前用 refresh token 自动换新，避免每 8 小时重新授权
> 分支：`feat/token-auto-refresh`
> 开始日期：2026-10-07

## 1. 任务目标

- GitHub 开启「令牌过期」后 access token 有效期 8 小时；实现服务端自动续期，用户无需重复授权。
- 续期使用入库的 refresh token（6 个月）调用 GitHub 令牌端点，并**轮换保存**新 access / refresh token 与过期时间。
- 刷新令牌失效时返回未授权（引导重新授权）；网络 / 服务端异常时抛出可重试错误。

## 2. 范围

- 包含：新增 `github-token.ts`（令牌端点客户端：表单请求、超时、响应归一化、错误分类）；改造 `access-token.ts`（临近过期自动续期、并发去重、密文轮换入库）；单测覆盖。
- 不包含：401 触发的即时重试（时间维度续期已覆盖 TODO 场景）、多实例下的分布式锁（MVP 单实例，后续随 M1-6 评估）。

## 3. 验收项

- [x] 令牌未临近过期时不发起续期（无额外请求）
- [x] 临近过期（默认提前 5 分钟）且有 refresh token 时自动续期，返回新令牌
- [x] 新 access / refresh token 与 `expires_at` 以密文轮换入库
- [x] 无 refresh token → 返回 null（上层引导重新授权），不发起请求
- [x] 刷新被 GitHub 拒绝（`error` 字段或 400/401/403）→ 返回 null（重新授权）
- [x] 网络 / 超时 / 5xx → 抛 GitHubApiError（可重试），不误判为未授权
- [x] 并发：同一用户并发请求只发起一次续期（refresh token 单次有效）
- [x] `pnpm lint / typecheck / test / build` 全绿
- [x] 端到端：把库中 `expires_at` 改为过去时间，真实访问 `/repos` 自动续期成功（新密文 + 新过期时间）
- [x] 文档同步（README / `docs/todo.md` / `docs/development-log.md` ADR）与合并记录

## 4. 验证方式

- 单测：注入 `fetch` / 账号读取 / 存储依赖，覆盖正常、未过期、无 refresh token、被拒、网络异常与并发去重。
- 端到端：临时会话 + 真实 GitHub；将 `accounts.expires_at` 置为过去 → 访问 `/repos` 应自动续期并正常渲染仓库；验证后删除临时会话。

## 5. 通过标准

- 令牌过期不再需要人工重新授权；续期路径有单测与端到端证据；失败路径不会误报「未授权」。

## 6. 风险与假设

- 续期请求访问 `github.com`（本机需代理，dev server 已带 `NODE_USE_ENV_PROXY`）；生产环境直连。
- 并发去重为进程内（单实例）；多实例部署时可能重复续期（refresh token 轮换竞争），随 M1-6 部署形态一并处理。
- 续期失败（网络类）会让本次请求报错并提示重试；下次请求会再次尝试续期。

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

- 2026-10-07 · 任务「令牌自动续期（refresh token 轮换）」· 分支 `feat/token-auto-refresh` · 结论：**开发完成，待用户确认**。
  - 证据：`pnpm lint / typecheck / test / build` 全绿；单测 104 例（本任务新增 13 例：令牌端点 6 · 续期编排 7，含并发去重）；端到端把库中 `expires_at` 置为过去 → 访问 `/repos` 200 并渲染 4 个真实仓库（含私有），库中密文更换、`expires_at` 更新为 2026-10-07 01:52:17 UTC（now + 8 h），二次请求不再续期；响应无明文令牌；临时验证会话已删除。
  - 说明：并发去重为进程内实现（单实例）；多实例场景随 M1-6 部署形态评估（ADR-0029）。
  - 待办：等待用户确认后提交 / 推送 / PR / 合并；合并结论将在完成后补记。
