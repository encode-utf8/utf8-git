# 待办日志（TODO）

| 项 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 更新日期 | 2026-10-03 |
| 标记约定 | `[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成 · `[!]` 阻塞 |
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
- [ ] TODO-007 评审文档并确认 4 个 Open Questions（见需求分析 §12）
- [ ] TODO-008 确定包管理器与运行时版本（pnpm + Node LTS）并写入文档
- [ ] TODO-009 补充 Issue / PR 模板与贡献指南（CONTRIBUTING）

## 2. 下一迭代：M1 · 只读最小闭环

### 2.1 初始化（工程）

- [ ] TODO-101 初始化 monorepo（pnpm workspace：`apps/web`、`packages/*`）
- [ ] TODO-102 配置 ESLint + Prettier + commitlint（Conventional Commits）
- [ ] TODO-103 搭建 GitHub Actions CI（lint → typecheck → test → build）
- [ ] TODO-104 配置 Vercel 预览环境与生产环境、环境变量管理
- [ ] TODO-105 初始化 PostgreSQL（Neon/Supabase）+ Prisma 迁移基线

### 2.2 账号与仓库

- [ ] TODO-111 接入 Auth.js GitHub Provider（含 PKCE 与 state）
- [ ] TODO-112 会话持久化 + 令牌加密存储（AES-256-GCM）
- [ ] TODO-113 `/repos` 仓库列表页（创建/参与、排序、空状态）
- [ ] TODO-114 仓库搜索与可见性过滤

### 2.3 数据层

- [ ] TODO-121 GitHub GraphQL 客户端封装（错误、重试、限流读取）
- [ ] TODO-122 查询结果缓存（TTL + 分页 cursor 管理）
- [ ] TODO-123 限流降级策略（缓存展示 + 恢复时间提示）

### 2.4 时间线 v1

- [ ] TODO-131 时间线页面骨架（仓库信息 + 提交列表）
- [ ] TODO-132 提交节点组件（作者、时间、消息、SHA）
- [ ] TODO-133 虚拟滚动（支持 1000+ 提交）
- [ ] TODO-134 节点详情面板（文件变更统计、跳转 GitHub）
- [ ] TODO-135 加载骨架屏与错误/空状态设计

### 2.5 验证

- [ ] TODO-141 关键路径单元测试（数据层 + 限流降级）
- [ ] TODO-142 E2E：登录（mock）→ 选仓库 → 浏览时间线
- [ ] TODO-143 用 3 个真实仓库（小/中/大）做性能验证

## 3. Backlog（未排期）

### 3.1 产品

- [ ] TODO-201 时间线粒度为「按事件聚合」的视图（里程碑/发布）
- [ ] TODO-202 仓库健康度提示（僵尸分支、陈旧 Issue）
- [ ] TODO-203 新用户引导（首次使用教学路径）
- [ ] TODO-204 贡献热力图与「谁在做什么」视角

### 3.2 可视化

- [ ] TODO-211 泳道布局算法包（merge/root/多父/rebase 边界用例）
- [ ] TODO-212 PR / Issue 事件泳道渲染
- [ ] TODO-213 时间缩放与范围切换
- [ ] TODO-214 时间线导出（图片 / 链接分享）

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

| 编号 | 事项 | 阻塞对象 | 需要的决策/资源 |
| --- | --- | --- | --- |
| BLOCK-01 | 私有仓库支持 | M1-3、M3 部分能力 | 是否申请 `repo` scope / 是否支持组织 SSO |
| BLOCK-02 | 时间线默认粒度 | M1-5、M2-3 | 原型可用性测试结论 |
| BLOCK-03 | Webhook 准实时更新 | M4 可观测性 | 是否引入用户侧配置成本 |
