# 部署形态与多实例一致性（M1-6）

> 关联：`docs/roadmap.md` M1-6 · `docs/technical-analysis.md` §2 / §6.2 / §10 · `docs/todo.md` TODO-104
> 状态：已在 Vercel + 托管 PostgreSQL（Neon）完成生产部署，推送到 `main` 自动发布

## 1. 目标部署形态

| 层          | 选型                                          | 说明                                          |
| ----------- | --------------------------------------------- | --------------------------------------------- |
| 应用        | Vercel（Next.js App Router，Node.js Runtime） | 预览环境 + 生产环境两套；均运行同一份构建产物 |
| 数据库      | 托管 PostgreSQL（Neon / Supabase 免费层）     | 会话、令牌密文、共享缓存、限流快照            |
| 缓存 / 限流 | Postgres 共享表（`STORE_BACKEND=postgres`）   | MVP 不引入 Redis；见 §6                       |
| CI          | GitHub Actions（`.github/workflows/ci.yml`）  | lint → typecheck → test → build               |

本地开发仍用 `docker-compose.dev.yml` 起 PostgreSQL；`STORE_BACKEND` 默认 `memory`，行为与单实例部署一致。

## 2. 环境变量清单

| 变量                                  | 必填 | 作用                                                      | 生产取值建议                                   |
| ------------------------------------- | ---- | --------------------------------------------------------- | ---------------------------------------------- |
| `DATABASE_URL`                        | 是   | Prisma 连接串（会话 / 令牌 / 共享状态）                   | Neon **pooled** 连接串，见 §4                  |
| `AUTH_SECRET`                         | 是   | Auth.js 会话签名密钥                                      | `openssl rand -base64 32` 生成，与预览环境分开 |
| `AUTH_TOKEN_ENC_KEY`                  | 是   | 令牌密文 AES-256-GCM 密钥（`v1.<iv>.<tag>.<ciphertext>`） | 32 字节 base64；**轮换需迁移旧密文**           |
| `AUTH_GITHUB_ID`                      | 是   | GitHub OAuth App Client ID                                | 生产与预览可共用，或各建一个                   |
| `AUTH_GITHUB_SECRET`                  | 是   | GitHub OAuth App Client Secret                            | 同上                                           |
| `STORE_BACKEND`                       | 否   | `memory`（默认）/ `postgres`                              | 多实例、Serverless 必须设 `postgres`           |
| `GITHUB_API_BASE_URL`                 | 否   | 上游 REST 基址（默认官方 API）                            | 仅 E2E / 自建指向本地 mock                     |
| `GITHUB_GRAPHQL_ENDPOINT`             | 否   | 上游 GraphQL 地址（默认官方 API）                         | 同上                                           |
| `GITHUB_TOKEN_ENDPOINT`               | 否   | 上游令牌地址（默认 GitHub）                               | 同上                                           |
| `GITHUB_RATE_LIMIT_DEGRADE_THRESHOLD` | 否   | 剩余配额低于该值时进入「只读缓存」降级                    | 默认 `100`                                     |
| `WRITE_OPERATION_LIMIT`               | 否   | 单个用户在一个窗口内允许的写操作次数上限                  | 默认 `20`                                      |
| `WRITE_OPERATION_WINDOW_MS`           | 否   | 写操作频率限制的滑动窗口（毫秒）                          | 默认 `60000`                                   |
| `WRITE_OPERATION_REPLAY_WINDOW_MS`    | 否   | 幂等回放窗口（毫秒）：同参数的新操作超过该窗口会重新执行  | 默认 `600000`                                  |
| `OPERATION_AUDIT_RETENTION_DAYS`      | 否   | 写操作审计保留天数（写入时按概率清理更早的记录）          | 默认 `90`                                      |
| `AUTH_TRUST_HOST`                     | 否   | 非 Vercel 自建部署时信任 `Host` 头                        | 自建填 `true`；Vercel 自动识别无需设置         |
| `AUTH_URL`                            | 否   | 显式指定外部地址（自建 / 反代场景）                       | `https://<域名>`                               |
| `NODE_USE_ENV_PROXY` + `HTTPS_PROXY`  | 否   | 仅本地开发在受限网络下访问 `github.com` 用                | 生产不需要                                     |

