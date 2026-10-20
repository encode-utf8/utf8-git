# 待办日志（TODO）

| 项       | 内容                                                    |
| -------- | ------------------------------------------------------- |
| 文档版本 | v0.2                                                    |
| 更新日期 | 2026-10-11                                              |
| 标记约定 | `[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成 · `[!]` 阻塞   |
| 关联文档 | [实现路线](roadmap.md) · [开发记录](development-log.md) |

---

## 1. M0 · 立项与文档（已完成）

**迭代目标**：文档基线可评审，M1 可直接开工。

- [x] TODO-001 创建公开开发仓库（含描述与主题标签）
- [x] TODO-002 编写 README（项目介绍 + 文档导航）
- [x] TODO-003 编写需求分析文档
- [x] TODO-004 编写技术分析文档
- [x] TODO-005 编写实现路线文档
- [x] TODO-006 建立开发记录与待办日志机制
- [x] TODO-007 确认 4 个 Open Questions：按提交聚合 / 私有仓库进 MVP / 零配置登录 / 不支持离线（2026-10-03 已确认，见需求分析 §12、ADR-0006~0009）
- [x] TODO-008 确定包管理器与运行时版本（pnpm + Node LTS）并写入文档
- [x] TODO-009 补充 Issue / PR 模板与贡献指南（`CONTRIBUTING.md` + `.github/PULL_REQUEST_TEMPLATE.md` + `.github/ISSUE_TEMPLATE/*`）

## 2. M1 · 只读最小闭环（已完成）

### 2.1 初始化（工程）

- [x] TODO-101 初始化 monorepo（pnpm workspace：`apps/web`、`packages/*`）
- [x] TODO-102 配置 ESLint + Prettier + commitlint（Conventional Commits）
- [x] TODO-103 搭建 GitHub Actions CI（lint → typecheck → test → build）
- [x] TODO-104 配置 Vercel 预览环境与生产环境、环境变量管理（2026-10-07 上线：<https://utf8-git.vercel.app/>，Neon 迁移已应用，未登录路径与 OAuth 跳转验收通过，见 `docs/reports/tech-analysis/M1-6-deployment-verification.md`；预览域名 OAuth 回调和浏览器登录仍待补）
- [x] TODO-105 初始化 PostgreSQL + Prisma 迁移基线（本地 Docker 开发库；Neon/Supabase 随 TODO-104 接入）

### 2.2 账号与仓库

- [x] TODO-111 接入 Auth.js GitHub Provider（含 PKCE 与 state；平台内置 OAuth App 随上线注册）
- [x] TODO-112 会话持久化 + 令牌加密存储（AES-256-GCM）
- [x] TODO-113 `/repos` 仓库列表页（创建/参与，**含私有仓库与可见性标识**，排序、空状态）
- [x] TODO-114 仓库搜索与可见性过滤
- [x] TODO-115 `repo` scope 授权说明页（新增公开页 `/permissions` + `lib/permissions.ts`；登录页与 `/repos` 授权不足提示均链向该页）
- [x] TODO-116 组织 SSO / 权限不足的自助引导（授权成功但仓库为空的排查路径）
- [x] TODO-117 OAuth 令牌自动续期（refresh token 轮换入库）

### 2.3 数据层

- [x] TODO-121 GitHub GraphQL 客户端封装（错误、重试、限流读取）
- [x] TODO-122 查询结果缓存（TTL + 分页 cursor 管理）
- [x] TODO-123 限流降级策略（缓存展示 + 恢复时间提示）

### 2.4 时间线 v1

- [x] TODO-131 时间线页面骨架（仓库信息 + 提交列表）
- [x] TODO-132 提交节点组件（作者、时间、消息、SHA）
- [x] TODO-133 虚拟滚动（支持 1000+ 提交）
- [x] TODO-134 节点详情面板（文件变更统计、跳转 GitHub）
- [x] TODO-135 加载骨架屏与错误/空状态设计
- [x] TODO-136 在线状态处理：断网 / 超时 / 限流提示与重试（不提供离线模式）

### 2.5 验证

- [x] TODO-141 关键路径单元测试（数据层 + 限流降级；数据层部分随 M1-4 完成）
- [x] TODO-142 E2E：登录（mock）→ 选仓库 → 浏览时间线（`apps/web/e2e/*`；CI `e2e` 任务全绿，run 37894962579：4 passed）
- [x] TODO-144 部署自检（`GET /api/health` + `pnpm deploy:selfcheck`；见 `docs/deployment.md` §3.2）
- [x] TODO-143 用 3 个真实仓库（小/中/大）做性能验证（`scripts/perf-validate.mjs` + `docs/reports/tech-analysis/M1-7-perf-validation.md`）

## 3. Backlog（未排期）

### 3.1 产品

- [ ] TODO-201 时间线粒度为「按事件聚合」的视图（里程碑/发布）
- [ ] TODO-202 仓库健康度提示（僵尸分支、陈旧 Issue）
- [ ] TODO-203 新用户引导（首次使用教学路径）
- [ ] TODO-204 贡献热力图与「谁在做什么」视角

### 3.2 可视化

- [x] TODO-211 泳道布局算法包（`packages/git-graph`：`computeLaneLayout` 内核 + `sliceLaneLayout` 窗口切片 + 合成历史 / 单测 / 性能护栏）
- [x] TODO-212 分支泳道渲染（SVG 分层渲染 + 虚拟窗口已落地，50 分支 / 5050 提交基准与 E2E 断言齐备；PR / Issue 事件标注见 TODO-215）
- [ ] TODO-213 时间缩放与范围切换
- [x] TODO-262 横向时间轴画布（用户要求：可拖元素收进一张画布，分支方块在上、提交在下，时间轴改为左右轴）：**布局内核** `lib/horizontal-timeline.ts`（11 条单测：x 按真实时间线性映射 + 最密泳道反推 scale + 同泳道最小间距兜底 + 按月刻度抽稀 + 二分可视裁剪）；**画布组件** `horizontal-canvas.tsx`（sticky 时间标尺 + 泳道轨 + 跨泳道父子曲线（S 形贝塞尔，边色取 `LaneEdge.color`）+ 绝对定位卡片虚拟裁剪 + 徽标带状态文案）；**接线**（resetKey 切分支滚到最新端；filterKey 筛选后重新锚定到选中/最旧结果；onScrollerChange 边缘自动滚动改横向；onReachOldest 滚到左端加载更多）；**删除竖版死代码**（lane-graph.tsx / lane-geometry.ts / virtual-window.ts 及各自测试）；E2E 迁移两处（泳道图 circle→line/path；拖拽建分支改水平向左）。设计迭代两轮：补跨泳道父子曲线、定时间比例 + 左旧右新 + 固定顶栏（文档 `docs/design/repo-canvas-horizontal-v1.html`）。决策 ADR-0163~0166\n- [x] TODO-261 P1 收尾：① **拖拽按帧合并**（`lib/frame-coalescer.ts`，5 条单测；提交拖拽 + 分支拖拽；复测：1000 次 pointermove / 60fps 下 setState 从 1000 次降到 63 次，数字已固化进单测）；② **边缘自动滚动按需启停**（只在指针进入边缘带时跑 rAF，离开即停，消除拖动全程空转）；③ **时间刷子拖动期间冻结域**（min/span 在 pointerdown 快照，避免域变化导致 ratio↔时间 映射错位；域随「加载更多」变宽属预期，选择是绝对时间）。决策见 ADR-0160~0162
- [x] TODO-260 P1 第三块：① **手势速查条**（`gesture-guide.tsx`，首次进入流内显示、三条手势各配小示意图、「知道了」写 localStorage、工具栏「?」可重开；选流内而非浮层，避免挡住第一次点击）；② **拖到边缘自动滚动**（`lib/edge-scroll.ts` 纯函数算步长 2–16px/帧、容器窄于两倍边带不滚；芯片条横向 + 提交画布纵向各接一处，芯片条滚动后重新命中检测；顺带补提交拖拽的 `pointercancel` 清理）；③ **菜单键盘导航**（打开聚焦首项、↑↓ 循环、Home/End、Tab 收起、Esc 关闭并把焦点还给触发器，容器 `tabIndex={-1}`）。决策：不做像素级自由缩放（固定行高虚拟列表 + 时间缩放已由刷子承担，见 ADR-0155）
- [x] TODO-259 可发现性三连修：① 删除区从「右下角小白块（拖动时才出现）」改为**常驻右侧竖轨**（贴画布右边、整幅高度命中区、红色三态：常驻淡红 / 拖动转亮红 / 进入变实心红「松手删除」；`pointer-events-none` 常开 + 几何命中，提交列表 `pr-14` 避让；读屏隐藏，点击等价路径是芯片菜单）；② 芯片「⋯」菜单点击无效的真因是**被芯片条 `overflow-x-auto` 裁掉**（Playwright 可见性检查不查裁剪所以 E2E 一直绿）——菜单改 `position: fixed` 渲染在滚动容器外 + 实测坐标定位 + 越界钳制 + 滚动关闭，外部点击关闭改冒泡阶段并排除触发器，修掉「先被外部监听关掉再被 click 重开」的开合混乱；E2E 加 `position: fixed` 与视口内回归守卫；③ 重写首页落地页（hero + 纯 CSS 界面示意 + 四特性 + 三步开始 + 四篇文档链接 + 快速链接 + scope 说明，已登录直通 /repos）
- [ ] TODO-258 画布化 P1（拖分支开 PR 已落地：芯片拖到另一芯片 = head→base 预填新建 PR 面板 + 悬停高亮 + 当前分支自动滚回；顺带修复拖删除的三层问题——删除确认改居中浮层、提交落点限定画布内、E2E 先滚到可见；时间刷子已落地（`time-brush.tsx` + 自定义时间窗过滤）。余下：画布缩放与平移、首次进入的手势引导层、拖到边缘自动滚动）
- [x] TODO-257 仓库详情页画布化 P0（从「列表 + 表单」到「画布 + 手势」：视觉方案 `docs/design/repo-canvas-v1.html`；分支芯片条替代 `<select>`（点击 / Enter 切换，鼠标可拖）；删除区平时隐藏、拖动分支芯片时浮出，拖入只发起删除、仍走确认面板（新增 `initialBranchName` 预选）；拖提交到空白处 → 落点就地命名气泡（8px 阈值区分拖动与点击、预填 `feature/<短 SHA>`、Enter 确认 / Esc 取消）；显示密度 36 / 52 两档做成用户选项（`lib/timeline-density.ts` + localStorage，行高固定故虚拟窗口与泳道切片不变）；提交详情从右侧抽屉改为右下角固定卡片（边框 + 阴影 + 浅色标题栏，遮罩降到 10%，保留 `role="dialog"` 与焦点陷阱）；按钮工具栏保留为键盘 / 无障碍等价路径。P1 待续：画布缩放与平移、时间刷子、分支拖分支径向菜单、手势引导层）
- [ ] TODO-214 时间线导出（图片 / 链接分享）：**链接分享已完成**（`lib/timeline-share.ts` 编解码 + 10 条单测；分支 / 关键词 / 作者 / 事件类型 / 时间范围 / 自定义窗口 / 密度 / 解释模式进 URL；挂载后恢复、300ms 防抖 replaceState 回写；工具栏「分享链接」复制 + 手动复制降级；E2E 两条）。**图片导出待评估**：html2canvas 与 Tailwind v4 的 oklch 颜色不兼容、跨域头像要额外代理；候选路线为泳道图 SVG 导出（零依赖，仅图形）或服务端截图（成本高）
- [x] TODO-215 PR / Issue 关联标注（M2-3：GraphQL 聚合 `closingIssuesReferences` 并挂载到关联提交；行内标注与详情面板均可跳转 GitHub）
- [x] TODO-216 时间线过滤与搜索（M2-4：关键词 / 作者 / 事件类型客户端即时过滤；分支维度沿用分支选择器；过滤 < 100ms）
- [x] TODO-217 时间线时间范围缩放（M2-5：近一周 / 近一月 / 全部；切换范围时把选中提交重新锚定，保持上下文）
- [x] TODO-218 概念解释层（M2-6：术语悬浮卡片 + 关闭 / 新手 / 进阶模式；默认关闭，localStorage 记忆选择，不干扰老用户；后续补全：`branch` 词条与 `pull-request` / `issue` 说明覆盖「是什么 + 会产生什么作用」，分支选择器与新建分支 / 新建 Issue / 新建 PR / 删除分支 / 恢复分支等操作入口在解释开启时同步展示「?」提示与内联概念说明 `concept-note.tsx`）

### 3.3 操作能力

- [x] TODO-221 操作编排框架（M3-1：统一管线 `lib/operations.ts`（确认 + 幂等 + 审计）+ 确认卡片 `confirm-card.tsx` + 审计表 `operation_audit`，内存 / Postgres 双实现随 `STORE_BACKEND` 切换）
- [x] TODO-222 创建分支（M3-2：`POST /api/repos/[owner]/[name]/operations/create-branch` 走统一管线；分支名校验 + 提交 SHA 起点；时间线「新建分支」确认卡片，成功后 `router.refresh()` 即时更新分支列表）
- [x] TODO-223 创建 Issue（M3-3：`POST /api/repos/[owner]/[name]/operations/create-issue` 走统一写管线；标题 / 标签校验 + 正文长度上限；时间线「新建 Issue」面板含标题 / 正文 / 标签三段表单与 Markdown 预览（先解析成结构再渲染，不注入 HTML），成功后刷新并提示编号）
- [x] TODO-224 PR 流程（M3-4：建 PR + 合并。`POST .../operations/create-pull-request`（base / head + 标题 + 正文 + 草稿；标题必填、分支须合法且不能相同）与 `GET/POST .../operations/merge-pull-request`（只读可合并性检查 + 确认合并）都走统一写管线；`lib/pull-ops.ts` 按「已合并 / 已关闭 / 草稿 / 冲突 / 保护规则 / 计算中」判定并给出原因；时间线「新建 PR」面板（分支选择 + Markdown 预览 + 草稿开关），提交详情对 OPEN 的关联 PR 提供「合并 PR」入口与合并方式选择，不可合并时只解释原因、不提供执行入口）
- [x] TODO-225 删除分支（M3-5：`GET/POST .../operations/delete-branch`（分支选择 → 服务端预检默认 / 保护 / 当前分支 → 影响预览 → 确认删除）；`lib/branch-delete-ops.ts` 按「默认分支 > 受保护分支 > 当前查看的分支」判定并给出原因；`lib/github-branch-settings.ts` 读仓库默认分支与 `branches/{branch}` 的 `protected`（不用需 admin 权限的 protection 端点）；`github-branches.ts` 的 `deleteBranchRef` 走 `DELETE /git/refs/heads/{branch}`；时间线「删除分支」面板，不可删除时只解释原因、不提供执行入口）
- [x] TODO-226 24h 撤销 / 分支恢复（M3-6：`GET/POST .../operations/restore-branch`——GET 从写操作审计列出近 24h 内本用户成功删除、且保存了分支头 SHA 的记录；POST 以删除记录的幂等键为凭据（服务端校验归属 / 类型 / 状态 / 时间窗）用 `createBranchRef` 重建引用；`lib/branch-restore-ops.ts` 负责窗口判定与剩余时间文案；`operationAudit.list` 支持按 `kind` / `status` 过滤；时间线「恢复分支」面板展示候选与限制说明，恢复后 `router.refresh()`，打开任写操作面板会清掉上一次的成功提示）
- [x] TODO-227 操作历史与等价 Git 命令展示（M3-7：新增只读页 `/repos/[owner]/[name]/operations`，按时间倒序列出本用户在该仓库的写操作审计（`latestPerIdempotencyKey` 把 started / 终态收敛为一条，含失败记录），每条给出操作类型 / 状态 / 时间 / 摘要 / 失败原因 / 等价 Git 或 gh 命令 / 结果链接；`lib/git-commands.ts` 负责命令与链接映射，`operations.ts` 导出 `OPERATION_KIND_LABEL` 共用文案；时间线头部新增「操作历史」入口；M3-8 尾巴补上按状态筛选与按操作条数分页（每页 20 条））

### 3.4 安全与合规

- [x] TODO-231 写操作频率限制与防重放（M3-8：`lib/write-rate-limit.ts` 按「用户 + 滑动窗口」判定（默认 20 次 / 分钟，`WRITE_OPERATION_LIMIT` / `WRITE_OPERATION_WINDOW_MS` 可调），计数复用写操作审计的 `started` 记录（`OperationAuditStoreLike.count`，内存 / Postgres 双实现），6 个写接口在调用上游前统一走 `enforceWriteRateLimit`，超限返回 429 + `Retry-After`；防重放：`runOperation` 的幂等回放限定在 10 分钟窗口内（`isWithinReplayWindow`），过期记录按新意图重新执行，避免同参数的新操作被历史成功记录静默吞掉；顺带修既有问题——审计保留期（`prune` + `OPERATION_AUDIT_RETENTION_DAYS`，默认 90 天，写入时按概率清理）与写操作网络失败自动重试（`fetchJsonWithRetry`，只重试「没拿到响应」的网络失败，4xx / 5xx 原样交给调用方；`Retry-After` 按窗口内最早一条记录的剩余时间给出，回放窗口可用 `WRITE_OPERATION_REPLAY_WINDOW_MS` 调整））
- [x] TODO-232 用户数据清除与授权撤销（M3-9：`/me` 新增「已授权信息」（scope 取自账号记录、令牌有效期、审计条数）与「危险操作」区——「撤销 GitHub 授权」「清除我的数据」都先弹 `ConfirmCard` 影响预览再执行；接口 `POST /api/account/revoke` / `POST /api/account/purge` 走统一写管线（确认 + 审计 + 频率限制，`replayWindowMs: 0` 保证破坏性操作每次真正执行）；`lib/account-ops.ts` 负责描述符与失败文案（账号级操作挂在约定的 `account/self` 作用域下），`lib/github-app-authorization.ts` 调 GitHub `DELETE /applications/{client_id}/token`（404 视为「已不可用」），`lib/account-data.ts` 负责清除顺序（审计 → 令牌 / 会话 → 缓存 → 配额快照 → 用户记录，撤销则保留审计与用户记录）；`OperationAuditStoreLike.deleteByActor`（内存 / Pg）与 `invalidateUserCaches`（按 `cacheKey(scope, userId)` 前缀清四类缓存）为新增数据层能力；`/permissions` 说明页补充一键撤销入口）
- [x] TODO-233 审计日志导出（`GET /api/account/audit/export?format=csv|json` 导出当前用户全部仓库的写操作审计；`lib/audit-export.ts` 负责 CSV（RFC 4180 转义 + BOM）/ JSON（`exportedAt` / `count` / `operations`）与文件名 `utf8-git-audit-YYYYMMDD.<fmt>`，条目复用 `git-commands` 的等价命令 / 结果链接并做稳定投影；`latestPerIdempotencyKey` 收敛与操作历史页同口径，预取 3000 条原始记录、最多导出 1000 条操作；`/me` 新增「导出操作审计」区；`operations.ts` 抽出 `OPERATION_STATUS_LABEL` 供历史页与导出共用。见 `docs/development-log.md` 2026-10-11 记录）

### 3.5 工程化

- [x] TODO-241 可观测性（M4-1：`lib/redact.ts` 统一脱敏（连接串 / GitHub 令牌 / 敏感键名），`lib/health.ts` 的 `redactConnectionInfo` 改为复用；`lib/logger.ts` 一行一条 JSON 的结构化日志（`LOG_LEVEL` 控制级别，字段先脱敏再落盘，sink 抛错不影响主流程）；`lib/observability.ts` 提供请求关联 id（复用 `x-request-id` 或生成并随响应头回写）、`reportError`（结构化错误日志 + 可选 POST 到 `ERROR_REPORT_ENDPOINT`）与 `withObservability` 路由包裹器（记录 `route` / `method` / `path` / `status` / `durationMs`，抛错转 500 并上报一次，5xx 也上报）；`instrumentation.ts` 的 `onRequestError` 兜住服务端组件 / Server Action 的未捕获异常；12 个 API 路由（除 Auth.js `[...nextauth]`）统一接入）
- [x] TODO-242 性能基准测试（M4-2：`packages/git-graph/src/layout.bench.ts` 输出 min / median / p99 的 Markdown 表（`pnpm --filter @utf8-git/git-graph bench`），覆盖 1000 / 10000 节点的深链、默认并发与满并发；CI 护栏 `layout.perf.test.ts` 扩到万级。基准暴露「切片耗时与总线段数成正比」，改为按 `row` 二分定位窗口区间后，万级满并发切片 median 6.379ms → 0.028ms，并用「逐窗口与朴素过滤等价」单测固定该不变式。结果见 `docs/reports/tech-analysis/M4-2-layout-benchmark.md`）
- [x] TODO-243 国际化框架（M4-3：`apps/web/lib/i18n` 自建轻量 i18n——语言清单 / 默认语言 / 语言偏好 Cookie 与 `resolveLocale`（Cookie 优先，`Accept-Language` 按 q 值兜底，纯函数可单测）；消息目录以中文为源语言（`messages/zh-CN.ts`）并用 `typeof` 推导类型约束英文目录（`messages/en.ts`），键名是点号路径联合类型、支持 `{name}` 插值、回退链「当前语言 → 中文 → 键名」；服务端 `getTranslator()` 与客户端 `LocaleProvider` / `useTranslator()` 两个入口；`LocaleSwitcher` 经 Server Action 写 Cookie 后 `router.refresh()`；首批迁移根布局元信息 + 断网横幅 + 登录页 + 授权说明页（`lib/permissions.ts` 的 scope 文案改为消息键），其余界面见 TODO-247）
- [x] TODO-244 可访问性审查（M4-4：键盘可达 + 对比度全量审查；修复提交行 / 搜索框焦点不可见、详情抽屉 Tab 逃逸（焦点陷阱）、占位符与两处正文对比度不足、补 skip link 与时间线 / 操作历史页 `main` 地标；报告见 `docs/reports/tech-analysis/M4-4-a11y-audit.md`）
- [x] TODO-245 依赖更新与安全扫描（`.github/dependabot.yml` 双 ecosystem——pnpm（周一组 PR、minor/patch 合组、major 独立）+ github-actions，提交信息 `chore(deps)` / `chore(ci)` 前缀；CI verify 新增 `Security audit (pnpm audit)` 门禁，等级 / 容忍清单集中于 `pnpm-workspace.yaml` 的 `audit:` 段；deepmerge-ts GHSA-ggr8-5vv4-36mx 用 overrides 强制 `^8.0.2` 修复（prisma 6 全系锁 7.1.5 无升级路径，`postinstall: prisma generate` 为兼容性金丝雀）；braces GHSA-vfj7-8cjw-p6xm 无补丁且仅 dev 链，显式 `audit.ignore` 登记；顺带接入 `eslint-plugin-jsx-a11y` recommended 规则集——现存代码 0 违规）
- [x] TODO-246 服务端泳道缓存 / 增量布局（commit `0b3ed6c`：`git-graph` 新增 `LaneComputation`（push 幂等续算 / snapshot 中途快照 / finish 与全量逐字段一致，8 组分片等价性用例）；`apps/web/lib/lane-layout.ts` 内容指纹（双 FNV-1a + 长度 + 首尾 oid）键控内存 LRU + TTL 缓存，仅首页布局随响应下发（`meta.laneLayoutCached`），深页客户端增量续算；客户端三路复用：服务端布局采用 → 无过滤尾部追加增量续算 → 其余全量重算，布局经 layout effect 回填）
- [x] TODO-247 已登录界面文案迁移到消息目录（仓库列表 / 时间线 / 提交详情 / 各操作面板 / 账号页与操作历史页，含 `lib/error-state.ts` 与 `client-fetch` 的错误与空状态文案）：纯逻辑层加 `Translate = sourceTranslate` 末位可选参数，组件传当前语言、API 路由与单测不传；`ops.history` / `ops.link` / `ops.export` / `ops.account` / `errors.*` / `me.*` / `commitDetail.*` 等键补齐，`apps/web/app/**` 已无硬编码中文；英文路径暂无 E2E，时间格式未本地化）
- [x] TODO-248 覆盖率门禁进 CI 与关键路径 E2E 补强（M4-5：各包新增 vitest coverage 阈值——git-graph 85%（96.06 / 87.8 / 100 / 97.27）、github-client 与 ui 70%（均 100%）、apps/web lib 70%（88.18 / 81.19 / 80.42 / 88.37，排除 i18n messages / prisma / auth），根 `test:coverage` 脚本 + CI verify 步骤改为 `pnpm test:coverage`，覆盖率不达标即 CI 失败；新增 `e2e/a11y.spec.ts` 3 条（skip link 首聚焦 + 回车进主内容、提交行键盘焦点描边 ≥2px、已登录英文路径切换）；skip link 移至文档首位。commit `c07f3a9` CI verify / e2e 双 job 全绿）
- [x] TODO-255 质量收尾（M4-8：① 写操作 API 契约层 E2E——`timeline.spec.ts` 已覆盖六个写操作的 UI 流，新增 `e2e/operations-api.spec.ts` 4 条补服务端契约：未登录 401（先于一切校验）、入参校验 400（确认位 / SHA / 分支名 / 仓库名 / 非 JSON 体，异常参数不进上游）、成功 201 + 同负载重放 200 `replayed` 且逐字段一致（若重复执行 mock 会 422，故 200 即「未重复执行」的证明）、异名幂等键另一次真实执行、上游冲突 422 `branch_conflict`；分支名带运行 nonce + 重试序号，规避本地复用 webServer 与 CI 重试的状态残留；② prettier 存量漂移清零（10 个文件：3 份 docs、2 个 Issue 模板、2 个测试、bench）+ CI verify 新增 `Format (prettier --check)` 门禁；③ M4 退出标准核对清单——「2 周无 P0」定义事故分级与数据源（withObservability 日志 / ERROR_REPORT_ENDPOINT）、「核心操作成功率 ≥ 99%」定口径为审计按幂等键收敛后 succeeded ÷ (succeeded + failed)（重放与 4xx 校验失败不进分母）、确认贡献指南已具备而发布说明缺失 → TODO-256；清单见 `docs/reports/tech-analysis/M4-exit-criteria-checklist.md`）

### 3.6 文档与社区

- [x] TODO-251 部署与自建指南（含自建 OAuth App 步骤）（`docs/self-hosting.md`：三条路径对比并**标注验证状态**（Vercel 已用于生产站 / 单机 Node 的启动路径有 CI 覆盖 / 不提供未验证的 Docker 镜像）；自建 OAuth App 逐步（创建三项、回调地址「一个 App 只能填一个 + 逐字符一致 + 无结尾斜杠」、`read:user repo` 的取舍、5 类授权失败对照表）；单机部署全流程（建库 → 装依赖 → `.env` 最小集含 `AUTH_TRUST_HOST` / `AUTH_URL` → `migrate deploy` → `build` → `next start -H 127.0.0.1` → systemd unit → Nginx 反代透传 `Host` / `X-Forwarded-Proto` → certbot）；运维手册（升级顺序「先迁移后重启」、回滚靠前向兼容而非 down、`pg_dump` / 恢复演练、日志与 `x-request-id`、三个密钥的轮换后果差异、单实例 vs 多实例）；`deploy:selfcheck` 自检与人工关键路径；已知限制与 `deployment.md` 分工互链）
- [ ] TODO-252 架构决策记录（ADR）目录化，迁移 development-log 中的 ADR
- [ ] TODO-253 贡献指南与开发环境说明
- [ ] TODO-254 用户手册 / 演示视频
- [ ] TODO-256 对外发布说明（Release Notes，M4 退出标准第 3 条缺口）：上线时随版本在 GitHub Releases 产出首篇，结构为版本亮点（M0–M4 能力一览）→ 破坏性变更 / 升级步骤 → 已知问题与限制（英文路径 E2E 未覆盖、时间格式未本地化）→ 致谢与反馈入口；口径见 `docs/reports/tech-analysis/M4-exit-criteria-checklist.md`

## 4. 阻塞与依赖

| 编号         | 事项               | 阻塞对象             | 需要的决策/资源                                      |
| ------------ | ------------------ | -------------------- | ---------------------------------------------------- |
| ~~BLOCK-01~~ | ~~私有仓库支持~~   | 已解除（2026-10-03） | 已确认纳入 MVP：scope 使用 `repo` → TODO-111/115/116 |
| ~~BLOCK-02~~ | ~~时间线默认粒度~~ | 已解除（2026-10-03） | 已确认按提交聚合 → 见 ADR-0006                       |
| BLOCK-03     | Webhook 准实时更新 | M4 可观测性          | 是否引入用户侧配置成本                               |
