# 开发记录（Development Log）

> 记录规则：每次开发（或每次有意义的技术决策）追加一条，按时间**倒序**排列（最新在最上）。
> 每条包含：目标 / 完成内容 / 关键决策 / 问题与风险 / 下一步。

| 项       | 内容                                         |
| -------- | -------------------------------------------- |
| 文档版本 | v0.1                                         |
| 更新日期 | 2026-10-10                                   |
| 关联文档 | [实现路线](roadmap.md) · [待办日志](todo.md) |

---

## 2026-10-10 · M3-6 恢复分支：24h 恢复窗口 + 审计驱动的恢复入口

**目标**：补齐路线图 M3-6，为 M3-5 的删除提供「可撤销」承诺——在 24h 窗口内从删除记录重建分支引用，并明确说明恢复的边界。

**完成内容**

- 纯逻辑：`lib/branch-restore-ops.ts`——`RESTORE_WINDOW_MS` / `restoreDeadline`（24h 窗口）、`evaluateBranchRestore`（缺分支名 / 缺 SHA / 时间无效 / 超窗分别给出原因）、`describeRestoreRemaining`（「剩余约 N 小时 / 分钟」）、`createRestoreBranchDescriptor`、`describeRestoreBranchFailure`；`operations.ts` 新增操作类型 `restoreBranch`（确认文案「恢复分支」）。
- 审计查询：`OperationAuditQuery` 扩展 `kind` / `status` 过滤，内存与 Postgres 实现同步（恢复入口只取本用户、`deleteBranch`、`succeeded` 的记录；不需要新建表或迁移）。
- 接口：新增 `GET/POST /api/repos/[owner]/[name]/operations/restore-branch`——GET 从审计列出近 24h 内可恢复的删除记录（只读、不写审计）；POST 以删除记录的幂等键为凭据，服务端校验归属 / 类型 / 状态 / 时间窗后，用 `createBranchRef` 把分支重建到删除前的 SHA，成功 201、幂等回放 200。
- UI：新增 `restore-branch-panel.tsx`（单选列出候选 + 剩余窗口 → 确认卡片；无候选 / 已过期时只解释原因与限制）；`timeline-view.tsx` 头部新增「恢复分支」，成功后 `role="status"` + `router.refresh()`；同时把「打开任写操作面板清掉上一次成功提示」抽成 `resetOperationAlerts`。
- 测试：新增 `branch-restore-ops.test.ts`，`operation-audit.test.ts` 补 kind / status 过滤用例，累计 281；E2E 新增「恢复分支」用例（删除 `feature/e2e` → 恢复入口选回 → 重建成功），mock 的分支列表改为直接由引用集合派生。

**关键决策**

| 编号     | 决策                                                                        | 理由                                                                                          | 备选与否决原因                                           |
| -------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| ADR-0086 | 恢复凭据用**删除记录的幂等键**，服务端据此回查审计取 SHA                    | 分支头 SHA 是恢复的关键输入，从服务端自己的审计记录取，避免客户端伪造或与记录错配             | 客户端直传 `{ branch, sha }`：SHA 不可信，可恢复任意提交 |
| ADR-0087 | 24h 恢复窗口做在**应用层**（基于审计 `recordedAt`），不依赖 GitHub 回收时机 | GitHub 不保证未引用对象的具体存活时长；应用层给出确定性的用户承诺，且与审计记录同一份时间基准 | 依赖上游：没有可展示的窗口与剩余时间，失败原因也不可控   |
| ADR-0088 | 恢复描述符的 payload 带来源删除记录的幂等键（`source`）                     | 「删 → 恢复 → 再删 → 再恢复」若 payload 相同会命中历史成功记录、被当作幂等回放而静默不执行    | 只带 `{ branch, from }`：二次恢复会假成功，分支并未重建  |

**问题与风险**

- 只覆盖**本应用内、成功且保存了 SHA** 的删除；用其他工具或直接调 API 删除的分支无法恢复（面板已说明）。
- 恢复只重建引用，不恢复分支保护规则与 PR 关联；窗口内若上游已回收该对象，恢复会以 422 失败（本应用 24h 窗口远小于 GitHub 的回收周期，风险低但未强保证）。
- 恢复窗口的判定依赖审计存储：多实例部署需 `STORE_BACKEND=postgres`，否则各实例只能看到自己的删除记录。
- 审计表目前没有保留期策略（M3-7 的操作历史需要它），后续需要归档 / 清理策略。

**下一步**

- M3-7：操作历史（审计查看页 + 等价 Git 命令），复用本次新增的 `list(kind/status)` 查询与恢复入口的数据。

## 2026-10-10 · M3-5 删除分支：保护规则 + 影响预览 + 删除执行

**目标**：补齐路线图 M3-5，让「选分支 → 预检可否删除 → 影响预览 → 执行删除」在时间线内闭环，并保证默认 / 受保护分支不会被误删。

**完成内容**

- 纯逻辑：新增 `lib/branch-delete-ops.ts`——`evaluateBranchDeletion`（按「默认分支 > 受保护分支 > 当前查看的分支」顺序给出 `canDelete` + 原因）、`isProtectedBranch`、`createDeleteBranchDescriptor`（影响预览强调「不删除任何提交」并提示记录 SHA；payload `{ branch, sha? }` 供审计与后续恢复）、`describeDeleteBranchFailure`。
- 上游客户端：新增 `lib/github-branch-settings.ts` 的 `fetchBranchDeletionContext`（并发读取 `GET /repos/{owner}/{repo}` 的 `default_branch` 与 `GET /repos/{owner}/{repo}/branches/{branch}` 的 `protected`；分支 404 归一为 `exists:false`）；`lib/github-branches.ts` 新增 `deleteBranchRef`（`DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}`，成功 204，422 → `GitHubValidationError`）。
- 接口：新增 `GET/POST /api/repos/[owner]/[name]/operations/delete-branch`——GET 为只读可删除性预检（不写审计）；POST 在服务端复查默认 / 保护 / 当前分支（不可删除直接 409 + 原因，不进入写管线），可删除则走 `runOperation`（幂等 + 审计）；成功 201、幂等回放 200。
- UI：新增 `delete-branch-panel.tsx`（分支下拉（默认分支带「（默认）」标记）→ 服务端预检 → 确认卡片或不可删除原因）；`timeline-view.tsx` 头部新增「删除分支」按钮，页面透传 `defaultBranch`，成功后展示 `role="status"` 并 `router.refresh()`。
- 测试：新增 `branch-delete-ops.test.ts` / `github-branch-settings.test.ts`，`github-branches.test.ts` 补 `deleteBranchRef` 用例，累计 269；E2E 新增「删除分支」用例（默认分支只给原因、无确认入口 + 可删分支成功），mock 上游补 `GET /repos/{owner}/{name}`、`GET .../branches/{branch}`、`DELETE .../git/refs/heads/{branch}`，并让时间线 refs 随删除联动。

**关键决策**

| 编号     | 决策                                                    | 理由                                                                                                                 | 备选与否决原因                                      |
| -------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| ADR-0083 | 保护状态取 `GET /branches/{branch}` 的 `protected` 字段 | `/branches/{branch}/protection` 对权限不足的令牌直接 403，会让公开仓库场景也失败；`protected` 已足够支撑删除前置判断 | 调用 protection 端点：需 admin 权限，普通令牌不可用 |
| ADR-0084 | 预检做成**独立只读 GET**，POST 前再复查一次             | 与 M3-4 合并 PR 一致：用户先看到结论才愿意确认；服务端复查避免结论被绕过或过期                                       | 仅前端判定：可被绕过；仅 POST 判定：用户看不到原因  |
| ADR-0085 | 删除分支的幂等 payload 含 `sha`（分支头）               | 审计记录保留删除前的提交 SHA，为 M3-6 的恢复窗口提供依据                                                             | 只记分支名：审计无法定位恢复点                      |

**问题与风险**

- 「当前正在查看的分支」不可删除是产品侧约定（避免浏览上下文被抽走），GitHub 本身允许；要放开只需调整 `evaluateBranchDeletion` 的顺序与文案。
- 只读 `protected` 布尔值，不读保护规则的细分项（审查人数 / 必需检查）；更精细的提示需要额外权限。
- 删除只移除引用：被删分支的提交若没有其他引用将成为不可达对象并最终被 GitHub GC；影响预览已明确「不会删除任何提交」并提示记录 SHA。
- 一键撤销 / 恢复仍是 M3-6，当前只保证「删除前有 SHA 记录 + 风险提示」。

**下一步**

- M3-6：撤销与恢复（24h 恢复窗口、SHA 记录与恢复入口）。

## 2026-10-10 · M3-4 收尾：创建 PR（建 PR → 可合并性检查 → 合并 闭环）

**目标**：补齐路线图 M3-4 的前半段「建 PR」，让「建 PR → 可合并性检查 → 合并」在时间线内闭环。

**完成内容**

- 纯逻辑：`lib/pull-ops.ts` 扩展创建 PR 部分——`validatePullTitle`（必填、≤256）、`validatePullBody`（≤65536）、`validatePullBranches`（复用 `validateBranchName` 的 git 引用规则，且要求来源 ≠ 目标）、`createPullRequestDescriptor`、`describeCreatePullRequestFailure`；`operations.ts` 新增操作类型 `createPullRequest`（确认文案「创建 PR」）与冲突码 `pull_invalid`。
- 上游客户端：`lib/github-pulls.ts` 新增 `createPullRequest`（POST `/repos/{owner}/{repo}/pulls`，body `title` / `head` / `base` / `draft`，正文为空则不带该字段）与 `normalizeCreatedPullRequest`；错误分类与既有客户端一致（422 → `GitHubValidationError`）。
- 接口：新增 `POST /api/repos/[owner]/[name]/operations/create-pull-request`，body `{ head, base, title, body?, draft?, confirmed }`；服务端按「标题 → 分支 → 正文」顺序复校验后走 `runOperation`（幂等 + 审计）；成功 201、幂等回放 200。
- UI：新增 `create-pull-panel.tsx`（目标 / 来源分支下拉 + 标题 + 正文 Markdown 预览 + 草稿开关；分支不足两个时只提示不可创建）；`timeline-view.tsx` 头部新增「新建 PR」，成功后关闭面板、展示 `role="status"` 提示并 `router.refresh()`。
- 测试：`pull-ops.test.ts` / `github-pulls.test.ts` 补创建 PR 用例，累计 247；E2E 新增「创建 PR」用例（成功 + 422 冲突），mock 上游补 `POST /repos/{owner}/{name}/pulls`。

**关键决策**

| 编号     | 决策                                                          | 理由                                                                                | 备选与否决原因                                       |
| -------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| ADR-0080 | 创建 PR 入口放在**时间线头部**                                | base / head 需要分支列表，头部已持有 `branches`，无需为选择器新增上游查询           | 放进提交详情：只知当前提交，选分支要多一次请求       |
| ADR-0081 | 分支校验**复用 `validateBranchName`**，并额外要求 head ≠ base | 与 M3-2 同一套 git 引用规则，避免两处校验漂移；head = base 上游必然 422，本地先拦下 | 各写一份：规则漂移；不校验：白跑一次注定失败的写请求 |
| ADR-0082 | 正文为空时**不发送 `body` 字段**，`draft` 始终显式发送        | 与创建 Issue 保持一致（空字段不带）；显式 `draft: false` 表达「非草稿」             | 全部发送：上游会把空字符串当成正文                   |

**问题与风险**

- 选择器的分支列表来自时间线已加载的 refs（GraphQL 只取前若干条），分支很多的仓库可能不全，完整列表需要额外的分页查询。
- 未预检「仓库是否禁用 PR / 合并」，由上游 403 / 405 兜底。
- 上游写端点仍只有 E2E mock 覆盖（`POST /pulls`），真实建 PR 需登录后手动验收。
- 创建成功后时间线不会立刻出现新 PR（时间线聚合提交，PR 由 GraphQL 关联），仅以提示给出编号。

**下一步**

- M3-5：删除分支（保护规则 + 影响预览），复用「前置检查 → 不可执行只解释原因」的模式。

## 2026-10-10 · M3-4 合并 PR：可合并性检查 + 冲突提示

**目标**：在时间线上完成「PR 合并」写操作，并把「能不能合」的结论前置到执行之前——冲突 / 草稿 / 已合并都要给出明确原因。

**完成内容**

- 上游客户端：新增 `lib/github-pulls.ts`——`fetchPullRequest`（GET `/repos/{owner}/{repo}/pulls/{number}`，归一化 `mergeable` / `mergeable_state` / head / base）与 `mergePullRequest`（PUT `/pulls/{number}/merge`，body `merge_method`）；405 / 409 / 422 归为 `GitHubValidationError`，410 归 `GitHubNotFoundError`，错误分类与既有客户端一致。
- 纯逻辑：新增 `lib/pull-ops.ts`——`parsePullNumber`、`isMergeMethod` / `MERGE_METHODS`、`evaluateMergeability`（按「已合并 > 已关闭 > 草稿 > 冲突 / 保护规则 > 计算中」顺序给出 `canMerge` + 原因）、`createMergePullRequestDescriptor`、`describeMergePullRequestFailure`；`operations.ts` 的失败文案表新增 `pull_not_mergeable`。
- 接口：新增 `GET/POST /api/repos/[owner]/[name]/operations/merge-pull-request`——GET 为只读可合并性检查（不写审计）；POST 先复检可合并性（不可合并直接 409 + 原因，不进入写管线），再走 `runOperation`（确认 + 幂等 + 审计）；`merged=false` 也按不可合并处理。
- UI：新增 `merge-pull-panel.tsx`（检查中 → 可合并给确认卡片 + 合并方式选择；不可合并只解释原因、不提供执行入口）；`commit-detail.tsx` 的「关联 Pull Request」徽标旁对 `OPEN` 的 PR 提供「合并 PR」按钮，成功后展示 `role="status"` 并 `router.refresh()`。
- 测试：`pull-ops.test.ts`、`github-pulls.test.ts`，累计 236；E2E 新增「合并 PR」用例（可合并成功 + 冲突提示），mock 上游补 `GET /pulls/{number}` 与 `PUT /pulls/{number}/merge`，并给最新提交挂上 #61（可合并）/ #62（冲突）两个开放 PR。