> `RUN_DB_TESTS` 只用于本地数据库用例开关，不是部署变量。
> **不要手动设置 `NODE_ENV`**：Vercel 会按环境自动注入 `production`，手动设置（尤其带引号或空值）会触发
> Next.js 的 `non-standard "NODE_ENV" value` 警告并让构建环境判断异常。

## 3. 部署步骤

1. 建库（Neon / Supabase），拿到 `DATABASE_URL`；迁移用直连串、运行期用 pooled 串（§4）。
2. 生成 `AUTH_SECRET`、`AUTH_TOKEN_ENC_KEY`（两者都不要复用本地值）。
3. 在 GitHub 建 OAuth App，把 **Authorization callback URL** 设为 `https://<域名>/api/auth/callback/github`。
   ⚠️ 该字段**只能填一个地址**（不像 GitHub App 可填多条，也无法与本地地址共存）：本地、生产都要能登录就建**两个** App，
   再把生产 App 的 Client ID / Secret 填进 Vercel 的 `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`。
4. Vercel 导入仓库，**Root Directory 设为 `apps/web`**。Vercel 会自动识别上层 `pnpm-workspace.yaml` 并从仓库根装依赖；
   若提示「Include files outside of the Root Directory in the Build Step」，打开该开关。
5. 构建 / 安装命令由 `apps/web/vercel.json` 固化，无需在后台手输：
   - `buildCommand`：`prisma generate && next build`
   - `installCommand`：`pnpm install --frozen-lockfile --registry=https://registry.npmjs.org`（绕过仓库 `.npmrc` 的国内镜像，见 §3.1）
6. 在本地执行迁移（指向生产库**直连串**）：`pnpm --filter @utf8-git/web exec prisma migrate deploy`。
   刻意不放进构建命令：预览环境每次构建都会跑，若与生产共用库会造成误迁移。
7. 注入 §2 环境变量后 Redeploy；确认 `/`、`/login`、`/repos` 可访问。

> 后台的 Build Command / Install Command / Output Directory 必须保持**空白**：后台设置优先级高于 `vercel.json`，
> 两处同时设置会互相覆盖（曾出现后台预填的默认值 `next build` 与粘贴内容拼成 `next buildprisma generate && next build`，导致构建失败）。

### 3.1 常见坑

| 现象                                                                        | 原因                                                                                                                             | 处理                                                                                                                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 构建日志 `Invalid project directory provided ... buildprisma`               | 后台 Build Command 覆盖框预填了默认 `next build`，粘贴内容接在其后                                                               | 清空后台该字段（改用 `apps/web/vercel.json`），或全选删空后重新输入                                                                                                           |
| 警告 `non-standard "NODE_ENV" value`                                        | 在 Vercel 环境变量里手动设置了 `NODE_ENV`（含带引号 / 空值）                                                                     | 删除该变量，Vercel 会按环境自动注入 `production`                                                                                                                              |
| 安装依赖慢或失败                                                            | 仓库 `.npmrc` 指向 `registry.npmmirror.com`，对海外构建机不友好                                                                  | 由 `installCommand` 的 `--registry` 覆盖；要永久移除可直接删 `.npmrc`（本地改为可直连官方源时）                                                                               |
| 登录后报错 / `/repos` 500                                                   | 目标库未执行迁移（缺 `users` / `accounts` / `sessions` / 共享缓存等表）                                                          | 本地执行 `prisma migrate deploy` 指向生产库直连串                                                                                                                             |
| 翻页时随机报 409 `cursor_expired`，且每次操作都很慢                         | `STORE_BACKEND` 未设为 `postgres`：Serverless 多实例下缓存与游标链按实例隔离，第 2 页请求落到别的实例就读不到第 1 页写入的游标链 | 在 Vercel 设置 `STORE_BACKEND=postgres`（运行期 pooled 串）后 Redeploy；用 `pnpm deploy:selfcheck` 或 `GET /api/health` 确认已生效                                            |
| 登录后 GitHub 报 `The redirect_uri is not associated with this application` | OAuth App 的 Authorization callback URL 与实际请求地址不一致（常见是仍留着 `localhost`，或线上域名拼写 / 结尾斜杠不一致）        | GitHub → Settings → Developer settings → OAuth Apps，打开 `AUTH_GITHUB_ID` 对应的那个 App，把回调地址改为 `https://<域名>/api/auth/callback/github`（无结尾斜杠、逐字符一致） |

### 3.2 部署自检

部署完成后跑一次，一条命令给出「能不能用、哪里配错」：

