# 部署形态与多实例一致性（M1-6）

> 关联：`docs/roadmap.md` M1-6 · `docs/technical-analysis.md` §2 / §6.2 / §10 · `docs/todo.md` TODO-104
> 状态：代码与文档已落地；真实 Vercel / Neon 部署需用户账号（见 §8 遗留事项）

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
| `GITHUB_RATE_LIMIT_DEGRADE_THRESHOLD` | 否   | 剩余配额低于该值时进入「只读缓存」降级                    | 默认 `100`                                     |
| `AUTH_TRUST_HOST`                     | 否   | 非 Vercel 自建部署时信任 `Host` 头                        | 自建填 `true`；Vercel 自动识别无需设置         |
| `AUTH_URL`                            | 否   | 显式指定外部地址（自建 / 反代场景）                       | `https://<域名>`                               |
| `NODE_USE_ENV_PROXY` + `HTTPS_PROXY`  | 否   | 仅本地开发在受限网络下访问 `github.com` 用                | 生产不需要                                     |

> `RUN_DB_TESTS` 只用于本地数据库用例开关，不是部署变量。

## 3. 部署步骤

1. 建库（Neon / Supabase），拿到 `DATABASE_URL`；迁移用直连串、运行期用 pooled 串（§4）。
2. 生成 `AUTH_SECRET`、`AUTH_TOKEN_ENC_KEY`（两者都不要复用本地值）。
3. 在 GitHub 建 OAuth App，回调地址填 `https://<域名>/api/auth/callback/github`。
4. Vercel 导入仓库（monorepo，Root Directory 保持仓库根），构建命令用根 `pnpm build`（`pnpm -r build`），
   `apps/web` 的 `postinstall` 会自动执行 `prisma generate`。
5. 发布前执行迁移：`pnpm --filter @utf8-git/web exec prisma migrate deploy`。
6. 注入 §2 环境变量，部署；确认 `/`、`/login`、`/repos` 可访问。

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

### 6.3 缓存键

- `cacheKey` 用 U+001F（字段分隔符）拼接，不能用 NUL：Postgres `text` 不接受 `0x00` 字节，
  否则查询直接报 `invalid byte sequence for encoding "UTF8": 0x00`。

## 7. 预览环境与回滚

- 预览：每个 PR 一套；`AUTH_SECRET` / `AUTH_TOKEN_ENC_KEY` 与生产隔离，数据库可用 Neon branch 或独立库。
- 回滚：Vercel 一键回滚到上一个 deployment（应用层）；数据库迁移要求**前向兼容**（先加列 → 双写 → 再删列），
  必要时手写 down 脚本，不要依赖 `migrate reset`。

## 8. 遗留事项

- **TODO-104**：真实 Vercel / Neon 部署需用户账号与生产 OAuth 回调，本地无法代办。
- 「冷启动 < 3s」「Lighthouse ≥ 80」需在真实平台实测；本地仅有生产模式启动耗时参考（≈1.5s，见 M1-7 报告）。
- 续期去重的双刷新窗口可用「数据库租约」彻底消除（后续任务）。
- 多 region 复制、Redis 等外部缓存：MVP 明确不做。