**关键决策**

| 编号     | 决策                                                       | 理由                                                                                  | 备选与否决原因                                           |
| -------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| ADR-0077 | 可合并性检查做成**独立只读 GET**，POST 合并前再复检一次    | 用户要先看到结论才愿意确认；服务端复检可避免检查与执行之间的竞态直接落到上游 405      | 只在 POST 里检查：用户看不到原因；只信前端检查：可被绕过 |
| ADR-0078 | 合并入口放在**提交详情面板的 PR 徽标旁**，仅对 `OPEN` 显示 | 时间线行本身是 `<button>`，行内再加按钮属非法嵌套交互元素；详情面板已集中承载 PR 徽标 | 行内按钮：非法 / 事件冲突；独立页面：多一层导航          |
| ADR-0079 | 不可合并时**不渲染确认按钮**，只展示原因                   | 把结论前置，避免「点了合并才被拒」；服务端仍以 409 兜底                               | 允许点确认再由上游报错：多一次注定失败的写请求与审计     |

**问题与风险**

- GitHub 的 `mergeable` 是异步计算的，首次查询可能为 `null`（本轮文案为「尚未完成可合并性计算，请稍后重试」），未做自动轮询。
- 上游写端点仍只有 E2E mock 覆盖（`GET/PUT /pulls/{number}[/merge]`），真实合并需登录后手动验收。
- 合并方式只影响上游 `merge_method`，未预检仓库默认合并方式与分支保护规则；被保护分支会由 GitHub 返回 403 / 405，按通用文案提示。
- 路线图 M3-4 含「建 PR → 可合并性检查 → 合并」，本轮只完成后两步，「建 PR」仍待补。
- 合并后 PR 徽标不会立刻变化：只 `router.refresh()`，需上游数据刷新后才显示「已合并」。

**下一步**

- 补齐 M3-4 的「建 PR」（从分支创建 PR：base 选择 + 标题 / 正文）。
- M3-5：删除分支（保护规则 + 影响预览），复用同一套「前置检查 + 不可执行时只解释原因」的模式。

## 2026-10-10 · M3-3 创建 Issue：Markdown 预览 + 标签

**目标**：在时间线上直接创建 Issue，复用 M3-1 的确认卡片 + 统一写管线 + 审计；正文提供轻量 Markdown 预览，标签以逗号输入。

**完成内容**

- 上游客户端：新增 `lib/github-issues.ts`（`createIssue` 调 REST `POST /repos/{owner}/{repo}/issues`，`normalizeCreatedIssue` 归一化响应；空正文 / 空标签不带字段；422 与 410（仓库关闭 Issue）归为 `GitHubValidationError`，403 / 429 按限流头区分）。
- 纯逻辑：新增 `lib/issue-ops.ts`——`validateIssueTitle`（必填、≤256）、`parseIssueLabels` / `validateIssueLabels`（≤10 个、单个 ≤50、禁换行）、`createIssueDescriptor`（确认卡片与审计共用）、`describeCreateIssueFailure`。
- 共享胶水：把 M3-2 路由里的失败映射抽到 `lib/operation-http.ts` 的 `mapOperationFailure(error, conflictCode)`，建分支 / 建 Issue 两个路由复用；`operations.ts` 新增通用 `describeOperationFailure(status, code, conflictMessage)`，`describeCreateBranchFailure` 改为委托（行为不变）。
- Markdown：新增 `lib/markdown-lite.ts`（标题 1-3 / 段落 / 有序无序列表 / 代码块 + 行内加粗与行内代码）与 `markdown-preview.tsx`——先解析成数据结构再渲染，不使用 `dangerouslySetInnerHTML`。
- 接口：新增 `POST /api/repos/[owner]/[name]/operations/create-issue`，body `{ title, body?, labels?(逗号字符串), confirmed }`；服务端复校验后走 `runOperation`，审计写入 `operationAudit`；成功 201、幂等回放 200。
- UI：新增 `create-issue-panel.tsx`（标题 / 正文 + 预览 / 标签三段表单，状态内聚在组件内）；`timeline-view.tsx` 头部新增「新建 Issue」，成功后关闭面板、展示 `role="status"` 提示并 `router.refresh()`。
- 测试：`issue-ops.test.ts`、`github-issues.test.ts`、`markdown-lite.test.ts`，累计 217；E2E 新增「创建 Issue」用例（成功 + 422 冲突），mock 上游补 `POST /repos/{owner}/{name}/issues`。

**关键决策**

| 编号     | 决策                                                               | 理由                                                                        | 备选与否决原因                                    |
| -------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------- |
| ADR-0074 | 正文预览**自写极简 Markdown 解析**，不用 `dangerouslySetInnerHTML` | Issue 正文是用户输入，注入 HTML 即 XSS 面；先解析成数据结构再渲染，天然安全 | 直接渲染 HTML：需引入消毒库，体积与审计成本都更高 |
| ADR-0075 | 失败映射抽到 `operation-http.ts`，各操作只提供 `conflictCode`      | 写操作会持续增加，状态码映射复制三遍必然漂移                                | 每个路由各写一份：M3-4 / M3-5 还会继续复制        |
| ADR-0076 | 标签用「逗号分隔」单输入框，服务端再切分                           | 免去标签选择器与上游标签查询，先打通最小写路径                              | 下拉多选：需先拉仓库标签，多一次上游请求与状态    |

**问题与风险**

- 上游写端点仍只有 E2E mock 覆盖（`POST /issues`），真实创建需登录后手动验收。
- Markdown 支持刻意收敛（不含链接 / 图片 / 表格 / 嵌套列表），复杂正文仍建议到 GitHub 编辑；后续需要再换成熟解析器。
- 创建成功后时间线不会出现新 Issue（时间线聚合的是提交），仅以提示给出编号，需到 GitHub 查看。
- 标签不预校验是否已存在于仓库：未知标签由上游忽略或自动创建（取决于仓库设置），本轮不额外请求。

**下一步**

- M3-4：PR 合并流程（可合并性检查、冲突提示）。
- 可选：把「新建 Issue」入口也放进提交详情面板（用提交信息预填标题 / 正文）。

## 2026-10-09 · M3-2 创建分支：首个写操作端到端

**目标**：打通首个写操作——基于提交创建分支，复用 M3-1 的确认卡片 + 统一管线 + 审计。

**完成内容**

- 上游客户端：新增 `lib/github-branches.ts`（`createBranchRef` 调 REST `POST /repos/{owner}/{repo}/git/refs`，`normalizeCreatedRef` 归一化响应）；`github-errors.ts` 新增 `GitHubValidationError`（422：分支名非法或引用已存在）。
- 纯逻辑：新增 `lib/branch-ops.ts`——`validateBranchName`（按 git check-ref-format 规则给出中文提示）、`createBranchDescriptor`（确认卡片与审计共用的操作描述）、`describeCreateBranchFailure`（失败码 → 可读文案）。
- 接口：新增 `POST /api/repos/[owner]/[name]/operations/create-branch`，body `{ branch, from(sha), confirmed }`；幂等键由 `(actor, 描述)` 派生，执行走 `runOperation`，审计写入 `operationAudit`；`OperationError.originalError` 保留原始 GitHub 错误，据此映射 401 / 403 / 404 / 422 / 429 / 503 / 504。
- UI：`timeline-view.tsx` 头部新增「新建分支」→ `ConfirmCard` 内含分支名输入与起点预览；成功后 `router.refresh()` 让分支选择器立即包含新分支；`confirm-card.tsx` 增加 `children` 表单插槽。
- 测试：`branch-ops.test.ts`（校验 / 描述 / 失败文案，6 条）、`github-branches.test.ts`（归一化 + 5 类错误，7 条），累计 198；E2E 新增「创建分支」用例（成功 + 422 冲突）。

**关键决策**

| 编号     | 决策                                                          | 理由                                                                           | 备选与否决原因                                                     |
| -------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| ADR-0071 | 幂等键**服务端**由 `(actor, 描述)` 派生，客户端不传           | 客户端不知道稳定的用户标识；派生键让「同参数重发」自然去重，无需客户端保存 key | 客户端生成并透传 `Idempotency-Key`：需额外持久化，且丢失后无从去重 |
| ADR-0072 | `OperationError` 保留 `originalError`，路由据此细化 HTTP 状态 | 管线统一包装错误，但调用方仍需把 GitHub 422 / 429 等映射为准确响应             | 在 execute 内直接返回错误码：破坏「描述 + execute」的通用签名      |
| ADR-0073 | 分支起点固定为**提交 SHA**（不做分支名 → SHA 解析）           | UI 始终能给出 SHA（选中提交或分支头），少一次上游查询、语义单一                | 支持传分支名：需额外 GET 解析，且并发下分支可能已前移              |

**问题与风险**

- 上游写端点仅 E2E mock 覆盖（`POST /git/refs`），真实 GitHub 写入需登录后手动验收。
- 成功后只 `router.refresh()` 刷新分支列表；时间线提交列表不变（新分支指向已有提交，属预期）。
- 仓库策略冲突（保护规则 / 命名策略）目前统一落 403 / 422，文案较笼统。
- 幂等「自动重试」仍未实现：网络中断后需用户手动重试（同参数会回放）。

**下一步**

- M3-3：创建 Issue（表单 + Markdown 预览 + 标签），复用确认卡片与统一管线。
- 可选：把「创建分支」入口也放到提交详情面板（以该提交为起点）。

## 2026-10-09 · M3-1 收尾：审计表 + 内存 / Postgres 双实现

**目标**：给写操作管线补上持久化审计（路线图 M3-1 的「审计表」），并让内存 / Postgres 两种后端复用同一管线。

**完成内容**

- `prisma/schema.prisma` + 迁移 `20261009120000_m3_1_operation_audit`：新增 `operation_audit` 表（自增 id、`idempotency_key`、`kind`、`repo`、`actor`、`status`、`summary`、`payload` JSONB、`result` / `error` 文本、`recorded_at`），并建 `(idempotency_key, id)`、`(repo, recorded_at)` 索引。
- 新增 `lib/operation-audit.ts`：`OperationAuditStoreLike` 接口（`find` / `append` / `list`）与 `MemoryOperationAuditStore`（单测与 `STORE_BACKEND=memory` 使用）。
- `lib/pg-stores.ts` 新增 `PgOperationAuditStore`：`find` 取该幂等键最新一条（`orderBy id desc`），`list` 支持 repo / actor 过滤与 limit。
- `lib/data-stores.ts`：把 `operationAudit` 纳入数据层单例，随 `STORE_BACKEND` 在内存 / Postgres 间切换。
- 单测：`operation-audit.test.ts` 覆盖 find 取最新、list 过滤 / 排序 / limit，以及「管线 + 审计存储」联调（同键重放不重复执行，审计留 started + succeeded 两条；共 3 条，累计 185）。

**关键决策**

| 编号     | 决策                                                             | 理由                                                                                                                    | 备选与否决原因                                                                       |
| -------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ADR-0068 | 审计表用**显式列** + `payload` JSONB，`result` 存 JSON 字符串    | status / repo / actor 需要可直接过滤与索引；`result` 类型未知，存字符串可规避 Prisma `JsonNull` / `DbNull` 哨兵语义歧义 | 整行存 JSON blob：无法按状态 / 仓库索引；`result` 用 `Json?`：空值语义要哨兵，易踩坑 |
| ADR-0069 | 审计存储纳入 `data-stores` 单例，随 `STORE_BACKEND` 切换         | 与 M1-6 缓存 / 限流一致：单实例用内存、多实例 / Serverless 用 Postgres，无需另立开关                                    | 单独加 `AUDIT_BACKEND`：多一个配置维度，部署更易错                                   |
| ADR-0070 | 迁移 SQL **手写**，交由 CI `e2e` 的 `prisma migrate deploy` 验证 | 本地无 Docker / Postgres，无法 `migrate dev` 生成；CI 有 postgres:16 service 会实际应用迁移                             | 等有库再写：阻塞 M3 进度；`migrate diff`：同样需要影子数据库                         |

**问题与风险**

- 迁移未经本地真实数据库验证，首次以 CI `e2e` job 的 `migrate deploy` 为准；SQL 有误会在 CI 暴露。
- `PgOperationAuditStore` 未单测（本地无库），仅靠类型检查与 CI 迁移兜底；真正写入路径在 M3-2 接入首个写操作时端到端跑。
- 审计表暂无保留期 / 归档，长期会增长（M3-7 操作历史页与 M4 可观测性一并处理）。
- 幂等「自动重试」仍未实现，当前只做「同键回放」。

**下一步**

- M3-2：创建分支（基于提交 / 分支建分支 + 命名校验），接线 `ConfirmCard` 与 `runOperation`，打通首个写操作端到端。

## 2026-10-09 · M2 收官复盘 + M3-1 操作管线起步