```powershell
pnpm deploy:selfcheck                                            # 默认校验生产域名
node scripts/deploy-selfcheck.mjs --base=http://127.0.0.1:3100   # 校验本地实例
```

- 覆盖：静态页可达、未登录一律 401、Auth.js 生产 Cookie 前缀、OAuth 跳转参数、`redirect_uri` 是否等于部署域名，以及 `/api/health` 的逐项明细。
- 应用侧自检端点 `GET /api/health`：无鉴权，**只返回布尔结论与说明文字（不含密钥）**，全部通过 200、任一失效 503。核对项：
  `STORE_BACKEND`（Serverless 下必须为 `postgres`，否则翻页会随机 409 `cursor_expired`）、数据库连通性、迁移表齐全性、
  必填密钥是否就位、`AUTH_TOKEN_ENC_KEY` 是否为 32 字节 base64。
- 运行期还会返回 `functionRegion`（Vercel 注入的 `VERCEL_REGION`）与 **warnings**：数据库往返超过 150 ms 时会告警「函数区与数据库区大概率不一致」
  （一次请求串行 4~6 次查询，跨区会放大成秒级延迟）。warnings 不影响 `ok`、不触发 503。
- **无法自动验证**：GitHub OAuth App 的 Authorization callback URL 是否已登记（GitHub 仅在已登录状态校验）。
  脚本会在结尾打印「应登记的地址」，需人工比对。
  | 所有操作都迟钝（每次点击 1 s+） | Vercel 函数区与数据库区不一致：一次请求串行执行 4~6 次数据库查询（数据库会话 + 令牌 + 缓存 + 限流 + 游标），每次跨区往返要 200 ms 以上 | 让两者同区：Neon 在 `ap-southeast-1` 时把函数区设为 `sin1`（Vercel 后台 Settings → Functions → Function Region，或 `vercel.json` 的 `regions`）；套餐不支持改区就把数据库建到函数的默认区（`aws-us-east-1`）。用 `pnpm deploy:selfcheck` 看函数区与数据库往返 |

## 4. 连接池

- Serverless 下函数实例数 = 数据库连接数上限的隐患：**每个实例一个 Prisma Client**，需限制单实例连接数。
- Neon：运行期用 pooled 连接串，并追加 `?pgbouncer=true&connection_limit=1`；迁移用 direct 连接串
  （PgBouncer transaction 模式不支持迁移所需的部分语句）。
- 数据库侧务必设置连接数上限告警，避免实例扩容打满连接。

## 5. 冷启动与超时

- 目标：冷启动 < 3s（roadmap M1-6 验收口径）；构成 = 函数冷启动 + Prisma 首次连接 + 首屏数据请求。
- 出网请求统一 15s 超时（`apps/web/lib/github-fetch.ts`）：**超时 → 504 `github_timeout`**、
  **不可达 → 503 `github_unreachable`**、限流 → 429 `rate_limited`；前端展示「重试」而不是过期缓存冒充最新数据。
- 令牌续期端点（`github.com/login/oauth/access_token`）与数据接口共用同一套超时 / 错误分类。

## 6. 多实例一致性（本次核心）

### 6.1 共享存储

- `STORE_BACKEND=memory`（默认）：进程内 TTL 缓存 + 限流快照，仅单实例有效。
- `STORE_BACKEND=postgres`：改用 `apps/web/lib/pg-stores.ts`
  - `shared_cache_entries`：TTL 缓存（仓库列表 5min / 时间线 2min / cursor 链 30min / 提交详情 30min），
    写入时按 2% 概率顺带清理过期条目。
  - `rate_limit_states`：每用户一行限流快照（`remaining` / `reset_at` / `source`），多实例共用同一份降级判定。
- 取舍：每次命中多 1 次数据库读、回源多 1 次数据库写；换来跨实例一致、实例重启后不丢缓存、限流判定统一。
- 已知约束：cursor 链是「读-改-写」，多实例同时翻同一仓库的下一页时有极小概率丢页；
  `timeline-data.ts` 会把缺失的上一页判为 `cursor_expired`（409），客户端回到第 1 页，不影响正确性。

### 6.2 令牌续期去重

- 单实例：`access-token.ts` 用进程内 in-flight map 合并同一用户的并发续期。
- 多实例：refresh token 每次刷新都会轮换，落败实例的刷新请求会被 GitHub 拒（401）。
  此时先重读库中最新令牌，若 `expires_at` 已变化（说明其它实例刚完成续期）则直接复用，**不再误报「授权失效」**。
