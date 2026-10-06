# 开发记录（Development Log）

> 记录规则：每次开发（或每次有意义的技术决策）追加一条，按时间**倒序**排列（最新在最上）。
> 每条包含：目标 / 完成内容 / 关键决策 / 问题与风险 / 下一步。

| 项 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 更新日期 | 2026-10-05 |
| 关联文档 | [实现路线](roadmap.md) · [待办日志](todo.md) |

---

## 2026-10-05 · M1-4 GitHub 数据层（TODO-121 / 122 / 123）

**目标**：时间线读路径改为 GraphQL v4 聚合查询（单页 1 次请求，满足「单仓库时间线 ≤3 次请求」），并提供服务端 TTL 缓存、cursor 分页管理与限流降级（缓存展示 + 恢复时间提示）。

**完成内容**

- GraphQL 客户端：`apps/web/lib/github-graphql.ts`——超时中止、瞬时错误自动重试（5xx / 网络 / 超时，指数退避）、错误分类（401 / 403 / 404 / 限流 / GraphQL）、`rateLimit` 读取、`data + errors` 部分失败容忍；共享错误统一抽取到 `github-errors.ts`（REST / GraphQL 共用，`github-repos.ts` 继续再导出保持兼容）。
- 时间线查询：`apps/web/lib/github-timeline.ts` 一次取回仓库信息 + 分支头（前 50）+ 提交历史（50/页）+ 关联 PR + `rateLimit`，归一化防御式解析；默认分支用 `HEAD` 表达式。
- 缓存与降级：`server-cache.ts`（TTL + LRU，过期条目保留供降级）、`rate-limit-store.ts`（按用户配额快照）、`data-stores.ts`（globalThis 单例；仓库列表 5 min / 时间线 2 min / cursor 链 30 min；降级阈值默认 100，`GITHUB_RATE_LIMIT_DEGRADE_THRESHOLD` 可调）；服务层 `repos-data.ts` / `timeline-data.ts` 统一「新鲜缓存命中 → 低配额降级陈旧缓存（stale / degraded + resetAt）→ 无缓存明确报错」。
- 接口与页面：新增 `/api/repos/[owner]/[name]/timeline?branch=&page=N`（输入白名单校验；401 / 403 / 404 / 409 `cursor_expired` / 429 + resetAt / 504 / 502 分类）；`/api/repos` 与 `/repos` 接入 5 min 缓存，限流降级时页面显示缓存时间与恢复时间。
- 验证：`pnpm lint / typecheck / test / build` 全绿；单测 80 例（本任务新增 43 例：GraphQL 客户端 12 · 时间线 5 · TTL 缓存 4 · 限流快照 5 · 仓库服务 8 · 时间线服务 7 · REST 配额头 2）；真实会话端到端：`/api/repos` 二次请求命中缓存；时间线接口返回真实数据（7 提交 / 4 分支），`stock-analysis` 连续两页各 50 提交且 cursor 正确，`page=5` → 409、非法参数 400、未知仓库 404、未登录 401 / 302，响应无明文令牌。

**关键决策**

| 编号 | 决策 | 理由 |
| --- | --- | --- |
| ADR-0021 | GraphQL 客户端与数据服务放在 `apps/web/lib`（与 REST 客户端同层），暂不下沉 `packages/github-client` | 当前唯一消费方是 web，避免为单一消费方引入构建顺序与 dist 耦合；出现第二个消费方时再下沉 |
| ADR-0022 | 缓存采用**进程内内存 TTL**（globalThis 单例），不引入 Redis / DB 缓存 | MVP 单实例部署，缓存只做性能优化且 GitHub 是唯一数据源；多实例 / Serverless 时再评估外部缓存 |
| ADR-0023 | 限流降级顺序：**新鲜缓存 → 陈旧缓存（标注 stale + resetAt）→ 无缓存明确报错** | 不用过期缓存冒充最新数据（M1-9 约定）；降级响应携带 meta 标记，前端显式提示缓存时间与恢复时间 |
| ADR-0024 | 分页 cursor 链保存在服务端（30 min），深页缺链返回 **409 `cursor_expired`** | cursor 不暴露给客户端，避免篡改；客户端从第 1 页重载即可恢复（M1-5 处理） |

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

| 编号 | 决策 | 理由 |
| --- | --- | --- |
| ADR-0018 | 仓库列表读接口采用 **REST `/user/repos`** | `X-GitHub-SSO: partial-results` 头可检测组织 SSO 部分结果；Link 分页简单直接；GraphQL 聚合型读接口由 M1-4 落地（ADR-0002 的动机是跨资源聚合） |
| ADR-0019 | 搜索 / 排序 / 过滤放在**前端**完成，配合「加载更多」分页 | 列表规模 ≤ 数百条，前端过滤即时（FR-2.3 要求 <100ms），避免每次输入都请求 API |
| ADR-0020 | 登录后默认回跳由 `/me` 调整为 `/repos` | 对齐 M1 主路径「登录 → 仓库列表 → 时间线」；显式 `callbackUrl` 仍优先 |

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