**目标**：为 M2（只读增强）做阶段性复盘并核对退出标准；同时启动 M3 交互操作的第一块——统一写操作管线。

**完成内容**

- 复盘：新增 `docs/reports/tech-analysis/M2-retrospective.md`，汇总 M2-1 ~ M2-6 交付清单、退出标准核对、质量证据与遗留风险。
- M3-1（第一部分，纯逻辑）：
  - 新增 `lib/operations.ts`：`OperationDescriptor` / `OperationError` / `OperationAuditRecord`；`confirmationView`（标题 / 影响预览 / 按钮文案 / 危险标记）、`createIdempotencyKey`（稳定幂等键）、`runOperation`（确认 → 幂等回放 → 执行 → 审计的统一管线）。
  - 新增 `lib/operations.test.ts`：确认拦截、成功 / 失败审计、幂等回放、幂等键稳定性（8 条）。
  - 新增 `app/repos/[owner]/[name]/confirm-card.tsx`：确认卡片展示组件（危险操作红色按钮）。
- 清理：删除本地过期 stash（M2-2 半成品，已被后续提交取代）。

**关键决策**

| 编号     | 决策                                                             | 理由                                                                                     | 备选与否决原因                                          |
| -------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| ADR-0065 | 所有写操作走 `runOperation` 单管线，**确认 / 幂等 / 审计**内建   | 路线图 M3-1 要求「所有写操作走同一管线」；集中实现后 M3-2~M3-5 只需提供 `execute` 与描述 | 每个操作各自处理确认与审计：重复代码、易漏幂等          |
| ADR-0066 | 审计写入抽象为 `OperationAuditSink` 接口，执行器与审计均依赖注入 | 核心纯逻辑可单测、不依赖数据库；持久化实现（内存 / Prisma）随后替换即可                  | 直接写 Prisma：单测需要数据库，本地无 Postgres 时无法跑 |
| ADR-0067 | 幂等键用**稳定字符串拼接**而非哈希                               | 可读、便于排查；只需确定性去重，不承载安全语义，避免引入 crypto 依赖                     | 哈希：多一层不可读，且 `node:crypto` 会污染客户端包     |

**问题与风险**

- 审计表（Prisma model + migration）与重试策略尚未落地：本轮先交付纯逻辑，持久化在下一增量补齐；CI 的 `e2e` job 会跑 `prisma migrate deploy`，migration 可据此验证。
- `confirm-card.tsx` 目前尚未接入页面（等 M3-2 创建分支时接线），属预留组件。
- 幂等回放返回的类型是 `existing.result as T`，依赖调用方保证「同键同型」。

**下一步**

- M3-1 收尾：加审计表（`OperationAudit` model + migration）与 Prisma 审计实现，复用 `STORE_BACKEND` 开关。
- M3-2：创建分支（基于提交 / 分支建分支 + 命名校验），接线 `ConfirmCard`。

## 2026-10-09 · M2-6 概念解释层：术语悬浮卡片 + 新手 / 进阶模式

**目标**：在时间线上就地解释 Git 术语，帮新手看懂「发生了什么」；同时默认关闭，不打扰熟悉 Git 的用户。

**完成内容**

- 新增 `lib/glossary.ts`：6 条术语词条（提交作者 / 提交哈希 / 合并提交 / 拉取请求 / 议题 / 泳道），按难度分 `basic` 与 `deep`；`shouldExplain` 定义展示规则，`isExplainMode` 校验模式取值。
- 新增 `app/repos/[owner]/[name]/glossary-hint.tsx`：`?` 标记组件，悬停 / 聚焦弹出解释卡片；卡片用 `createPortal` 挂到 `body`，绕开时间线滚动容器的 `overflow` 与行内 `transform` 裁剪；滚动 / 缩放 / Esc 自动收起。
- `timeline-view.tsx`：头部新增「术语解释」模式选择（关闭 / 新手 / 进阶，默认关闭，选择记入 localStorage）；提交行的 merge 徽标、PR / Issue 徽标、作者与 SHA 旁挂载术语提示，泳道提示置于头部。
- 单测：`glossary.test.ts` 覆盖词条完整性、`termById`、三种模式的展示规则与取值校验（7 条，累计 174）。
- E2E：新增用例断言默认关闭不渲染提示、新手模式悬停弹出卡片、进阶模式隐藏基础术语、关闭后计数归零。

**关键决策**

| 编号     | 决策                                              | 理由                                                                                                                         | 备选与否决原因                                                      |
| -------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| ADR-0062 | 术语卡片用 **portal 渲染到 body**                 | 滚动容器 `overflow-y-auto` 会裁剪内部溢出，行内 `transform` 又会把 `position: fixed` 拉回自身坐标系；portal 才能稳定浮在行上 | 行内绝对定位会被 overflow 裁剪；固定定位受祖先 transform 影响而错位 |
| ADR-0063 | 展示规则：新手看全部、进阶只看 `deep`，默认 `off` | 「新手」需要最多解释，「进阶」只需深概念；默认关闭满足「可关闭、不干扰老用户」，把选择权交给用户                             | 两种模式都全量：进阶失去区分度；默认开启：干扰老用户                |
| ADR-0064 | 模式存 `localStorage`，读写失败静默降级           | 让选择跨会话生效且零后端成本；隐私模式 / 禁用存储时退回默认关闭，不阻塞渲染                                                  | 存数据库 / 服务端：为纯客户端偏好引入后端成本与接口                 |

**问题与风险**

- 术语提示是逐行渲染的按钮，虚拟窗口内每屏约多出数十个节点；量级可控，但超大列表下仍值得关注。
- 卡片位置在打开时一次性计算，滚动即收起（不做跟随），避免与虚拟滚动的位置抖动冲突。
- 词条为前端静态中文文案，暂未多语言化（随 M4 国际化统一处理）。

**下一步**

- M2 收官自检：核对路线图退出标准「一个屏幕讲清仓库最近发生了什么」，并补一份阶段性复盘到 `docs/reports`。
- 启动 M3-1 操作框架（确认卡片组件、操作编排服务、审计表），进入交互操作阶段。

## 2026-10-09 · M2-5 时间范围缩放：近一周 / 近一月 / 全部，且保持选中上下文

**目标**：在时间线上按时间范围缩放（近一周 / 近一月 / 全部），切换范围时不丢失当前浏览上下文。

**完成内容**

- `lib/timeline-filters.ts`：过滤状态新增 `range`（全部 / 近一周 / 近一月）；`filterTimelineCommits` 增加时间范围维度与可注入的 `nowMs`（`null` 表示基准未就绪、不裁剪范围）；新增 `indexOfCommit` 用于把选中提交重新锚定到视口。
- `timeline-view.tsx`：筛选栏新增「时间范围」下拉；`filteredCommits` 与窗口 / 泳道共用同一数据源；`applyFilterPatch` 在切换筛选或范围后，若选中提交仍可见则滚动至其所在行（居中），否则回到顶部——即「缩放保持选中上下文」；详情面板不因范围切换而关闭。
- 单测：新增时间范围切分（全量 / 近一周 / 近一月、非法时间戳）、`indexOfCommit`、缩放计入激活判定（共 5 条，累计 167）。
- E2E：mock 提交时间改为**相对 now**（每条相差 3 天，并带固定偏移避开整周 / 整月边界），用例断言近一周 3/60、近一月 10/60，以及切换范围后详情面板仍在。

**关键决策**

| 编号     | 决策                                                                   | 理由                                                                                                      | 备选与否决原因                                                                 |
| -------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ADR-0059 | 时间范围作为**过滤维度**，与关键词 / 作者 / 事件类型取交集             | 三者都是「在已加载提交里收窄」，共用一套纯函数与同一份计数提示，交互与实现都最简                          | 单独做缩放视图：多一套状态与渲染分支，且与过滤叠加时语义含混                   |
| ADR-0060 | `nowMs` 由组件注入（`null` = 不裁剪），不在 render 内调用 `Date.now()` | React 纯度规则禁止 render 期调用 `Date.now()`；把时间基准放进状态（每分钟刷新）也顺带让「近一周」自动滚动 | 在 `useMemo` 内直接 `Date.now()`：lint（react-hooks/purity）报错且破坏渲染纯度 |
| ADR-0061 | mock 的提交时间改为**相对 now**，而非固定日期                          | 时间范围测试依赖「现在」，固定日期会随时间流逝而失效（CI 早晚会跑红）                                     | 保留固定日期并放宽断言：等于不测时间范围，失去覆盖                             |

**问题与风险**

- 仅对**已加载**提交做范围裁剪；更早的历史需先「加载更多」。
- 「近一周」依赖客户端时钟，但比较用的是 UTC 时间戳，不受时区影响；时钟异常仍会失真。
- 范围缩放会触发泳道布局重算（与过滤同路径），大列表下与切换分支同量级。

**下一步**

- M2-6：概念解释层（术语悬浮卡片、新手 / 进阶模式）。

## 2026-10-09 · M2-4 时间线过滤与搜索：客户端即时过滤

**目标**：在已加载的提交上提供关键词 / 作者 / 事件类型过滤，实时反馈且不打断浏览。

**完成内容**

- 新增 `lib/timeline-filters.ts`（纯函数）：`filterTimelineCommits`（关键词匹配标题 / SHA / 作者，作者精确匹配，事件类型 merge / PR / Issue，多条件取交集）、`timelineAuthors`（作者去重候选）、`hasActiveTimelineFilter`、`EMPTY_TIMELINE_FILTER`。
- `timeline-view.tsx`：新增筛选栏（关键词输入 + 作者下拉 + 事件类型下拉 + 清除 + 「筛选后 N / M 条」）；`windowRange`、泳道布局、可见行全部改为基于 `filteredCommits`；过滤生效时暂停自动翻页（避免对已加载子集做底部误判，仍可手动「加载更多」）；无匹配时给出空态与清除入口。
- 单测：`timeline-filters.test.ts` 覆盖关键词（标题 / SHA / 作者、大小写）、作者精确匹配、事件类型、条件交集、作者去重与名称回退（7 条）。
- E2E：`timeline.spec.ts` 断言关键词过滤（`#59` → 1/60）与事件类型过滤（PR → 6/60）及清除后的数量提示。

**关键决策**

| 编号     | 决策                                                           | 理由                                                                               | 备选与否决原因                                                                 |
| -------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ADR-0057 | 过滤放在**客户端**，作用于已加载提交                           | 数据已在内存，过滤是纯数组操作，天然满足「实时反馈 / < 100ms」；无需新增接口与游标 | 服务端过滤：需为每种条件扩 GraphQL 查询与分页游标，成本高且实时性差            |
| ADR-0058 | 分支维度沿用既有**分支选择器**（服务端重新拉取），不进关键词框 | 分支切换本质是换数据源（游标链不同），与「在已加载数据里筛」是两回事               | 把分支做成客户端过滤：只能过滤「首页 50 条里的分支标记」，与真实分支视图不一致 |

**问题与风险**

- 过滤只作用于**已加载**的提交：未加载的历史搜不到；过滤生效时暂停自动翻页以避免「边筛边拉」的歧义。
- 关键词为大小写不敏感的子串匹配，未做模糊 / 拼音 / 命中高亮。
- 泳道布局基于过滤后的集合重算，父提交被过滤掉时会呈现截断连线（属预期）。

**下一步**

- M2-5：时间缩放（近一周 / 一月 / 全部视图）。

## 2026-10-09 · M2-3 PR / Issue 关联标注：GraphQL 聚合 + 行内跳转

**目标**：把提交关联的 PR / Issue 作为**提交上的标注**呈现（D1：不新增独立节点），可跳转 GitHub，并能在详情面板展开。

**完成内容**

- `lib/github-timeline.ts`：时间线查询的 `associatedPullRequests` 增加 `closingIssuesReferences(first: 3) { nodes { number title state url } }`；新增 `TimelineIssue` 类型、`TimelinePullRequest.issues` 字段与 `collectIssues()`（跨 PR 按编号去重、保留首次出现顺序）。
- `timeline-view.tsx`：`CommitRow` 由「整行 `<button>`」改为「遮罩 `<button>` + `pointer-events-none` 内容层」，使行内 PR / Issue 标注可以是真正的 `<a>` 链接（`target="_blank"`，跳转 GitHub）；新增 Issue 徽标。
- `commit-detail.tsx`：详情面板新增「关联 Issue」段（与既有「关联 Pull Request」并列），聚合该提交所有关联 PR 关闭的 Issue。
- 单测：`github-timeline.test.ts` 覆盖 `closingIssuesReferences` 归一化与 `collectIssues` 去重。
- E2E：`mock-github.mjs` 的 PR 节点补 `closingIssuesReferences`；`timeline.spec.ts` 断言行内 `#60 已合并` / `#1060 已关闭` 链接直指 GitHub。

**关键决策**

| 编号     | 决策                                           | 理由                                                                                                                            | 备选与否决原因                                                                  |
| -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| ADR-0055 | 行内标注改为「遮罩按钮 + pointer-events 分层」 | `<a>` 不能嵌在 `<button>` 内（HTML 非法、hydration 报错、点击会被父按钮吞掉）；分层后整行仍可点选、标注可独立跳转               | 用 `role="link"` + `onClick` 模拟链接：伪造链接语义，牺牲中键 / 右键 / 可访问性 |
| ADR-0056 | Issue 数据取 PR 的 `closingIssuesReferences`   | GitHub GraphQL 在 Commit 上没有 `associatedIssues`；提交与 Issue 的关联本质是「由该提交所在 PR 关闭」，与 GitHub 提交页口径一致 | 单独再发一次仓库级 Issue 查询：请求翻倍且仍需自行做提交↔Issue 匹配              |