- 残留窗口：两个实例同时刷新且都失败（例如网络抖动）时仍需重新授权；
  彻底消除需要数据库级租约 / 单飞（见 §8）。

### 6.3 账号数据清除（M3-9）

- `/me` 的「撤销 GitHub 授权」调 `DELETE /applications/{client_id}/token` 撤销令牌，随后删除**本地**令牌密文、
  登录会话、该用户的四类缓存与配额快照；用户记录与审计保留（重新授权即可继续）。
- `/me` 的「清除我的数据」在撤销令牌（尽力而为，失败不阻塞）之后，按「审计 → 令牌 / 会话 → 缓存 →
  配额快照 → 用户记录」删除本应用内的全部该用户数据。这是**不可恢复**操作，界面已用确认卡片说明影响。
- 清除按 `actor`（用户 ID）作用，不触碰其他用户与仓库维度的数据；审计表没有外键，因此删除顺不依赖级联。
- 无需额外环境变量或迁移；多实例下 `STORE_BACKEND=postgres` 时缓存按 `shared_cache_entries.key` 前缀删除，
  内存后端只影响当前实例（与缓存本身的语义一致）。

### 6.4 缓存键

- `cacheKey` 用 U+001F（字段分隔符）拼接，不能用 NUL：Postgres `text` 不接受 `0x00` 字节，
  否则查询直接报 `invalid byte sequence for encoding "UTF8": 0x00`。

## 7. 预览环境与回滚

- 预览：每个 PR 一套；`AUTH_SECRET` / `AUTH_TOKEN_ENC_KEY` 与生产隔离，数据库可用 Neon branch 或独立库。
- **预览环境 OAuth（稳定别名）**：Vercel 预览部署默认是随机域名，GitHub OAuth App 无法为随机域名登记回调，
  预览点登录会失败。给固定预览分支分配**稳定别名**并单独注册 OAuth App：
  1. 在 Vercel 项目 Settings → Domains 添加固定预览域名（如 `utf8-git-preview.vercel.app` 或自有子域），
     并在 Git 集成里把它指派给固定分支（如 `develop` / `preview`），让别名自动跟随最新预览部署；
     也可用 CLI 手动重指：`vercel alias set <preview-deployment-url> utf8-git-preview.vercel.app`。
  2. GitHub OAuth App 的 Authorization callback URL **只能填一个地址**，预览与生产无法共用同一个 App，
     需**为预览单独建一个 OAuth App**，回调填 `https://<预览别名>/api/auth/callback/github`；
     预览环境把 `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` 指向它。
  3. 预览环境同样设 `STORE_BACKEND=postgres` 并用独立的 Neon branch / 库，`AUTH_SECRET`、`AUTH_TOKEN_ENC_KEY` 与生产隔离。
- 回滚：Vercel 一键回滚到上一个 deployment（应用层）；数据库迁移要求**前向兼容**（先加列 → 双写 → 再删列），
  必要时手写 down 脚本，不要依赖 `migrate reset`。

## 8. 遗留事项

- ~~真实 Vercel / Neon 部署~~ **已完成（2026-10-07）**：生产地址 <https://utf8-git.vercel.app/>，
  Neon 已应用全部迁移，未登录路径与 OAuth 跳转验收通过，详见 `docs/reports/tech-analysis/M1-6-deployment-verification.md`。
- ~~浏览器完整登录一次（写入会话 + 令牌加密入库 + 拉取仓库列表）~~ **已完成**：用户在生产站实测登录与时间线 /
  写操作均正常，会话与令牌加密入库路径已在生产验证。
- ~~预览部署的随机域名无法完成 OAuth 回调~~ **方案见 §7**：固定预览分支稳定别名 + 单独预览 OAuth App。
- 性能指标待 M4 复测（归口 TODO-242 / TODO-244）：`Lighthouse ≥ 80` 与「冷启动 < 3s」都需要在无代理环境的
  真实浏览器里测量（本次线上读数含代理开销）。
- 若平台函数超时上限先于我们的 15s GitHub 超时触发（Hobby 默认 10s），可为路由声明 `maxDuration`。
- 续期去重的双刷新窗口可用「数据库租约」彻底消除（后续任务）。
- 多 region 复制、Redis 等外部缓存：MVP 明确不做。
