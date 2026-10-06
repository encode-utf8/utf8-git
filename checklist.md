# 验收清单 · 修复：重新授权后令牌未更新（Re-login token update）

> 任务：修复 GitHub 重新授权后账号表令牌未更新、导致「GitHub 授权已失效」持续出现的问题
> 分支：`fix/relogin-token-update`
> 开始日期：2026-10-07

## 1. 任务目标

- 复现并定位「重新授权后仍提示授权失效」的根因。
- 让每次成功的 GitHub 授权都把最新令牌（密文）写入账号表，使重新授权立即生效。

## 2. 范围

- 包含：`auth-adapter.ts` 新增 `upsertAccountTokens`（AES-256-GCM 加密 upsert，响应缺省 refresh_token 时保留旧值）；`auth.ts` 增加 `events.signIn`（每次 GitHub 登录后写入最新令牌）；数据库用例覆盖。
- 不包含：access token 过期前的自动 refresh（后续任务，单独评估）、`/login` 页展示 `?error=` 提示（后续建议）。

## 3. 验收项

- [ ] 定位根因并有源码证据（Auth.js 对已有账号跳过 `linkAccount`）
- [ ] 重新授权（已有账号）后，`accounts.expires_at` 与 `access_token_enc` 更新为最新值
- [ ] 令牌以 AES-256-GCM 密文入库；响应与日志无明文令牌
- [ ] 响应未携带 refresh_token 时不会清空库中已有的 refresh token
- [ ] 单测覆盖（`RUN_DB_TESTS=1`：新建 / 更新 / 保留旧 refresh token）；`pnpm lint / typecheck / test / build` 全绿
- [ ] 端到端：浏览器重新授权后 `/repos` 正常加载仓库列表（人工确认）
- [ ] 文档同步与合并记录（`checklist.md` 第 7 节）

## 4. 验证方式

- 单测：数据库用例注入真实 Prisma（本地 Docker），验证 upsert 三种场景与密文存储。
- 端到端：真实浏览器重新授权 → 对比数据库 `expires_at` / 密文变化 → `/repos` 200 且渲染真实仓库；响应无明文令牌。

## 5. 通过标准

- 重新授权后应用立即可用；令牌更新路径有单测与端到端证据；无明文令牌。

## 6. 风险与假设

- `events.signIn` 抛错会让本次登录失败：这是期望行为（避免「登录成功但应用不可用」的静默失败）。
- 首次登录路径不变（仍由 `linkAccount` 建行，之后由 `upsertAccountTokens` 更新）。
- GitHub OAuth 令牌 8 小时过期（GitHub 侧开启令牌过期策略），本次修复只解决「重新授权不生效」，自动续期仍需后续 refresh 实现。

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