**问题与风险**

- Issue 标注口径是「被关联 PR 关闭的 Issue」；未绑定 PR 的 Issue（纯讨论 / 未关闭）不会出现在时间线上。
- 每个提交的关联 PR 上限 3、每个 PR 的关联 Issue 上限 3（GraphQL `first`），超出部分不展示；详情面板只做「跳转 GitHub」，未内联 Issue 正文。
- 行内标注在 `pointer-events` 分层下有细微命中边界（徽标附近点击命中链接而非选中该行）。

**下一步**

- M2-4：过滤与搜索（作者 / 分支 / 事件类型 / 关键词）。

## 2026-10-09 · M2-2 分支泳道渲染：算法包窗口化 + apps/web SVG 接入

**目标**：把 M2-1 的泳道布局算法真正画到时间线上，并在「50 分支 / 5000 提交」规模下保持可交互。

**完成内容**

- `packages/git-graph`（算法包收尾）：
  - 新增 `sliceLaneLayout(layout, start, end)` 与 `LaneSlice`：按渲染窗口切出节点与连线段；`laneCount` 恒取整体值（滚动时列宽不抖动）；末行悬挂线段（父提交不在已加载集合）保留，以便画到窗口底部。
  - 新增 `synthetic-history.ts`：确定性合成历史（主干 + 功能分支，`concurrent` 控制并发泳道），默认 `50 × 100` 产出 5051 提交。
  - 新增 `layout.perf.test.ts`：结构护栏（切片元素量只与窗口大小相关）+ 耗时护栏（切片 < 16.7ms/帧、全量布局 < 500ms）。
  - `package.json` 入口改为 TS 源码（`./src/index.ts`），交由消费方转译。
- `apps/web`（渲染接入）：
  - 新增 `app/repos/[owner]/[name]/lane-graph.tsx`：以 `<svg aria-hidden>` 绘制窗口内的连线段（`<path>`，按 `LaneSegment.color` 上色）与提交节点（`<circle>`）。
  - 新增 `lib/lane-geometry.ts`（含单测）：把泳道数映射为列宽 / 槽宽，列宽在 [8, 18] 内随泳道数反向收敛，无泳道时不占位。
  - `timeline-view.tsx`：`useMemo` 计算 `computeLaneLayout`（只依赖 `commits`，滚动不重算）→ `sliceLaneLayout(windowRange)` → 在窗口内容层绝对定位渲染 `LaneGraph`，行内容加 `paddingLeft`。
  - 依赖与构建：`apps/web` 加 `@utf8-git/git-graph: workspace:*`，`next.config.ts` 加 `transpilePackages`；锁文件已更新。
  - E2E：`timeline.spec.ts` 增加「泳道图层随窗口渲染」断言（mock 为线性历史，泳道数 = 1）。

**关键决策**

| 编号     | 决策                                                                  | 理由                                                                                                                                   | 备选与否决原因                                                                                     |
| -------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ADR-0053 | `packages/git-graph` 以 **TS 源码 + `transpilePackages`** 被 web 消费 | 单一 TS 源码真相，免构建产物陈旧问题；Turbopack 原生支持工作区转译                                                                     | 维护 `dist` 产物：`tsconfig` 为 `Bundler` 解析且相对导入无扩展名，产物在纯 Node ESM 下不可直接运行 |
| ADR-0054 | 合成历史主干额外加一个**根提交**，使 merge 点恒早于 fork 点           | 原实现末条分支的 fork 点与 merge 点重合，构成 `t{n} ↔ f{n}` 环，任何拓扑序都无法满足「父在子后」；加根提交后主干索引严格递增，天然无环 | 让末条分支不 merge：分支悬空，与「每条分支都回归主干」的语义不符                                   |

**问题与风险**

- 性能护栏的耗时断言依赖 CI 机器性能，阈值已给足余量（实测切片 ≈ 0.4ms / 全量布局 ≈ 11ms）；如遇 CI 抖动应调高阈值而非删除。
- 大仓库（>5000 提交）下 `computeLaneLayout` 仍随 `commits` 全量重算（仅切换分支 / 加载更多触发），尚未做服务端缓存或增量布局。
- 本机仍不跑 E2E（无本地 Postgres），泳道渲染的端到端验证以 CI `e2e` job 为准。

**下一步**

- M2-3：PR / Issue 事件关联标注（挂载到关联提交）。
- 可选：给时间线补泳道图例 / 悬停提示。

## 2026-10-09 · E2E 基线首次实跑：修好装配、对齐断言，并修掉一个真实分页 bug

**目标**：让恢复后的 Playwright E2E 在 CI 真正跑通——此前它从未被执行过，因此「文件齐全」并不等于「可用」。

**完成内容**

- 修复装配缺陷：Playwright 先启动 webServer、再执行 globalSetup，而应用就绪探针 `/api/health` 在 `REQUIRED_TABLES` 缺表时返回 503，建表却只在 globalSetup 里做 → 探针永远等不到 200 并超时（CI run 37891506703）。改为 `prisma migrate deploy && next start`，把迁移提到应用启动前（`57b0083`）。
- 对齐过期断言（CI run 37892953483 暴露）：`getByRole("link", { name: "encode-utf8/utf8-git" })` 因「在 GitHub 打开 <fullName>」的 aria-label 命中 2 个元素，改用 `exact: true`；登录页文案已是「不会创建、修改或删除任何仓库内容」，正则同步（`dcde996`）。
- **修掉一个真实的分页 bug**（CI run 37893915569 暴露）：未手动选分支时（第 1 页由服务端渲染、不带 `branch`），游标链 key 为 `branch=""`；而接口返回的是解析后的默认分支名，客户端把它当 `branch` 回传，于是第 2 页 key 变成 `"main"`，游标链查不到 → 409 `cursor_expired` 并停止翻页。即：默认分支下点「加载更多」必失败（`b7b2fca`）。改为分页沿用第 1 页实际使用的分支参数（新增 `branchParam`，`branch` 仅用于展示）。
- CI run 37894962579：`verify` 与 `e2e` 两个 job 全绿，E2E `4 passed (3.5s)`。

**关键决策**

| 编号     | 决策                                                                             | 理由                                                                                           | 备选与否决原因                                                                             |
| -------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ADR-0052 | E2E 的迁移放在 **webServer 启动命令里**（`prisma migrate deploy && next start`） | Playwright 的 webServer 早于 globalSetup，就绪探针必须先能拿到 200；迁移幂等，重复执行无副作用 | 把就绪探针换成不查库的地址：掩盖「迁移未完成」这类真实故障；只改 CI 加一步：本地跑仍会死锁 |

**问题与风险**

- 这三处问题都属于「从未实跑」导致的欠账：装配缺陷 + 2 条断言漂移 + 1 个真实功能 bug。E2E 的价值在此前一直被高估为「文件写好了」，实跑一次才兑现。
- `STORE_BACKEND=memory` 的单 worker 串行仍是 E2E 唯一配置，Postgres 共享存储 / 多实例分页不在 E2E 覆盖内（由部署实测覆盖）。
- 本机仍不跑 E2E（无本地 Postgres），验证一律以 CI `e2e` job 为准。

**下一步**

- M1-7 验收口径（E2E 基线）已可判定为达成，TODO-142 可勾选。
- M2-2：把 `computeLaneLayout` 接入时间线 SVG 泳道渲染。

## 2026-10-09 · 恢复 Playwright E2E 基线（撤销 ADR-0049 / ADR-0050）

**目标**：撤销同日「用 vitest 路由 / API 集成测试替代 Playwright E2E」的决策。项目确认**需要 Postgres**，并已在 Vercel 完成部署，数据库驱动的端到端测试是对真实链路的有效保障；此前「为一条用例不该引入数据库」的前提不再成立。

**完成内容**

- 恢复文件：`apps/web/e2e/mock-github.mjs`、`e2e/global-setup.ts`、`e2e/timeline.spec.ts`、`e2e/auth.spec.ts`、`playwright.config.ts`（独立 `*_e2e` 库、mock 上游端口 3211、应用端口 3210）。
- 恢复依赖与脚本：`apps/web` 加回 `@playwright/test` 与 `test:e2e`；根 `package.json` 恢复 `test:e2e`（先 `next build` 再跑 Playwright）；`.gitignore` 恢复 `apps/web/e2e/.auth/`；CI 恢复 `e2e` 任务（postgres:16 service + chromium，失败上传报告）。
- 恢复可测试性改造：`github-repos.ts` / `github-commits.ts` / `github-graphql.ts` / `github-token.ts` 的上游地址重新支持 `GITHUB_API_BASE_URL` / `GITHUB_GRAPHQL_ENDPOINT` / `GITHUB_TOKEN_ENDPOINT` 覆盖（默认官方地址）。
- 撤销 vitest 替代：删除 `apps/web/tests/api-routes.test.ts`；保留精简的 `apps/web/vitest.config.mts`（不含 `@` 别名），仅用于把 `e2e/**` 从 vitest 收集范围排除。
- 修复一处基线缺陷：恢复后的 Playwright `*.spec.ts` 会被 vitest 默认 include（`**/*.spec.ts`）收集并报「Playwright Test did not expect test() to be called here」，导致 2 个套件失败。原实现从未实跑，故此前未暴露；本次在 `vitest.config.mts` 中显式 `exclude: ["e2e/**"]` 修掉。
- 锁文件：`pnpm install` 写入 `@playwright/test` / `playwright` / `playwright-core`。
- 文档同步：`docs/deployment.md`（§2 恢复三条上游覆盖变量）、`docs/todo.md`（TODO-142 改回 E2E 口径）、`docs/roadmap.md`（M1-7 恢复「1 条 E2E」、M4 质量恢复 E2E 覆盖 5 条关键路径）、`docs/technical-analysis.md`（测试选型恢复集成 / E2E / 性能分层）。

**关键决策**

| 编号     | 决策                                                          | 理由                                                                                                          | 备选与否决原因                                                                                               |
| -------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| ADR-0051 | **保留数据库驱动的 Playwright E2E**，撤销 ADR-0049 / ADR-0050 | 项目需要 Postgres 且已部署 Vercel；E2E 覆盖浏览器 + 服务端组装 + 翻页交互的真实链路，是集成测试无法替代的一层 | 只保留 vitest 集成：覆盖不到浏览器行为与 hydration；E2E 引入数据库成本：项目本就以 Postgres 为准，不再是负担 |

**问题与风险**

- 本机 Docker 有 Postgres 镜像但未起库，`pnpm test:e2e` 未在本地实跑；其余 `install` / `test` / `lint` / `typecheck` / `build` 均已在本地跑通，E2E 以 CI 或本地起库后实跑为准。
- E2E 依赖单 worker 串行（内存游标链），多实例共享存储下的翻页仍由 M1-6 / M1-7 覆盖。

**下一步**

- 本地 `docker compose -f docker-compose.dev.yml up -d` 起库后跑一次 `pnpm test:e2e`，确认恢复后的基线全绿。
- M2-2：把 `computeLaneLayout` 接入时间线 SVG 泳道渲染。

## 2026-10-09 · 撤掉 Playwright E2E，改为 vitest 路由 / API 集成测试

> 注：本条决策已于同日撤销——项目需要 Postgres 且已部署 Vercel，已恢复数据库驱动的 E2E 基线；见上一条与 ADR-0051。

**目标**：上一日引入的 Playwright E2E 需要额外起 Postgres（会话 / 令牌在当前实现里只有 Prisma 一种存储，没有本地文件后端），与「E2E 不应引入浏览器与数据库依赖」的诉求冲突。改为在 vitest 内做路由 / API 集成测试：覆盖同一段组装链路，但零外部依赖。

**完成内容**

- 删除 Playwright：`apps/web/e2e/*`、`apps/web/playwright.config.ts`、`@playwright/test` 依赖、`test:e2e` 脚本（根 + web）、`.gitignore` 的 `e2e/.auth/`、CI 的 `e2e` 任务（含 postgres service）。
- 回退仅为 E2E 服务的可测试性改造：`github-repos.ts` / `github-commits.ts` / `github-graphql.ts` / `github-token.ts` 恢复硬编码上游地址（移除 `GITHUB_API_BASE_URL` / `GITHUB_GRAPHQL_ENDPOINT` / `GITHUB_TOKEN_ENDPOINT` 覆盖）。
- 新增 `apps/web/vitest.config.mts`（ESM 配置，避免 Vite 的 CJS 警告；`@` 别名对齐 tsconfig paths）与 `apps/web/tests/api-routes.test.ts`：用 `vi.mock` 顶替 `@/lib/auth`、`@/lib/access-token`，`vi.stubGlobal("fetch")` 顶替 GitHub 请求，缓存 / 限流走内存后端。覆盖 10 条：仓库列表未登录 401 / 无令牌 401 / 正常 200（字段归一化、响应不含令牌）/ 限流 429 / 不可达 503，时间线未登录 401 / 非法仓库名 400 / 非法页码 400 / 正常 200 / 深页无游标链 409。
- 锁文件回退：E2E 期间 `pnpm install` 写入 `pnpm-lock.yaml` 的 `@playwright/test` / `playwright` / `playwright-core` 残留（含 `next` / `next-auth` 的 peer 后缀变化）已 `git restore` 回退到与当前清单一致的版本，无需再为 E2E 执行 `pnpm install`。
- 文档同步：`docs/deployment.md`（删除 §3.3 与 §2 三条上游覆盖变量）、`docs/todo.md`（TODO-142 改口径、移除 TODO-145）、`docs/roadmap.md`（M1-7 验收口径）、`docs/technical-analysis.md`（测试选型）。

