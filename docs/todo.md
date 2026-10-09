# 待办日志（TODO）

| 项       | 内容                                                    |
| -------- | ------------------------------------------------------- |
| 文档版本 | v0.1                                                    |
| 更新日期 | 2026-10-09                                              |
| 标记约定 | `[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成 · `[!]` 阻塞   |
| 关联文档 | [实现路线](roadmap.md) · [开发记录](development-log.md) |

---

## 1. 当前迭代：M0 · 立项与文档

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

## 2. 下一迭代：M1 · 只读最小闭环

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
- [ ] TODO-214 时间线导出（图片 / 链接分享）
- [x] TODO-215 PR / Issue 关联标注（M2-3：GraphQL 聚合 `closingIssuesReferences` 并挂载到关联提交；行内标注与详情面板均可跳转 GitHub）
- [x] TODO-216 时间线过滤与搜索（M2-4：关键词 / 作者 / 事件类型客户端即时过滤；分支维度沿用分支选择器；过滤 < 100ms）
- [x] TODO-217 时间线时间范围缩放（M2-5：近一周 / 近一月 / 全部；切换范围时把选中提交重新锚定，保持上下文）
- [x] TODO-218 概念解释层（M2-6：术语悬浮卡片 + 关闭 / 新手 / 进阶模式；默认关闭，localStorage 记忆选择，不干扰老用户）

### 3.3 操作能力

- [ ] TODO-221 操作编排框架（幂等键 + 审计 + 重试）
- [ ] TODO-222 创建分支
- [ ] TODO-223 创建 Issue（Markdown 预览 + 标签）
- [ ] TODO-224 PR 合并流程（可合并性检查、冲突提示）
- [ ] TODO-225 删除分支（保护规则 + 影响预览）
- [ ] TODO-226 24h 撤销 / 分支恢复
- [ ] TODO-227 操作历史与等价 Git 命令展示

### 3.4 安全与合规

- [ ] TODO-231 写操作频率限制与防重放
- [ ] TODO-232 用户数据清除与授权撤销（GDPR 友好）
- [ ] TODO-233 审计日志导出

### 3.5 工程化

- [ ] TODO-241 可观测性（结构化日志 + 错误上报）
- [ ] TODO-242 性能基准测试（1000/10000 节点）
- [ ] TODO-243 国际化框架（zh-CN / en）
- [ ] TODO-244 可访问性审查（键盘可达、对比度）
- [ ] TODO-245 依赖更新与安全扫描（Dependabot + audit）

### 3.6 文档与社区

- [ ] TODO-251 部署与自建指南（含自建 OAuth App 步骤）
- [ ] TODO-252 架构决策记录（ADR）目录化，迁移 development-log 中的 ADR
- [ ] TODO-253 贡献指南与开发环境说明
- [ ] TODO-254 用户手册 / 演示视频

## 4. 阻塞与依赖

| 编号         | 事项               | 阻塞对象             | 需要的决策/资源                                      |
| ------------ | ------------------ | -------------------- | ---------------------------------------------------- |
| ~~BLOCK-01~~ | ~~私有仓库支持~~   | 已解除（2026-10-03） | 已确认纳入 MVP：scope 使用 `repo` → TODO-111/115/116 |
| ~~BLOCK-02~~ | ~~时间线默认粒度~~ | 已解除（2026-10-03） | 已确认按提交聚合 → 见 ADR-0006                       |
| BLOCK-03     | Webhook 准实时更新 | M4 可观测性          | 是否引入用户侧配置成本                               |