| 编号 | 决策 | 理由 |
| --- | --- | --- |
| ADR-0014 | 采用 **next-auth v5（5.0.0-beta.32）** | v5 支持 Next 16 App Router 与数据库会话；锁版本规避 beta 漂移 |
| ADR-0015 | **手写 Prisma 适配器**（不引入 @auth/prisma-adapter） | 需在 `linkAccount` 拦截并加密令牌、使用 `*_enc` 列；减少一个依赖，安全边界显式 |
| ADR-0016 | Prisma 锁定 **6.19.3 稳定线** | 7.x / 8.x 引擎与配置模式变动大，MVP 不冒险；M4 再评估升级 |
| ADR-0017 | 用 Next 16 **`proxy.ts` 做乐观鉴权** | 遵循 Next 16 更名与官方建议：proxy 只读 Cookie 不查库，真实校验留在页面 |

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

| 编号 | 决策 | 理由 |
| --- | --- | --- |
| ADR-0011 | 基线锁定 **Node 22 LTS + pnpm 12.9.1** | 与文档「pnpm + Node LTS」一致；为本机实测版本，Node 24 升级留待 M4 评估 |
| ADR-0012 | 仓库根 `.npmrc` 指向 **npmmirror 镜像** | 本机无法直连 registry.npmjs.org；若网络可用可删除该文件 |
| ADR-0013 | web 的 typecheck 脚本包含 `next typegen` | Next 16 使用生成式路由类型（`LayoutProps` 等），需先生成才可通过 tsc |

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

| 编号 | 决策 | 理由 | 备选与否决原因 |
| --- | --- | --- | --- |
| ADR-0006 | 时间线**按提交聚合**（commit 为原子节点） | 提交是 Git 的最小可信事实；分支/PR/Issue 在其上做标注，信息保真且实现简单 | 否决按「开发事件」聚合：需要额外的启发式归并，易丢失细节 |
| ADR-0007 | **私有仓库纳入 MVP** | 用户既然选择登录本平台，就已进入 GitHub 授权体系，无需再设信任门槛 | 否决「仅公有仓库」：会割裂用户的真实使用场景（工作仓库多为私有） |
| ADR-0008 | 平台**内置 OAuth App**，用户零配置 | 减少用户多余操作，从点击登录到可用只有两步 | 否决 Device Flow / 用户自备 PAT：都要求用户手工配置，违背降低门槛的目标 |
| ADR-0009 | **不支持离线模式** | 登录与数据都依赖 GitHub，离线状态下的功能没有意义 | 否决 IndexedDB + Service Worker 离线缓存：投入大、价值低 |
| ADR-0010 | 仓库/项目名由 `gitrail` 改为 **`utf8-git`**（取代 ADR-0003） | 与开发者身份（encode-utf8）和本地工作目录保持一致 | 否决保留 GitRail 作为仓库名：与用户指定的仓库名不符 |

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

| 编号 | 决策 | 理由 | 备选与否决原因 |
| --- | --- | --- | --- |
| ADR-0001 | 采用 **Next.js 全栈单仓**（TypeScript） | OAuth secret 必须服务端保存；单人维护成本最低；类型端到端复用 | 否决纯前端方案（令牌不安全）；否决前后端分离（样板与部署成本高，MVP 阶段收益低） |
| ADR-0002 | 读接口使用 **GitHub GraphQL v4**，写操作使用 **REST v3** | 读需要跨资源聚合（提交+分支+PR），GraphQL 一次取回；写操作 REST 语义清晰、幂等性好 | 全 REST：请求数多、易触发限流；全 GraphQL：变更类操作支持有限 |
| ADR-0003 | 仓库名 **gitrail**（GitRail） | 「轨道」贴合时间线隐喻，命名冲突少（GitHub 同名仓库热度极低） | 否决 gitcanvas/reposcope 等（重名多或语义偏离）；**已被 ADR-0010 取代** |
| ADR-0004 | 提交图泳道布局**服务端预计算** | 算法在服务端可缓存、可测试；前端只做渲染，降低大仓库卡顿风险 | 纯前端计算：首次加载大仓库耗时不可控 |
| ADR-0005 | 写操作统一走「**预览 → 确认 → 审计 → 执行**」管线 | 安全是产品核心卖点；统一管线便于扩展与测试 | 直接执行：误操作风险高，违背产品定位 |

**问题与风险**

- 私有仓库与组织仓库的 OAuth 授权（scope 与审核）会显著增加复杂度 → ~~MVP 优先公有仓库场景~~ **已在 2026-10-03 第二轮决策中确认纳入 MVP（ADR-0007）**。
- 大仓库（10w+ commits）的泳道预计算与分页策略尚未验证 → M2 需用真实大仓库做基准测试。
- 时间线默认粒度（按提交 vs 按开发事件聚合）尚未定论 → ~~待验证~~ **已确认按提交聚合（ADR-0006）**。

**下一步**

- 初始化 monorepo 骨架（`apps/web` + `packages/*`），配置 CI 与开发约定。
- 接入 GitHub OAuth，打通登录 → 仓库列表。
- 实现时间线 v1（提交节点 + 虚拟滚动）。