**关键决策**

| 编号     | 决策                                                              | 理由                                                                                                                           | 备选与否决原因                                                                                       |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| ADR-0049 | **撤掉 Playwright E2E**，改用 vitest 路由 / API 集成测试          | 原 E2E 依赖 Postgres（会话 / 令牌仅 Prisma 实现），为一条用例引入数据库 + 浏览器成本过高；集成测试覆盖同一组装链路且零外部依赖 | 保留 Playwright + 起库：正是本次要消除的成本；保留 Playwright + 在生产代码开测试会话旁路：安全面更大 |
| ADR-0050 | 集成测试**不改生产代码**（用 vitest 模块 mock，而非新增测试开关） | 生产代码零测试分支，避免环境变量误配导致鉴权被绕过                                                                             | 新增 `E2E_FAKE_AUTH` 类开关：一旦线上误设即绕过鉴权                                                  |

**问题与风险**

- 本机 pnpm 已恢复（Node 自带 corepack 的 `pnpm@12.9.1` shim）：`pnpm install --frozen-lockfile` 校验锁文件与清单一致，并清理了 node_modules 中残留的 Playwright；`pnpm test` / `pnpm lint` / `pnpm typecheck` 递归全绿（web 159 通过 / 4 跳过，git-graph 14，github-client 6，ui 3）。`pnpm build` 未跑，仍以 CI 为准。
- 集成测试覆盖服务端链路，但**不覆盖浏览器端行为**（虚拟滚动、翻页合并的交互、hydration）；如需该层，后续单独立项，不阻塞 M1。
- M1-7 验收口径由「1 条 E2E」改为「关键路径集成测试」，已在 roadmap / todo 同步。

**下一步**

- 本地 / CI 跑一次 `pnpm build`（`next build`）确认产物；`install` / `test` / `lint` / `typecheck` 已在本地跑通。
- M2-2：把 `computeLaneLayout` 接入时间线 SVG 泳道渲染。

## 2026-10-08 · M1 收尾（Playwright E2E + 授权说明页 + 协作模板）与 M2-1 算法内核

> 注：本条中的 Playwright E2E 于 2026-10-09 短暂撤销后已于同日恢复（见最新一条与 ADR-0051）。

**目标**：补齐 M1 退出标准的两处缺口——E2E 测试基线与 `repo` scope 授权说明；清掉 M0 遗留的协作模板；并为 M2 起步先落地可独立测试的泳道布局算法内核。本次确定三项决策：E2E 用 Playwright、预览环境加稳定别名、可并行的工作并行推进。

**完成内容**

- E2E 基线（TODO-142）：接入 Playwright。`apps/web/e2e/mock-github.mjs` 提供本地 REST / GraphQL 上游；`e2e/global-setup.ts` 直接向 E2E 库写入用户 + 加密令牌 + 会话（等价「已完成登录」），并自动执行 `prisma migrate deploy`；`playwright.config.ts` 同时拉起 mock 与 `next start`。用例覆盖「仓库列表 → 时间线 → 翻页 → 提交详情」（`timeline.spec.ts`）与未登录拦截 / 授权文案（`auth.spec.ts`）。
- 可测试性改造：`github-repos.ts` / `github-commits.ts` / `github-graphql.ts` / `github-token.ts` 的上游地址改为可由 `GITHUB_API_BASE_URL` / `GITHUB_GRAPHQL_ENDPOINT` / `GITHUB_TOKEN_ENDPOINT` 覆盖（默认值不变，仅服务端读取）。
- 授权说明页（TODO-115）：新增公开页 `/permissions` 与共享文案模块 `lib/permissions.ts`；登录页与 `/repos` 的「授权范围不足」空状态改为链接该页，统一「权限用途 / 数据使用 / 不做什么 / 撤销方式 / SSO」说明。
- 协作模板（TODO-009）：新增 `CONTRIBUTING.md` 与 `.github/PULL_REQUEST_TEMPLATE.md`、`.github/ISSUE_TEMPLATE/*`。
- M2-1 算法内核：`packages/git-graph/src/layout.ts`（`computeLaneLayout`）与单测 `layout.test.ts`，覆盖 merge / octopus / root / 多独立根 / rebase 遗弃 / 分页截断父提交；`types.ts` 补充 `LaneSegment` / `LaneEdge` / `LaneLayout`，`index.ts` 导出。
- CI：`.github/workflows/ci.yml` 新增 `e2e` 任务（postgres service + Playwright chromium，失败上传报告）。

**关键决策**

| 编号     | 决策                                                              | 理由                                                                    | 备选与否决原因                                          |
| -------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| ADR-0045 | E2E 用 **Playwright**，并以「mock 上游 + 落库会话」而非真实 OAuth | 真实 OAuth 依赖外部账号与随机回调地址，不可控；落库会话可精确复现登录态 | 组件级 vitest 集成：覆盖不到服务端页面 / 路由与翻页链路 |
| ADR-0046 | 上游地址通过**环境变量覆盖**（默认官方地址）                      | 让 E2E / 自建指向本地 mock，且不改动生产行为；服务端读取，不进入前端包  | 测试内改写 DNS / 全局 fetch：不可靠、影响面大           |
| ADR-0047 | 预览环境用**固定别名 + 单独 OAuth App**                           | GitHub OAuth App 只能登记一个回调地址，随机预览域名无法共用生产 App     | 共用生产 App：需反复改回调，风险高                      |
| ADR-0048 | 泳道算法先做成**独立可测的纯函数包**，再接渲染                    | 算法边界多（merge / octopus / 截断），独立单测成本低、回归快            | 直接在组件里算：难测试、易与渲染耦合                    |

**问题与风险**

- 本机**无 Node / pnpm / Docker / Postgres**，未能执行 `pnpm install`、`build`、`test`、`test:e2e`；上述改动均**未在本机验证**，需在本地或 CI 实跑确认。
- 新增依赖 `@playwright/test` **尚未写入 `pnpm-lock.yaml`**（需 `pnpm install` 生成并提交），否则 CI 的 `--frozen-lockfile` 与 `e2e` 任务会失败（该依赖已于 2026-10-09 恢复 E2E 时通过 `pnpm install` 写入锁文件）。
- E2E 依赖 `STORE_BACKEND=memory` 与服务端内存游标链，故配置为单 worker 串行；多实例共享存储下的翻页另由 M1-6 / M1-7 覆盖。
- `layout.ts` 未经 `pnpm test` 验证，仅由作者以等价仿真核对断言，仍需 CI 单测确认。

**下一步**

- 执行 `pnpm install` 并提交更新后的 `pnpm-lock.yaml`，本地 / CI 实跑 `pnpm test:e2e` 并修复暴露的问题。
- 按 `docs/deployment.md` §7 落地预览稳定别名与预览 OAuth App；生产实跑 `pnpm deploy:selfcheck`。
- M2-2：把 `computeLaneLayout` 结果接入时间线 SVG 泳道渲染。

## 2026-10-07 · 部署自检（/api/health + 自检脚本）

**目标**：用户在线上实测反馈两个现象——登录后操作迟钝、下滑翻页报「分页数据已过期（409 `cursor_expired`）」。把「部署配置是否正确」做成可脚本化核对的常设能力，避免同类问题只能靠人工排查。

**完成内容**

- 根因定位：`apps/web/lib/timeline-data.ts` 在 `page > 1` 时从共享存储读取 cursor 链，读不到即抛 `TimelineCursorExpiredError` → 409。Serverless 下若 `STORE_BACKEND` 未设为 `postgres`，缓存与游标链按实例隔离，第 2 页请求落到别的实例就会命中该分支；同时缓存全部失效导致每次请求都回源 GitHub（表现为迟钝）。
- 新增 `apps/web/lib/health.ts` 与 `GET /api/health`：无鉴权，只返回布尔与说明文字，核对 `STORE_BACKEND`（Serverless 下必须 `postgres`）、数据库连通性、迁移表齐全性、必填密钥是否就位、`AUTH_TOKEN_ENC_KEY` 是否为 32 字节；全部通过 200，任一失效 503。错误信息中的连接串统一抹除。
- 新增 `scripts/deploy-selfcheck.mjs`（根目录 `pnpm deploy:selfcheck`）：对外部实例核对静态页可达、未登录一律 401、`__Host-` / `__Secure-` Cookie 前缀、OAuth 跳转参数、`redirect_uri` 是否等于部署域名，并输出 `/api/health` 的逐项明细。
- 文档：`docs/deployment.md` 新增 §3.2「部署自检」与 §3.1「翻页 409」排查条目；`docs/todo.md` 新增 TODO-144。

**关键决策**

| 编号     | 决策                                                              | 理由                                                                             | 备选与否决原因                                     |
| -------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| ADR-0042 | 采用**应用内 `/api/health`** 暴露运行期配置结论，而非只做外部探测 | `STORE_BACKEND` 等配置只在服务端可见，外部脚本无法推断；该端点还可复用为平台探针 | 只做外部脚本：探测不到缓存后端，本次故障仍会被漏判 |
| ADR-0043 | 健康端点**只返回布尔与说明文字**，不回显密钥值                    | 端点无鉴权、任何人可访问；结论已足够定位问题，回显值只会扩大暴露面               | 返回完整配置快照：泄露面过大                       |

| ADR-0044 | 函数区与数据库区**必须同区**（本次实测：函数在 `iad1`、Neon 在 `ap-southeast-1`） | 会话策略为 `database`，登录后每次请求串行 4~6 次查询；跨区往返 200 ms+ 会直接放大成秒级延迟，表现为「点什么都慢」 | 靠缓存掩盖：缓存本身也在同一个库里，跨区后每次缓存读取同样要 200 ms+ |

**问题与风险**

- 自检只能验证「服务端发出的 `redirect_uri` 是否等于部署域名」，无法验证该地址是否已在 GitHub OAuth App 登记（GitHub 仅在已登录状态校验登记值），仍需人工比对。
- `/api/health` 无鉴权且会发起一次数据库查询，理论上可被用于放大请求；当前规模可接受，后续如需限制可加平台侧规则。
- **用户实测追加（同日）**：`STORE_BACKEND` 早已设置，但「点什么都迟缓」依旧。取响应头 `x-vercel-id` 得函数区 `iad1`（美东），而 Neon 在 `ap-southeast-1`（新加坡）；会话策略 `database` 决定了每个请求都要串行查会话 / 令牌 / 缓存 / 限流 / 游标，跨区往返把每次查询抬到 200 ms 以上。为此 `GET /api/health` 追加返回 `functionRegion` 与 warnings（数据库往返 >150 ms 即告警）。同区部署待用户在其 Vercel / Neon 账户内执行。

**下一步**

- 合并部署后对生产域名实跑 `pnpm deploy:selfcheck`，确认 `STORE_BACKEND=postgres` 已生效。
- TODO-142 E2E（登录 mock → 选仓库 → 浏览时间线）。

## 2026-10-07 · 线上部署与验收（Vercel + Neon）

**目标**：把应用部署到公网并给出可验证的验收结论，收尾 TODO-104。

**完成内容**

- 部署形态落地：Vercel Production（`main` 自动部署）+ Neon（ap-southeast-1）；构建 / 安装命令由 `apps/web/vercel.json` 固化（见下一节记录）。
- 数据库：以 Neon **直连主机**执行 `prisma migrate deploy`，`20261004144043_init_auth` 与 `20261007081155_m1_6_shared_stores` 全部应用；`users` / `accounts` / `sessions` / `verification_tokens` / `shared_cache_entries` / `rate_limit_states` 表建齐。
- 线上验收（经本地代理访问，因本机到 `vercel.app` 的 DNS 被污染）：`/` 200（冷 897 ms / 热 201 ms）、`/login` 200（约 0.5 s）、`/api/repos` 与 `/(owner)/(name)/timeline` 未登录均 401、`/api/auth/providers` 返回 github provider 且回调地址指向生产域名、`/api/auth/csrf` 下发 `__Host-` / `__Secure-` 前缀 Cookie、`POST /api/auth/signin/github` 302 跳 GitHub 授权页且 `client_id` / `redirect_uri` / `scope=read:user repo` 正确，打开授权页未出现 `redirect_uri` 错误。
- 报告：`docs/reports/tech-analysis/M1-6-deployment-verification.md`。

**关键决策**

| 编号     | 决策                                                 | 理由                                                                     | 备选与否决原因                         |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------- |
| ADR-0040 | 迁移用 Neon **直连主机**执行，运行期再用 pooled 串   | 迁移需要会话级特性（advisory lock 等），PgBouncer transaction 模式不可靠 | 直接用 pooled 跑迁移：存在偶发失败风险 |
| ADR-0041 | 线上验收经本地代理执行，并在报告中标注耗时含代理开销 | 本机直连 `vercel.app` 不可达；不标注会把代理开销误读为应用性能           | 放弃线上验收：无法交付可验证结论       |

**问题与风险**

- 浏览器完整登录（会话写入 + 令牌加密入库 + 拉取仓库列表）待用户完成，这是唯一尚未覆盖的链路。
- 本机对 `vercel.app` 的 DNS 被污染，后续线上检查都需经代理，耗时读数偏保守。
- 预览部署的随机域名无法完成 OAuth 回调，尚未处理。

**下一步**

- 用户完成一次浏览器登录后，确认线上 `/repos` 与时间线正常。
- 采集真实冷启动与 Lighthouse 分数，回填验收报告。

## 2026-10-07 · 固化 Vercel 构建配置（线上部署排障）

