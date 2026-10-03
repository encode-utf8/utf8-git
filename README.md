# GitRail 🚂

> 把晦涩的 Git 仓库，变成一条可以点着走的时间线。

GitRail 是一个面向 **Git 新手 / 团队新人** 的仓库可视化与交互式操作平台。
用 GitHub 账号登录后，你可以像看地图一样浏览仓库的分支、提交、合并与 Issue，
并通过点击完成创建分支、提交 Issue、合并或删除分支等常用操作——**不需要记住任何 Git 命令**。

![status](https://img.shields.io/badge/status-M0%20%E6%96%87%E6%A1%A3%E9%98%B6%E6%AE%B5-blue)
![license](https://img.shields.io/badge/license-MIT-green)

---

## 为什么做 GitRail

刚加入一个项目的开发者，面对动辄成百上千次提交、十几个分支的仓库时，常见困境是：

- `git log --graph` 的输出像天书，看不懂分支从哪来、为什么合并；
- 不知道自己该从哪个提交开始读代码，也看不懂「谁在什么时候动了什么」；
- 想做个简单的操作（拉分支、提 Issue、合 PR），却要背一串命令，还容易出错；
- 仓库的「开发过程」散落在 Commits / Branches / Pull Requests / Issues 四个页面里，没有整体叙事。

GitRail 的目标是：**把仓库的开发过程还原成一条可交互的时间线，让「理解项目」和「执行操作」都变成点击。**

## 核心能力（规划）

| 阶段 | 能力 | 说明 |
| --- | --- | --- |
| M1 只读闭环 | GitHub 登录 · 仓库列表 · 提交时间线 | 登录后可浏览自己创建/参与的仓库，查看按时间排列的提交与分支起点 |
| M2 只读增强 | 分支图 · PR / Issue 泳道 · 过滤与搜索 | 在同一时间线上叠加分支、合并、Issue 事件，支持按人/分支/时间筛选 |
| M3 交互操作 | 创建分支 · 提交 Issue · 合并 PR · 删除分支 | 点击式写操作，带二次确认、影响预览与审计记录 |
| M4 体验工程 | 性能 · 缓存 · 测试 · 国际化 · 可访问性 | 面向真实大仓库打磨，形成可持续开发节奏 |
| M5 生态扩展 | 教学引导 · 多平台（GitLab 等）· 插件 | 从工具走向「Git 学习平台」 |

## 目标用户

- **项目新人**：刚加入团队或开源项目，想快速搞清「这个项目是怎么长出来的」。
- **Git 不熟练者**：会用但是怕用错，希望通过界面完成低频/高风险操作。
- **导师 / 维护者**：想快速向新人解释项目结构，或检查仓库健康度。

## 产品原则

1. **先看懂，再操作**：可视化优先于功能堆砌，任何写操作前都可预览影响。
2. **安全第一**：默认最小权限；危险操作（删分支、合并）必须二次确认且可追溯。
3. **不重复造轮子**：Git 数据以 GitHub 为准，GitRail 只做展示、编排与守护。
4. **渐进式披露**：新手看到的是「故事」，进阶用户能展开看到 SHA、命令与原始数据。

## 技术栈（规划）

- 全栈：TypeScript · Next.js（App Router）
- 界面：Tailwind CSS · shadcn/ui
- 可视化：D3 / 自研泳道布局（提交 DAG）· 时间线组件
- 数据：GitHub GraphQL API v4（读）+ REST API v3（写）· PostgreSQL + Prisma
- 鉴权：Auth.js（GitHub OAuth App）
- 部署：Vercel + Neon/Supabase · GitHub Actions CI

选型对比与理由见 [docs/technical-analysis.md](docs/technical-analysis.md)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [docs/requirements.md](docs/requirements.md) | 需求分析：用户画像、用户故事、功能/非功能需求、验收标准、范围边界 |
| [docs/technical-analysis.md](docs/technical-analysis.md) | 技术分析：架构选型、GitHub API 策略、提交图渲染、安全设计、风险 |
| [docs/roadmap.md](docs/roadmap.md) | 实现路线：M0–M5 里程碑、交付物、退出标准、迭代节奏 |
| [docs/development-log.md](docs/development-log.md) | 开发记录：按时间记录目标、产出、决策与问题 |
| [docs/todo.md](docs/todo.md) | 待办日志：当前迭代任务与分类 Backlog |

## 仓库结构（规划）

```text
gitrail/
├── apps/web/          # Next.js 应用（前端 + API 路由）
├── packages/          # 共享包：git-graph 布局、GitHub 客户端、UI 组件
├── docs/              # 项目文档
└── .github/           # CI、Issue/PR 模板
```

> 注：M0 阶段仅落地文档；代码骨架将在 M1 开始时按上述结构初始化。

## 参与贡献

项目处于早期，欢迎通过 Issue 提出想法与使用场景。贡献指南（CONTRIBUTING）将在 M1 阶段补齐。

## License

[MIT](LICENSE) © 2026 encode-utf8
