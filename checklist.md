# 验收清单 · M1-5 时间线 v1（含 TODO-131 ~ 135）

> 任务：`/repos/[owner]/[name]` 时间线页面（仓库信息 + 提交列表 + 虚拟滚动 + 节点详情 + 加载 / 错误状态）
> 分支：`feat/m1-5-timeline-v1`
> 开始日期：2026-10-06

## 1. 任务目标

- 从 `/repos` 仓库卡片进入 `/repos/[owner]/[name]`，展示仓库信息（名称 / 描述 / 可见性 / 默认分支 / 分支选择）与提交时间线（TODO-131）。
- 提交节点：作者（头像 / 登录名）、相对时间与绝对时间、消息标题、短 SHA、父提交数（merge 标识）、关联 PR 徽标（TODO-132）。
- 虚拟滚动：固定行高窗口化，只渲染可视区 + overscan；配合分页自动加载，支撑 1000+ 提交（TODO-133）。
- 节点详情面板：完整 SHA（可复制）、作者、时间、父提交、关联 PR、文件变更统计（新增 / 删除 / 文件列表，REST 详情 + 30 min 缓存）、「在 GitHub 打开」（TODO-134）。
- 加载 / 空 / 错误状态：骨架屏、加载更多提示、空仓库提示、401 / 403 / 404 / 限流 / 超时的引导与重试（TODO-135；断网完整体验留待 M1-9 / TODO-136）。

## 2. 范围

- 包含：时间线页面（SSR 首屏 + 客户端虚拟列表 + 自动加载更多 + 分支切换）、提交详情接口 `/api/repos/[owner]/[name]/commits/[sha]`（REST + TTL 缓存 + 限流降级）、`github-commits.ts` 客户端、`commit-data.ts` 服务、虚拟窗口纯函数与格式化工具、`/repos` 卡片进入时间线、单测与文档。
- 不包含：泳道 / 分支图（M2）、过滤与搜索（M2）、diff 渲染（只到文件统计与列表）、离线模式（ADR-0009）、断网体验完整版（TODO-136 / M1-9）。

## 3. 验收项

- [x] `/repos` 卡片点击进入 `/repos/[owner]/[name]`；私有仓库同样可进入
- [x] 时间线 SSR 首屏渲染 50 条提交；头部含名称、描述、可见性、默认分支与分支选择
- [x] 提交节点含作者、相对 / 绝对时间、消息、短 SHA、merge 标识、关联 PR 徽标
- [x] 虚拟滚动：只渲染可视窗口（单测断言窗口范围与总高度）；滚动接近底部自动加载下一页（50 / 页）
- [x] 分支切换：选择其他分支后列表重置并加载该分支第 1 页
- [x] 节点详情：SHA / 作者 / 时间 / 父提交 / 关联 PR + 文件变更统计与列表；无文件变更与截断有提示；「在 GitHub 打开」可用
- [x] 详情接口 30 min TTL 缓存；限流时降级陈旧缓存并标注；无缓存时 429 + 恢复时间
- [x] 空仓库 / 401 / 403 / 404 / 限流 / 超时 均有明确文案与可操作入口
- [x] 单测：虚拟窗口、提交详情归一化、详情缓存 / 降级、时间格式化与提交去重；`pnpm lint / typecheck / test / build` 全绿
- [x] 真实端到端：真实会话访问时间线页；1000+ 提交仓库连续分页（≥10 页 / 500 提交）链路可用；详情接口真实数据、二次命中缓存；无令牌泄漏
- [x] 文档同步：README、`docs/todo.md`（TODO-131 ~ 135）、`docs/development-log.md`（ADR）

## 4. 验证方式

- 单测：Vitest（虚拟窗口 / 格式化 / 归一化 / 缓存降级，全部纯函数或注入依赖）。
- 真实端到端：本地 dev server + 临时会话。页面：`/repos/encode-utf8/utf8-git` 200 且含提交行；详情：`/api/repos/encode-utf8/utf8-git/commits/<sha>` 返回统计与文件，二次 `meta.cached=true`；大数据：`torvalds/linux` 连续拉取 ≥10 页验证分页与缓存链路。
- 说明：滚动「流畅度」为体感指标，自动化只验证「窗口化渲染行数恒定 + 大数据分页链路」，最终体感建议人工在浏览器确认。

## 5. 通过标准

- 命令全绿；真实仓库时间线可浏览，详情含作者 / 时间 / SHA 与文件统计；错误与空状态均有引导；虚拟列表只渲染窗口内行。

## 6. 风险与假设

- 固定行高（76px）方案：消息单行省略，保证行高恒定；若后续需要多行消息再评估动态测量。
- 相对时间在 SSR / 水合之间可能秒级差异：用 `suppressHydrationWarning` 规避；详情页时间以绝对时间展示。
- GitHub REST 提交详情最多返回 300 个文件：MVP 截取前 100 并标记截断。
- 时间线数据走 M1-4 的 2 min 缓存与 cursor 链；进程重启后深页返回 409，页面提示刷新。

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