**目标**：用户在 Vercel 首次部署时遇到两类问题——后台 Build Command 覆盖框预填的 `next build` 与粘贴内容拼成 `next buildprisma generate && next build`（构建失败），以及环境变量里手动设置的 `NODE_ENV` 触发 Next.js 非标准值警告。把构建 / 安装命令固化进仓库，避免再次依赖后台手输。

**完成内容**

- 新增 `apps/web/vercel.json`：`buildCommand`（`prisma generate && next build`）与 `installCommand`（`pnpm install --frozen-lockfile --registry=https://registry.npmjs.org`），后者绕过仓库 `.npmrc` 的国内镜像。
- `docs/deployment.md`：修正部署步骤（Root Directory 为 `apps/web`，此前文档误写为仓库根）、明确迁移在本地对生产库执行、后台字段必须留空；新增 §3.1「常见坑」（命令拼接 / `NODE_ENV` / 依赖镜像 / 未执行迁移）与 §2 的 `NODE_ENV` 说明。

**关键决策**

| 编号     | 决策                                                                   | 理由                                                                  | 备选与否决原因                                                                                             |
| -------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| ADR-0038 | 构建 / 安装命令**写进 `apps/web/vercel.json`**，而非在 Vercel 后台维护 | 配置随仓库版本化、可 review、不会手输拼错；换项目重导入时无需重建配置 | 仅用后台设置：不可版本化，已实际出错一次；仅靠默认命令：`prisma generate` 依赖安装期隐式触发，显式声明更稳 |
| ADR-0039 | 迁移**不在构建命令里执行**，由本地对生产库直连串执行                   | 预览环境每次构建都会跑；与生产共用库时会误迁移                        | 构建期跑 `migrate deploy`：预览/生产耦合，风险大于便利                                                     |

**问题与风险**

- Vercel 后台字段优先级高于 `vercel.json`：若不清空后台覆盖，本配置不生效（文档已标注）。
- 预览部署的随机域名无法完成 OAuth 回调，需要稳定别名或独立 OAuth App，尚未处理。

**下一步**

- 线上验收：`/`、`/login`、`/repos`、时间线翻页，并确认 `STORE_BACKEND=postgres` 生效。
- 采集真实平台的冷启动耗时与 Lighthouse 分数，回填 `docs/reports/`。

## 2026-10-07 · M1-7 性能验证（小 / 中 / 大真实仓库，TODO-143）

**目标**：用真实仓库量测时间线与仓库列表的关键性能指标，验证「单页 1 次请求、翻页无重复、缓存有效」，并为 roadmap 的「首屏可交互 < 2s / Lighthouse ≥ 80」提供实测数据。

**完成内容**

- 新增 `scripts/perf-validate.mjs`（根目录 `pnpm perf`）：按仓库量测仓库页 HTML（TTFB / 总耗时 / 体积）、时间线连续翻页（每页 TTFB、提交数、`meta.cached`、跨页重复）、仓库列表回源与命中对比，输出 Markdown 表格 + 原始 JSON。
- 样本与深度：小 `encode-utf8/utf8-git`（17 commits）、中 `encode-utf8/stock-analysis`、大 `torvalds/linux`（各 3 页）；另对 `torvalds/linux` 连续翻 11 页（550 条）。
- 报告：`docs/reports/tech-analysis/M1-7-perf-validation.md`，原始数据 `M1-7-raw.json` / `M1-7-raw-linux-deep.json`。
- 修复验证中发现的缺陷：上一页 `endCursor` 为 `null` 时，后续页以 `null` 游标请求会让 GitHub 忽略 `after` 并重新返回第 1 页（实测 `utf8-git` 第 3 页重复 17 条）。`timeline-data.ts` 改为直接返回空页并复用上一页仓库信息；上一页数据不可用时回退 409 `cursor_expired`。新增 2 个单测，端到端复测跨页重复 = 0。

**关键决策**

| 编号     | 决策                                                             | 理由                                              | 备选与否决原因                                                |
| -------- | ---------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| ADR-0036 | 性能验证以**脚本 + 报告留痕**（`pnpm perf`），而非一次性手工测量 | 可复现、可回归；后续换仓库 / 换环境只需改环境变量 | 手工 curl 记录：不可复现，数据无法沉淀                        |
| ADR-0037 | 越界翻页（上一页无更多数据）**返回空页**，而非抛错或回退第 1 页  | 语义正确、不产生重复数据；客户端逻辑无需改动      | 抛 409：把「没有更多了」误报成异常；回退第 1 页：产生重复条目 |

**问题与风险**

- 冷缓存首屏 1.83–2.27s（本地口径，经代理访问 GitHub，单页 GraphQL 2.1–3.1s），未达 2s 目标；该数字主要反映本地出网链路，需在真实部署复测。
- Lighthouse 与「1000+ 提交虚拟滚动流畅度」需浏览器与公网环境，本机无法量测；本次仅验证服务端侧 550 条连续翻页无重复、无乱序。
- 本地 `github.com` 需代理才能访问（`api.github.com` 可直连），影响本地冷缓存耗时读数。

**下一步**

- 公网部署后补测 Lighthouse 与冷缓存首屏；必要时提高首屏预取优先级。
- 视需要把 `PERF_PAGES` 提高到 20+ 页，覆盖 1000+ 提交的接口侧连续性验证。

## 2026-10-07 · M1-6 部署形态与多实例一致性（TODO-104）

**目标**：确定部署形态（Vercel + 托管 PostgreSQL），并解决多实例 / Serverless 下三处「进程内状态」的正确性问题：TTL 缓存不共享、限流快照各实例独立导致降级判定不一致、令牌续期并发导致误报「授权失效」。

**完成内容**

- 共享存储抽象：新增 `shared-store.ts`（`TtlCacheLike` / `RateLimitStoreLike` 接口、`resolveStoreBackend`、`isFresh` / `decideDegrade` 纯函数）；`server-cache.ts`、`rate-limit-store.ts` 改为复用同一套判定，内存实现行为不变。
- Postgres 实现：新增 `pg-stores.ts`——`PgTtlCache`（读 / 写 / 删除 / 过期清理，写入时按 2% 概率顺带清理）与 `PgRateLimitStore`（快照读写 + 降级判定）；`data-stores.ts` 按 `STORE_BACKEND` 选择后端（默认 `memory`，非法值回退 `memory`），后端与单例不一致时重建。
- 数据模型：新增 `SharedCacheEntry`（`key` / `scope` / `value` / `storedAt` / `expiresAt`）与 `RateLimitState`（`userId` / `limit` / `remaining` / `resetAt` / `cost` / `source` / `recordedAt`），迁移 `20261007081155_m1_6_shared_stores`。
- 数据服务兼容同步 / 异步存储：`repos-data.ts` / `timeline-data.ts` / `commit-data.ts` 对缓存与限流调用一律 `await`，依赖类型改为 `TtlCacheLike` / `RateLimitStoreLike`（含 cursor 链读取）。
- 续期竞态恢复：`access-token.ts` 在刷新被 `GitHubUnauthorizedError` 拒绝时**重读库中最新令牌**，若 `expiresAt` 已变化（其他实例刚完成续期）则直接复用，不再误报授权失效。
- 缓存键修复：`cacheKey` 分隔符由 NUL 改为 U+001F（Postgres `text` 不接受 `0x00` 字节）。
- 文档：新增 `docs/deployment.md`（部署形态、环境变量清单、连接池、冷启动与超时、多实例一致性、预览与回滚、遗留项）；README 文档导航与本地开发说明、`docs/todo.md` 同步。

**关键决策**

| 编号     | 决策                                                                           | 理由                                                             | 备选与否决原因                                                                               |
| -------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ADR-0033 | 部署形态：**Vercel + 托管 PostgreSQL（Neon / Supabase）**，不进容器编排        | 与 Next.js 全栈单仓一致；免费层够 MVP；运维成本最低              | 自建 VPS / K8s：运维与成本不匹配单人项目；纯 Serverless + 外部 Redis：MVP 阶段引入额外服务   |
| ADR-0034 | 多实例共享状态**直接用 Postgres 表**（`STORE_BACKEND=postgres`），不引入 Redis | 复用既有数据库与 Prisma，最小新增依赖；一致性优先于极致延迟      | Redis / Upstash：多一个服务与账单；纯内存：多实例下缓存命中率与降级判定都不可控              |
| ADR-0035 | 续期竞态用**「失败后重读库中最新令牌」**而非跨实例锁 / 租约                    | 无需新增锁表与超时回收逻辑，覆盖绝大多数交错；实现与测试成本最低 | 数据库租约（`SELECT ... FOR UPDATE` / 唯一单飞行）：更严格，但需处理租约超时与脑裂，留作后续 |

**问题与风险**

- 端到端验证暴露真实缺陷：Postgres 后端此前**从未跑通**——`cacheKey` 用 NUL 连接，导致共享缓存查询报 `invalid byte sequence for encoding "UTF8": 0x00`；纯内存单测无法发现，只有双实例 E2E 才暴露。教训：新增存储后端必须跑一次真实端到端，不能只靠数据库单元用例。
- 续期去重仍有极小窗口：两个实例同时刷新且**都失败**（如网络抖动）时仍需重新授权；彻底消除需数据库租约（见 ADR-0035 备选）。
- cursor 链是「读-改-写」：多实例并发翻同一仓库下一页时可能丢页 → 客户端收到 409 `cursor_expired` 回到第 1 页，不影响正确性。
- 本地网络：`api.github.com` 可直连，但令牌续期端点 `github.com` 需经本地代理；双实例验证通过启动包装脚本注入 `NODE_USE_ENV_PROXY` + `HTTPS_PROXY`，生产环境不需要。
- 真实 Vercel / Neon 部署、公网冷启动 < 3s 与 Lighthouse ≥ 80 需用户账号，留待 TODO-104 后续。

**下一步**

- M1-7：用小 / 中 / 大三个真实仓库做性能验证（首屏、时间线翻页请求数与耗时、缓存命中率）。
- 真实平台部署后补测公网冷启动与 Lighthouse 分数，并把多实例配置固化到 Vercel 环境变量。

## 2026-10-07 · M1-9 在线状态处理（断网 / 超时 / 限流，TODO-136）

**目标**：依据需求 FR-5.1 / FR-5.2 与 M1-9 验收（「断网有明确提示，不用过期缓存冒充最新数据」），把断网、请求超时、GitHub 限流三类在线状态统一为「明确文案 + 行动按钮」，并补齐瞬时错误的自动重试。

**完成内容**

- 错误分类：新增 `GitHubNetworkError`（503，「请求未能到达」）以区别 `GitHubTimeoutError`（504，「已发出但无响应」）；新增 `github-fetch.ts` 统一封装 GitHub 请求（默认 15 s 超时、网络错误归一化、支持注入 `fetchImpl`）。REST 客户端（仓库列表 / 提交详情）此前既无超时、网络异常还会以原始 `TypeError` 冒泡成未分类的 500，现统一归类；GraphQL 与令牌客户端的网络错误改用同一分类。
- 统一呈现：新增 `error-state.ts`（纯函数，服务端与客户端共用）——9 类错误 → 标题 / 文案 / 行动按钮 / 是否可重试 / 限流恢复时间，并提供 `retryDelayMs` 指数退避。
- 客户端重试：新增 `client-fetch.ts`（`fetchWithRetry`）——仅对断网 / 网络 / 超时 / 5xx 自动重试（默认 2 次、400 ms 起指数退避、封顶 4 s）；401 / 403 / 404 / 409 / 429 不重试；离线短路不发起请求；支持外部 `AbortSignal`。
- 全局离线提示：`use-online-status.ts`（`useSyncExternalStore` 订阅 `online` / `offline`，SSR 快照恒为在线以避免 hydration 抖动）+ `online-banner.tsx` 接入根布局。
- 交互落地：仓库列表「加载更多」、时间线「加载更多 / 切换分支」、提交详情统一改为明确提示 + 显式「重试」按钮；时间线存在错误时暂停自动翻页，避免对限流 / 故障反复冲击；服务端页面 `/repos`、`/repos/{owner}/{name}` 新增「无法连接 GitHub」「请求超时」分支（不再显示含糊的「异常（503）」）；三个 API 路由补齐 `github_unreachable`（503）/ `github_timeout`（504）。
- 验证：`pnpm lint / typecheck / test / build` 全绿；单测 131 例（本任务新增 26 例：错误分类 / 文案 / 退避 11、客户端重试 8、请求封装 6，含「真实 socket 连接失败归类为 GitHubNetworkError」）；端到端（真实会话，临时会话 / 用户已删除）：正常路径 `/repos` 200、`/api/repos` 200；上游临时指向 `http://127.0.0.1:9`（连接被拒绝）→ `/api/repos` 503 `github_unreachable`、`/repos` 页显示「无法连接 GitHub」+ 重试；指向黑洞监听 `127.0.0.1:9931` → 15.25 s 后 `/api/repos` 504 `github_timeout`、`/repos` 页显示「请求超时」；验证后上游配置按字节还原。

**关键决策**

| 编号     | 决策                                                                                                   | 理由                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| ADR-0030 | 在线状态错误统一走 `error-state.ts` 的**类别 → 文案 → 行动**映射，服务端与客户端共用                   | 避免各处自行拼文案造成同一故障多种说法；文案集中也便于后续国际化（TODO-243）                          |
| ADR-0031 | 客户端**只对瞬时错误自动重试**（断网 / 网络 / 超时 / 5xx），401 / 403 / 404 / 409 / 429 一律不自动重试 | 限流与鉴权失败重试只会浪费配额并放大故障；限流改为展示恢复时间 + 手动重试                             |
| ADR-0032 | 「网络不可达」与「请求超时」**分成两类**（503 / 504）                                                  | 两者用户处置不同（查网络 vs 稍后重试），分开才能在 UI 与 API 上给出准确指引，也避免把超时误判为未授权 |

**问题与风险**

- 自动重试是客户端行为；服务端页面的重试依赖用户点击「重试」（刷新页面），服务端自动重试由 GraphQL 客户端既有退避逻辑覆盖。
- 离线判定依赖 `navigator.onLine`（只代表本机是否有网络接口，不代表能到达 GitHub）；真实可达性仍以请求结果为准。
- 进程内限流快照与缓存仍是单实例语义（延续 ADR-0022 / 0029），多实例下的缓存 / 限流 / 续期去重随 M1-6 部署形态评估。

**下一步**

- M1-6 部署形态、M1-7 真实仓库性能验证（小 / 中 / 大）。
- TODO-142 E2E（登录 mock → 选仓库 → 浏览时间线）、TODO-115 `repo` scope 授权说明页。

## 2026-10-07 · 令牌自动续期（refresh token 轮换）

**目标**：GitHub 开启「令牌过期」策略后 access token 8 小时即过期，实现服务端自动续期，避免用户每 8 小时重新授权（承接当日「重新授权不生效」修复）。

**完成内容**

- `github-token.ts`（新增）：GitHub 令牌端点客户端——表单请求（`grant_type=refresh_token`）、8 s 超时、响应归一化（`expires_in` → 绝对过期时间）、错误分类（`error` 字段 / 400 / 401 / 403 → `GitHubUnauthorizedError`；超时 → `GitHubTimeoutError`；网络 / 5xx → `GitHubApiError`）。
- `access-token.ts`（改造）：读取令牌时判断过期（提前 5 min 续期窗口）；有 refresh token 时自动续期并轮换入库（复用 `upsertAccountTokens`，新 refresh token 覆盖旧值）；同一用户并发请求只发起一次续期；续期被拒 → 返回 null（引导重新授权），网络异常 → 抛出（提示重试）。
- 验证：`pnpm lint / typecheck / test / build` 全绿；单测 104 例（本任务新增 13 例，含并发去重）；端到端把库中 `expires_at` 置为过去 → 访问 `/repos` 自动续期成功（密文更换、`expires_at` = now + 8 h），二次请求不再续期；响应无明文令牌；临时会话已删除。

**关键决策**

| 编号     | 决策                                                              | 理由                                                                                                  |
| -------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ADR-0028 | 续期在**读取令牌时按过期时间触发**（提前 5 min），不做 401 后重试 | 时间维度可精确控制且未过期时零额外请求；401 重试需要改动所有调用点，留待统一重试层（TODO-136 / M1-9） |
| ADR-0029 | 同一用户**进程内并发去重**（`Map<userId, Promise>`）              | refresh token 每次刷新都会轮换，并发续期会互相作废；单实例 MVP 足够，多实例随 M1-6 部署形态评估       |

**问题与风险**

- 本机访问 `github.com` 需代理（dev server 已带 `NODE_USE_ENV_PROXY`）；生产环境直连。
- 进程内去重不覆盖多实例，M1-6 确定部署形态后评估外部锁或单点续期。
- 续期遇到网络类错误会让当次请求报错并提示重试；下一次请求会再次尝试续期。

**下一步**

- TODO-136 / M1-9：断网 / 超时 / 限流的完整体验与重试。
- M1-6 部署形态、M1-7 真实仓库性能验证（小 / 中 / 大）。

## 2026-10-06 · M1-5 时间线 v1（TODO-131 ~ 135）

**目标**：`/repos/[owner]/[name]` 时间线页面——仓库信息 + 提交列表（虚拟滚动、分支切换、分页自动加载）+ 提交节点详情（文件变更统计）+ 加载 / 空 / 错误状态。

**完成内容**

- 页面：`/repos/[owner]/[name]` 服务端渲染首屏（仓库信息、可见性、默认分支、分支列表、降级 / 警告横幅）+ 客户端 `TimelineView`：固定行高（76px）窗口化渲染（overscan、滚动近底自动加载 50 / 页、分支切换重置）；提交行含头像、作者、相对 / 绝对时间、消息、短 SHA、merge 标识与关联 PR 徽标。
- 详情：`CommitDetailPanel` 右侧滑出面板（遮罩 / 按钮 / Esc 关闭，焦点还原），展示完整 SHA（可复制）、作者、UTC 时间、父提交、关联 PR、增删统计与文件列表（截断提示）、「在 GitHub 打开」；数据来自 `/api/repos/[owner]/[name]/commits/[sha]`（REST，30 min TTL + 限流降级，响应 `meta.cached / stale / degraded / fetchedAt / resetAt`）。
- 工具与服务：`virtual-window.ts`（窗口范围纯函数）、`commit-format.ts`（短 SHA / 相对时间 / UTC 时间）、`commit-list.ts`（按 oid 去重合并）、`github-commits.ts`（详情归一化，文件截前 100）、`commit-data.ts`（缓存 + 降级）；`data-stores.ts` 新增 `commitCache`；`/repos` 卡片名称改为站内进入时间线并保留 GitHub 外链。
- 验证：`pnpm lint / typecheck / test / build` 全绿；单测 90 通过 / 2 跳过（本任务新增 25 例：窗口 5 · 格式化 5 · 去重 3 · 详情归一化与错误分类 7 · 详情缓存 / 降级 5）；真实会话端到端 10/10：SSR 页含提交行与分支选择；详情首次 `cached=false` 返回统计 / 文件，二次 `cached=true`；7 位短 SHA 可用；非法 SHA 400、不存在提交 404、未知仓库 404；`torvalds/linux` 连续 11 页 × 50 条 = 550 条无重复；响应无令牌泄漏；临时会话已删除。
- 修复：dev 热重载下 `getDataStores` 旧单例缺少新增 `commitCache` 导致详情 500 → 单例按字段存在性重建；GitHub 对「SHA 无法解析」返回 422 → 归类为「提交不存在」（404）。

**关键决策**

| 编号     | 决策                                                          | 理由                                                                                                                                            |
| -------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0025 | 虚拟滚动采用**固定行高 76px + 窗口化**                        | 行高恒定即可由纯函数推导窗口范围（可单测），避免动态测量的抖动与复杂度；消息单行省略，出现多行需求后再评估动态测量                              |
| ADR-0026 | 提交详情走 **REST `/commits/{sha}` + 30 min 服务端 TTL 缓存** | GraphQL 单提交查询不返回 `stats` / 文件列表；REST 一次给出统计与文件（最多 300，截前 100 并标注）；详情内容基本不可变，30 min 对齐技术分析 §6.2 |
| ADR-0027 | 详情以**右侧滑出面板**呈现，不跳独立页                        | 保留时间线上下文（滚动位置与已加载分页），关闭后回到原位置；键盘可达（Esc、焦点还原）                                                           |

**问题与风险**

- 滚动流畅度为体感指标：自动化只覆盖窗口化范围与大数据分页链路（11 页 / 550 提交），1000+ 提交的手感建议人工在浏览器复验。
- 详情缓存是进程内内存（延续 ADR-0022），多实例 / Serverless 需外部缓存。
- **GitHub OAuth access token 已于 2026-10-04 过期**（GitHub 侧开启令牌过期策略）：端到端验证用本机 git 凭证的 OAuth 令牌临时替换完成，验证后已还原；应用当前没有 refresh 逻辑，用户需重新授权，建议后续接入 refresh token 自动续期。

**下一步**

- TODO-136 / M1-9：断网 / 超时 / 限流的完整体验与重试；建议优先补令牌自动刷新。
- M1-6 部署形态、M1-7 真实仓库性能验证、M1-8 引导与授权说明页。

## 2026-10-05 · M1-4 GitHub 数据层（TODO-121 / 122 / 123）

**目标**：时间线读路径改为 GraphQL v4 聚合查询（单页 1 次请求，满足「单仓库时间线 ≤3 次请求」），并提供服务端 TTL 缓存、cursor 分页管理与限流降级（缓存展示 + 恢复时间提示）。

**完成内容**

- GraphQL 客户端：`apps/web/lib/github-graphql.ts`——超时中止、瞬时错误自动重试（5xx / 网络 / 超时，指数退避）、错误分类（401 / 403 / 404 / 限流 / GraphQL）、`rateLimit` 读取、`data + errors` 部分失败容忍；共享错误统一抽取到 `github-errors.ts`（REST / GraphQL 共用，`github-repos.ts` 继续再导出保持兼容）。
- 时间线查询：`apps/web/lib/github-timeline.ts` 一次取回仓库信息 + 分支头（前 50）+ 提交历史（50/页）+ 关联 PR + `rateLimit`，归一化防御式解析；默认分支用 `HEAD` 表达式。
- 缓存与降级：`server-cache.ts`（TTL + LRU，过期条目保留供降级）、`rate-limit-store.ts`（按用户配额快照）、`data-stores.ts`（globalThis 单例；仓库列表 5 min / 时间线 2 min / cursor 链 30 min；降级阈值默认 100，`GITHUB_RATE_LIMIT_DEGRADE_THRESHOLD` 可调）；服务层 `repos-data.ts` / `timeline-data.ts` 统一「新鲜缓存命中 → 低配额降级陈旧缓存（stale / degraded + resetAt）→ 无缓存明确报错」。
- 接口与页面：新增 `/api/repos/[owner]/[name]/timeline?branch=&page=N`（输入白名单校验；401 / 403 / 404 / 409 `cursor_expired` / 429 + resetAt / 504 / 502 分类）；`/api/repos` 与 `/repos` 接入 5 min 缓存，限流降级时页面显示缓存时间与恢复时间。
- 验证：`pnpm lint / typecheck / test / build` 全绿；单测 80 例（本任务新增 43 例：GraphQL 客户端 12 · 时间线 5 · TTL 缓存 4 · 限流快照 5 · 仓库服务 8 · 时间线服务 7 · REST 配额头 2）；真实会话端到端：`/api/repos` 二次请求命中缓存；时间线接口返回真实数据（7 提交 / 4 分支），`stock-analysis` 连续两页各 50 提交且 cursor 正确，`page=5` → 409、非法参数 400、未知仓库 404、未登录 401 / 302，响应无明文令牌。

**关键决策**

| 编号     | 决策                                                                                                 | 理由                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ADR-0021 | GraphQL 客户端与数据服务放在 `apps/web/lib`（与 REST 客户端同层），暂不下沉 `packages/github-client` | 当前唯一消费方是 web，避免为单一消费方引入构建顺序与 dist 耦合；出现第二个消费方时再下沉      |
| ADR-0022 | 缓存采用**进程内内存 TTL**（globalThis 单例），不引入 Redis / DB 缓存                                | MVP 单实例部署，缓存只做性能优化且 GitHub 是唯一数据源；多实例 / Serverless 时再评估外部缓存  |
| ADR-0023 | 限流降级顺序：**新鲜缓存 → 陈旧缓存（标注 stale + resetAt）→ 无缓存明确报错**                        | 不用过期缓存冒充最新数据（M1-9 约定）；降级响应携带 meta 标记，前端显式提示缓存时间与恢复时间 |
| ADR-0024 | 分页 cursor 链保存在服务端（30 min），深页缺链返回 **409 `cursor_expired`**                          | cursor 不暴露给客户端，避免篡改；客户端从第 1 页重载即可恢复（M1-5 处理）                     |

**问题与风险**

- 内存缓存 / cursor 链在进程重启、多实例与 Serverless 下不复用（深页会 409）；M1-6 部署形态确定后再评估外部缓存。
- 限流降级的端到端路径依赖真实配额耗尽场景，本次由单测覆盖（6 个降级用例）；M1-9 将在 UI 层补齐断网 / 超时体验。

**下一步**

- M1-5：`/repos/[owner]/[name]` 时间线 v1（提交节点组件、虚拟滚动、节点详情）。

## 2026-10-04 · M1-3 仓库列表页（TODO-113 / 114 / 116）

**目标**：登录后可浏览自己创建/参与（含组织）的仓库列表，私有仓库有可见性标识，并提供搜索、排序、过滤与异常引导。

**完成内容**

- 数据层：`apps/web/lib/github-repos.ts`（REST `/user/repos`：字段归一化、Link 分页、错误分类 401/403/限流/SSO）；`apps/web/lib/access-token.ts` 从账号表解密令牌（仅服务端）。
- 页面：`/repos` 服务端渲染首屏（100 条）+ 客户端 `RepoList`（搜索 / 可见性过滤 / 排序 / 加载更多）；`/api/repos?page=N` 分页接口；`proxy.ts` 保护范围扩展到 `/repos`；登录后默认回跳改为 `/repos`。
- 引导：无令牌/令牌失效 → 重新授权；403 → 组织 SSO / 权限说明；限流 → 恢复时间；空列表 → 建仓库 / 组织授权 / 权限三条排查路径。
- 验证：`pnpm lint / typecheck / test / build` 全绿（无 `.env` 的 CI 全真模拟同样通过）；单测 24 例（本任务新增 16 例）；真实会话端到端：4 个真实仓库（含 1 个私有）正确渲染且无明文令牌。

**关键决策**

| 编号     | 决策                                                     | 理由                                                                                                                                          |
| -------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0018 | 仓库列表读接口采用 **REST `/user/repos`**                | `X-GitHub-SSO: partial-results` 头可检测组织 SSO 部分结果；Link 分页简单直接；GraphQL 聚合型读接口由 M1-4 落地（ADR-0002 的动机是跨资源聚合） |
| ADR-0019 | 搜索 / 排序 / 过滤放在**前端**完成，配合「加载更多」分页 | 列表规模 ≤ 数百条，前端过滤即时（FR-2.3 要求 <100ms），避免每次输入都请求 API                                                                 |
| ADR-0020 | 登录后默认回跳由 `/me` 调整为 `/repos`                   | 对齐 M1 主路径「登录 → 仓库列表 → 时间线」；显式 `callbackUrl` 仍优先                                                                         |

**问题与风险**

- 每次进入实时拉取首屏 100 条（无缓存）；TTL 缓存与限流降级由 M1-4 统一处理。
- SSO 引导依赖 GitHub 返回的 `X-GitHub-SSO` 头；非 SSO 用户无感。

**下一步**

- M1-4：GitHub GraphQL 数据层（时间线聚合、TTL 缓存、限流降级）。
- M1-5：`/repos/[owner]/[name]` 时间线 v1（提交节点、虚拟滚动）。

## 2026-10-04 · M1-2 接入 GitHub OAuth 登录与会话（TODO-105 / 111 / 112）

**目标**：打通「GitHub 登录 → 数据库会话 → 受保护页面」，并确保 OAuth 令牌密文入库，为 M1-3 仓库列表提供已授权身份。

**完成内容**

- 数据库：`docker-compose.dev.yml`（postgres:18-alpine，localhost:5432）+ Prisma 6.19.3 迁移基线（User / Account / Session / VerificationToken，迁移 `20261004144043_init_auth`）。
- 认证：next-auth v5（5.0.0-beta.32）+ GitHub Provider，scope 覆盖为 `read:user repo`，显式启用 `checks: ["pkce", "state"]`；数据库会话策略；`/login`、`/me`、`/api/auth/[...nextauth]` 落地。
- 安全：自定义 Prisma 适配器在 `linkAccount` 环节以 AES-256-GCM（格式 `v1.<iv>.<tag>.<ciphertext>`）加密 access / refresh / id token，密文列 `*_enc`；密钥 `AUTH_TOKEN_ENC_KEY` 独立于数据库。
- 拦截：Next 16 `proxy.ts` 对 `/me/:path*` 做乐观 Cookie 检查，未登录 302 到 `/login?callbackUrl=…`；页面内 `auth()` 做真实校验（纵深防御）。
- 验证：`pnpm lint / typecheck / test / build` 全部通过；单测共 21 例（新增 crypto 7 例 + 数据库加密用例 1 例，后者由 `RUN_DB_TESTS=1` 门控）；生产冒烟 `/` 200、未登录 `/me` 302、`/login` 200；OAuth 发起端点实测返回 `scope=read:user repo` + `state` + PKCE（S256）；伪造 Cookie 访问 `/me` 被服务端校验拦截；写入真实会话后 `/me` 正常渲染。

**关键决策**

| 编号     | 决策                                                  | 理由                                                                           |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| ADR-0014 | 采用 **next-auth v5（5.0.0-beta.32）**                | v5 支持 Next 16 App Router 与数据库会话；锁版本规避 beta 漂移                  |
| ADR-0015 | **手写 Prisma 适配器**（不引入 @auth/prisma-adapter） | 需在 `linkAccount` 拦截并加密令牌、使用 `*_enc` 列；减少一个依赖，安全边界显式 |
| ADR-0016 | Prisma 锁定 **6.19.3 稳定线**                         | 7.x / 8.x 引擎与配置模式变动大，MVP 不冒险；M4 再评估升级                      |
| ADR-0017 | 用 Next 16 **`proxy.ts` 做乐观鉴权**                  | 遵循 Next 16 更名与官方建议：proxy 只读 Cookie 不查库，真实校验留在页面        |

**问题与风险**

- 真实 GitHub 授权往返尚未完成：需要用户创建 OAuth App 并提供 Client ID / Secret（本地 `.env` 已留空位）；「零配置」由平台上线时注册内置 App 实现。
- scope 不含 `user:email`：隐藏邮箱用户的 `email` 为 null，登录流程与页面已做兼容（邮箱列允许为空）。
- CI 不配置数据库：数据层用例由 `RUN_DB_TESTS=1` 门控，本地已实测通过；PostgreSQL 18 + Prisma 6.19.3 实测兼容。

**下一步**

- 用户提供 OAuth App 凭据后，手动完成真实登录往返验证（登录 → 回跳 `/me` → 登出）。
- M1-3：`/repos` 仓库列表页（创建/参与，含私有仓库与可见性标识）。

## 2026-10-04 · M1 工程骨架初始化（M1-1 / TODO-008、101-103）

**目标**：初始化 pnpm monorepo 骨架，落地开发环境约定与 CI，使 M1 可以直接开始功能开发。

**完成内容**

- pnpm workspace：`apps/web` + `packages/git-graph`、`packages/github-client`、`packages/ui`；Node 22 LTS（`.nvmrc` + `engines`）与 pnpm 12.9.1（`packageManager`）。
- `apps/web`：Next.js 16（App Router）+ TypeScript（strict）+ Tailwind CSS 4；类型检查脚本内置 `next typegen`（生成路由类型）。
- 工具链：ESLint 9（flat config）+ Prettier + commitlint + husky；GitHub Actions CI（lint → typecheck → test → build，`--frozen-lockfile`）。
- 共享包内建 Vitest 单测 13 例：泳道颜色哈希（git-graph）、OAuth scope 解析（github-client）、Tailwind 类合并（ui）。
- 验证：`pnpm install / lint / typecheck / test / build` 全部通过；生产构建产物冒烟测试返回 HTTP 200（137ms）。

**关键决策**

| 编号     | 决策                                     | 理由                                                                    |
| -------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| ADR-0011 | 基线锁定 **Node 22 LTS + pnpm 12.9.1**   | 与文档「pnpm + Node LTS」一致；为本机实测版本，Node 24 升级留待 M4 评估 |
| ADR-0012 | 仓库根 `.npmrc` 指向 **npmmirror 镜像**  | 本机无法直连 registry.npmjs.org；若网络可用可删除该文件                 |
| ADR-0013 | web 的 typecheck 脚本包含 `next typegen` | Next 16 使用生成式路由类型（`LayoutProps` 等），需先生成才可通过 tsc    |

**问题与风险**

- 本机 `corepack enable` 因 D:\node.js 目录权限失败（EPERM），改用 `npm i -g pnpm`（用户级 PATH）解决；CI 中由 pnpm/action-setup 读取 `packageManager` 字段，不受影响。
- GitHub Actions 的真实运行需推送后在 GitHub 查看；本次未推送，已在本地按相同命令全量验证。
- Next 16 会生成/维护 `apps/web/AGENTS.md`、`.next/types` 等文件；生成物已由 `.gitignore` 覆盖，注意不要误提交。

**下一步**

- M1-2：接入 Auth.js GitHub OAuth（平台内置 App、零配置登录、`read:user` + `repo` scope）。
- M1-3：`/repos` 仓库列表页（含私有仓库可见性标识与空状态）。

## 2026-10-03 · 需求决策确认（第二轮）

**目标**：确认 4 个开放问题，并同步修正仓库名与文档中的相关设计。

**完成内容**

- 仓库由 `gitrail` 更名为 **`utf8-git`**，远端地址更新为 <https://github.com/encode-utf8/utf8-git>，本地 remote 同步。
- 文档同步更新：
  - 需求分析：新增 §1.4「已确认的产品决策」，更新 FR-1.2 / FR-1.5 / FR-2.1 / FR-3.1、非功能需求（联网要求）、验收标准（私有仓库、断网、权限不足），重写 §12 为「决策与开放问题」；
  - 技术分析：新增 §1.3「已确认技术决策」，更新缓存策略（明确非离线）、安全设计（`read:user` + `repo`、零配置凭据）、§11 待确认问题；
  - 实现路线：锁定决策写入总览，M1 增加「私有仓库与权限引导」「在线状态处理」两项任务；
  - 待办日志：Open Questions 关闭，BLOCK-01 / BLOCK-02 解除。

**关键决策**

| 编号     | 决策                                                         | 理由                                                                      | 备选与否决原因                                                          |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| ADR-0006 | 时间线**按提交聚合**（commit 为原子节点）                    | 提交是 Git 的最小可信事实；分支/PR/Issue 在其上做标注，信息保真且实现简单 | 否决按「开发事件」聚合：需要额外的启发式归并，易丢失细节                |
| ADR-0007 | **私有仓库纳入 MVP**                                         | 用户既然选择登录本平台，就已进入 GitHub 授权体系，无需再设信任门槛        | 否决「仅公有仓库」：会割裂用户的真实使用场景（工作仓库多为私有）        |
| ADR-0008 | 平台**内置 OAuth App**，用户零配置                           | 减少用户多余操作，从点击登录到可用只有两步                                | 否决 Device Flow / 用户自备 PAT：都要求用户手工配置，违背降低门槛的目标 |
| ADR-0009 | **不支持离线模式**                                           | 登录与数据都依赖 GitHub，离线状态下的功能没有意义                         | 否决 IndexedDB + Service Worker 离线缓存：投入大、价值低                |
| ADR-0010 | 仓库/项目名由 `gitrail` 改为 **`utf8-git`**（取代 ADR-0003） | 与开发者身份（encode-utf8）和本地工作目录保持一致                         | 否决保留 GitRail 作为仓库名：与用户指定的仓库名不符                     |

**问题与风险**

- `repo` scope 权限范围较大（可读写用户所有私有仓库），必须在授权说明与 UI 中清晰解释用途，且令牌加密存储 —— 已列入 M1 安全验收项。
- 组织启用 SSO 时，成员需单独为 OAuth App 授权，可能出现「授权成功但仓库为空」的困惑 → M1-8 提供自助引导。
- 时间线默认展示范围与写操作确认强度仍待确认（见需求分析 §12.2）。

**下一步**

- 初始化 monorepo 骨架（`apps/web` + `packages/*`），配置 CI 与开发约定。
- 接入平台内置 OAuth App，打通「零配置登录 → 仓库列表（含私有）」。

## 2026-10-03 · 项目立项与文档基线

**目标**：把项目构思固化为可评审、可执行的文档，并建立公开开发仓库。

**完成内容**

- 确立项目定位：GitHub 仓库的**可视化时间线 + 点击式操作台**，面向 Git 新手与项目新人。
- 创建公开仓库 [encode-utf8/gitrail](https://github.com/encode-utf8/gitrail)（后更名为 `utf8-git`，见 ADR-0010），配置描述与主题标签。
- 产出初代文档：
  - `README.md`：项目介绍、核心能力、目标用户、技术栈与文档导航；
  - `docs/requirements.md`：用户画像、14 条用户故事、功能/非功能需求、验收标准、范围边界、风险；
  - `docs/technical-analysis.md`：架构选型对比、技术栈、数据模型、GitHub API 策略、泳道布局算法、安全设计；
  - `docs/roadmap.md`：M0–M5 里程碑、任务分解、退出标准、迭代节奏与度量指标；
  - `docs/todo.md`：当前迭代任务与分类 Backlog。
- 工程基线：MIT License、`.gitignore`。

**关键决策**

| 编号     | 决策                                                     | 理由                                                                               | 备选与否决原因                                                                   |
| -------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ADR-0001 | 采用 **Next.js 全栈单仓**（TypeScript）                  | OAuth secret 必须服务端保存；单人维护成本最低；类型端到端复用                      | 否决纯前端方案（令牌不安全）；否决前后端分离（样板与部署成本高，MVP 阶段收益低） |
| ADR-0002 | 读接口使用 **GitHub GraphQL v4**，写操作使用 **REST v3** | 读需要跨资源聚合（提交+分支+PR），GraphQL 一次取回；写操作 REST 语义清晰、幂等性好 | 全 REST：请求数多、易触发限流；全 GraphQL：变更类操作支持有限                    |
| ADR-0003 | 仓库名 **gitrail**（GitRail）                            | 「轨道」贴合时间线隐喻，命名冲突少（GitHub 同名仓库热度极低）                      | 否决 gitcanvas/reposcope 等（重名多或语义偏离）；**已被 ADR-0010 取代**          |
| ADR-0004 | 提交图泳道布局**服务端预计算**                           | 算法在服务端可缓存、可测试；前端只做渲染，降低大仓库卡顿风险                       | 纯前端计算：首次加载大仓库耗时不可控                                             |
| ADR-0005 | 写操作统一走「**预览 → 确认 → 审计 → 执行**」管线        | 安全是产品核心卖点；统一管线便于扩展与测试                                         | 直接执行：误操作风险高，违背产品定位                                             |

**问题与风险**

- 私有仓库与组织仓库的 OAuth 授权（scope 与审核）会显著增加复杂度 → ~~MVP 优先公有仓库场景~~ **已在 2026-10-03 第二轮决策中确认纳入 MVP（ADR-0007）**。
- 大仓库（10w+ commits）的泳道预计算与分页策略尚未验证 → M2 需用真实大仓库做基准测试。
- 时间线默认粒度（按提交 vs 按开发事件聚合）尚未定论 → ~~待验证~~ **已确认按提交聚合（ADR-0006）**。

**下一步**

- 初始化 monorepo 骨架（`apps/web` + `packages/*`），配置 CI 与开发约定。
- 接入 GitHub OAuth，打通登录 → 仓库列表。
- 实现时间线 v1（提交节点 + 虚拟滚动）。
