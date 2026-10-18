# 自建与自部署指南

> 关联：`docs/todo.md` TODO-251 · `docs/deployment.md`（部署形态与多实例一致性）· `docs/technical-analysis.md` §2 / §10
>
> **分工**：本文回答「从零到能用」——建 OAuth App、选形态、敲命令、上线后怎么升级回滚。
> 部署形态取舍、连接池、多实例一致性、预览环境等内部细节见 [`docs/deployment.md`](deployment.md)，本文只引用不重复。

## 1. 三条路径怎么选

| 路径                            | 适用场景                          | 需要准备                                  | 验证状态                                                                                     |
| ------------------------------- | --------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| **A. Vercel + 托管 PostgreSQL** | 个人 / 小团队、不想运维服务器     | GitHub 仓库 + Vercel + Neon（免费层足够） | ✅ 已用于生产站 <https://utf8-git.vercel.app/>，见 `deployment.md` §3                        |
| **B. 单机 Node + 反向代理**     | 有 VPS / 内网服务器、数据要自己拿 | 一台 1C1G 以上 Linux + PostgreSQL + Nginx | ⚠️ 启动路径有 CI 覆盖（E2E 就是用 `next start` 起服务），反代 / systemd / HTTPS 未在 CI 覆盖 |
| **C. 容器镜像**                 | 已有 K8s / Compose 体系           | 自行封装                                  | ❌ 本仓库**不提供**官方镜像（原因见 §8）                                                     |

三条路径跑的是同一份代码与同一套环境变量，差别只在「谁来管进程、TLS、数据库」。

## 2. 前置条件

| 项          | 要求                                                | 说明                                                          |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Node.js     | `>= 22.12`（`.nvmrc` 固定 `22`）                    | 仓库 `engines` 的硬要求，低于此版本不在支持范围               |
| pnpm        | `12.9.1`（`packageManager` 字段固定）               | `corepack enable` 会自动取到正确版本；否则 `npm i -g pnpm@12` |
| PostgreSQL  | 建议 14+（开发库固定 `postgres:18-alpine`）         | 只用于会话 / 令牌密文 / 共享缓存 / 限流快照 / 审计            |
| GitHub 账号 | 能进 Settings → Developer settings                  | 用来创建 OAuth App                                            |
| 出网        | 能访问 `api.github.com`、`github.com`、npm registry | 构建期需要装依赖，运行期需要调 GitHub API                     |

## 3. 第一步：自建 GitHub OAuth App

**为什么必须自建**：OAuth App 的 Client ID 代表「哪个应用在请求授权」。本项目的 Client ID 属于平台方，你部署自己的实例就得用自己的，否则 GitHub 会把用户重定向到平台登记的回调地址，你的实例永远拿不到 code。

### 3.1 创建步骤

1. 打开 <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**。
2. 填写三项：

   | 字段                       | 填什么                                                        |
   | -------------------------- | ------------------------------------------------------------- |
   | Application name           | 你的实例名（用户授权页会显示，例如 `utf8-git (self-hosted)`） |
   | Homepage URL               | 实例首页，如 `https://git.example.com`                        |
   | Authorization callback URL | `https://git.example.com/api/auth/callback/github`            |

3. 创建后页面给出 **Client ID**；点 **Generate a new client secret** 得到 **Client Secret**。
   ⚠️ Secret **只完整显示一次**，关掉页面就再也看不到，只能重新生成。
4. 把两者填进部署环境：`AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`。

### 3.2 回调地址的三条硬规则

- **一个 App 只能登记一个回调地址**（这一点与 GitHub App 不同，后者可填多条）。
  因此「本地开发」与「线上实例」必须**各建一个 App**：本地填 `http://localhost:3000/api/auth/callback/github`，
  线上填 `https://<域名>/api/auth/callback/github`。
- **逐字符一致**：协议（`http` / `https`）、域名、路径都不能差，**结尾不要加斜杠**。
  端口也要写（本地 3000 必须出现）。不一致时 GitHub 直接报
  `The redirect_uri is not associated with this application`。
- 预览 / 多环境同理：每个对外域名一套 App，或统一走稳定别名（见 `deployment.md` §7）。

### 3.3 授权范围

应用固定请求 `read:user repo`（见 `apps/web/lib/auth.ts`）：

- `read:user`：读基础资料（头像、用户名），用于顶栏与账号页；
- `repo`：读**含私有仓库**的仓库列表与提交、并执行写操作（建分支 / 建 Issue / 建 PR / 合并 / 删分支）。
  私有仓库是明确的产品范围（见 `docs/requirements.md`），所以不能用更小的 `public_repo`。

用户可在授权页取消勾选、或事后在 GitHub 的 Applications 里撤销；应用侧也提供「撤销授权」入口（`/me`）。

### 3.4 授权失败的常见原因

| 现象                                                       | 原因                                                                       | 处理                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `The redirect_uri is not associated with this application` | 回调地址与实际访问地址不一致（常见：仍留 `localhost`、少了端口、结尾斜杠） | 按 §3.2 逐字符改；改完立刻生效，无需重启应用                            |
| `bad_verification_code`                                    | code 已被用过 / 过期（超过 10 分钟），或前端重复提交                       | 重新点登录；确认系统时间正确                                            |
| `access_denied`                                            | 用户在授权页点了取消                                                       | 正常路径，回到登录页重试即可                                            |
| 登录成功但 `/repos` 空                                     | 组织启用了 SAML SSO 但未授权该 OAuth App，或账号确实没有仓库               | 组织 Settings → SSO 里为该 App 授权；应用内 `/permissions` 页有排查路径 |
| 换了域名后所有人都要重新登录                               | `AUTH_SECRET` 变了，或 Cookie 域变了                                       | 保持 `AUTH_SECRET` 稳定；换域名属于预期内的重新登录                     |

## 4. 路径 A：Vercel + 托管 PostgreSQL

最短路径（完整步骤、坑位对照、基线化已有库见 [`docs/deployment.md`](deployment.md) §3）：

1. 建库（Neon / Supabase），拿到**直连串**（迁移用）与 **pooled 串**（运行期用）。
2. 生成两个密钥，**互不相同、不要复用本地值**：
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # AUTH_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # AUTH_TOKEN_ENC_KEY
   ```
3. 按 §3 建 OAuth App，回调填 `https://<域名>/api/auth/callback/github`。
4. Vercel 导入仓库，**Root Directory 设为 `apps/web`**；构建 / 安装命令由 `apps/web/vercel.json` 固化，后台保持空白。
5. 注入环境变量（**最小集**）：`DATABASE_URL`、`AUTH_SECRET`、`AUTH_TOKEN_ENC_KEY`、`AUTH_GITHUB_ID`、`AUTH_GITHUB_SECRET`、`STORE_BACKEND=postgres`。
6. 本地对生产库**直连串**执行迁移：`pnpm --filter @utf8-git/web exec prisma migrate deploy`。
7. Redeploy，然后按 §7 自检。

> `STORE_BACKEND` 不设会退回 `memory`：Serverless 多实例下缓存与游标链按实例隔离，翻页会随机 409 `cursor_expired`。
> 这是部署后最容易漏、症状最迷惑的一项，`GET /api/health` 会直接报出来。

## 5. 路径 B：单机 Node + 反向代理

以下命令在**仓库根目录**执行，以 `/srv/utf8-git` 为部署目录、`git.example.com` 为对外域名示例。

### 5.1 建库

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE utf8git LOGIN PASSWORD '换成强密码';
CREATE DATABASE utf8git OWNER utf8git;
SQL
```

连接串形如 `postgresql://utf8git:换成强密码@127.0.0.1:5432/utf8git?schema=public`。
数据库只监听 `127.0.0.1`，不要对公网开放。

### 5.2 取代码、装依赖

```bash
git clone https://github.com/encode-utf8/utf8-git.git /srv/utf8-git
cd /srv/utf8-git
corepack enable                 # 按 packageManager 字段装 pnpm 12.9.1
pnpm install --frozen-lockfile
```

> 仓库根 `.npmrc` 指向国内镜像（`registry.npmmirror.com`）。海外机器装依赖慢或失败时，
> 加 `--registry=https://registry.npmjs.org`，或直接删掉该文件。

### 5.3 写环境变量

```bash
cp apps/web/.env.example apps/web/.env
```

**必填**（其余变量见 `deployment.md` §2）：

```dotenv
DATABASE_URL="postgresql://utf8git:换成强密码@127.0.0.1:5432/utf8git?schema=public"
AUTH_SECRET="<32 字节 base64，随机>"
AUTH_TOKEN_ENC_KEY="<另一个 32 字节 base64，随机>"
AUTH_GITHUB_ID="<OAuth App 的 Client ID>"
AUTH_GITHUB_SECRET="<OAuth App 的 Client Secret>"
# 自建必加：反代后面拿不到 Vercel 的注入，需要显式信任 Host 并给出外部地址
AUTH_TRUST_HOST="true"
AUTH_URL="https://git.example.com"
STORE_BACKEND="postgres"
```

- `AUTH_TOKEN_ENC_KEY` 必须能被解析为 **32 字节 base64**，否则登录时会加密失败；`GET /api/health` 会校验这一点。
- 两个密钥一旦上线就**不要随意更换**：换 `AUTH_SECRET` 等于让所有会话失效；换 `AUTH_TOKEN_ENC_KEY`
  会让库里已有的令牌密文无法解密（见 §6.5）。

### 5.4 迁移

```bash
pnpm --filter @utf8-git/web exec prisma migrate deploy
```

先 `status` 再 `deploy` 是个好习惯——确认打印的 `Datasource "db": ... at "<主机>"` 就是目标库，
否则命令会「成功」地打在 `.env` 里另一个库上。目标库非空但缺迁移历史时报 `P3005`，处理见 `deployment.md` §3.3。

### 5.5 构建

```bash
pnpm build
```

构建期会跑 `prisma generate`，Next 的预渲染阶段也会加载部分服务端模块（Auth.js 配置在模块初始化时读环境变量），
所以顺序是「先写 `.env` 再构建」——缺变量时容易在 build 阶段就报错，而不是等到运行时。

### 5.6 启动

```bash
pnpm --filter @utf8-git/web exec next start -H 127.0.0.1 -p 3000
```

只监听回环地址，由反向代理对外。手工验证一下再交给 systemd：

```bash
curl -s http://127.0.0.1:3000/api/health | head -c 400
```

### 5.7 systemd 单元

`/etc/systemd/system/utf8-git.service`：

```ini
[Unit]
Description=utf8-git web
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=utf8git
WorkingDirectory=/srv/utf8-git/apps/web
EnvironmentFile=/srv/utf8-git/apps/web/.env
ExecStart=/usr/bin/env pnpm exec next start -H 127.0.0.1 -p 3000
Restart=on-failure
RestartSec=3
# 让 pnpm / node 走系统 PATH（corepack 装的 pnpm 在用户目录下时尤其需要）
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now utf8-git
sudo journalctl -u utf8-git -f          # 看日志（结构化 JSON，一行一条）
```

### 5.8 Nginx 反代

```nginx
server {
  listen 443 ssl http2;
  server_name git.example.com;

  # certbot 生成；见 §5.9
  ssl_certificate     /etc/letsencrypt/live/git.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/git.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;          # 应用侧出网超时是 15s，留出余量
  }
}
```

- `Host` 与 `X-Forwarded-Proto` 必须透传：Auth.js 靠它们判定外部地址与 Cookie 的 `Secure` 属性。
  再配合 `AUTH_TRUST_HOST=true`，回调地址才会是 `https://…` 而不是 `http://127.0.0.1:3000`。
- 80 端口留一个 `return 301 https://$host$request_uri;` 即可。

### 5.9 HTTPS

```bash
sudo certbot --nginx -d git.example.com
```

**不要**在纯 HTTP 下对外提供服务：GitHub 的 OAuth 回调允许 `http://localhost`，但线上地址必须是 HTTPS，
否则会话 Cookie 无法带 `Secure`，令牌与授权码都在明文链路上。

## 6. 运维手册

### 6.1 升级

```bash
cd /srv/utf8-git
git pull --ff-only
pnpm install --frozen-lockfile
pnpm --filter @utf8-git/web exec prisma migrate deploy   # 先迁移，再重启
pnpm build
sudo systemctl restart utf8-git
```

迁移必须先于新代码上线，且**只做前向兼容变更**（先加列 → 双写 → 再删列），这样旧进程在滚动期间不会读不到列。

### 6.2 回滚

- 应用层：`git checkout <上一个 tag 或 commit>` → 重跑 §6.1 的安装与构建 → `restart`。
  保留 `.next` 备份更快：`cp -a apps/web/.next /srv/utf8-git/.next.bak`，回滚时换回来。
- 数据库层：**不做自动 down**。Prisma 迁移默认单向，手写回滚脚本容易造成半状态；
  正确做法是靠前向兼容设计把「回滚」变成「应用回退、数据继续向前」。

### 6.3 备份

```bash
pg_dump --format=custom --no-owner "postgresql://utf8git:密码@127.0.0.1:5432/utf8git" > utf8git-$(date +%F).dump
# 恢复演练（别等到真出事才第一次用）
pg_restore --clean --no-owner -d "postgresql://utf8git:密码@127.0.0.1:5432/utf8git" utf8git-2026-10-18.dump
```

库里有三类东西必须备：会话（用户不必反复登录）、**令牌密文**（丢了要重新授权）、写操作审计（合规与「24h 撤销分支」的依据）。
审计表默认保留 90 天（`OPERATION_AUDIT_RETENTION_DAYS`），写入时按概率清理。

### 6.4 观测

- 日志：一行一条 JSON，字段先脱敏再落盘；`LOG_LEVEL=debug` 只在排查时临时开。
- 请求串联：响应头带 `x-request-id`（也可由反代传入），日志与错误上报都带同一个 id。
- 错误上报：设 `ERROR_REPORT_ENDPOINT` 后，未捕获错误会 POST 一份 JSON 过去（`withObservability` 统一处理，5xx 也上报）；
  不设则只写日志。
- 健康检查：`GET /api/health`，全通过 200、任一失效 503，可直接给负载均衡 / uptime 监控用。

### 6.5 密钥轮换

| 密钥                 | 轮换后果                                               | 建议做法                                             |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `AUTH_GITHUB_SECRET` | 无（只用于换取令牌）                                   | 随时可在 GitHub 重新生成后替换，重启生效             |
| `AUTH_SECRET`        | 所有会话失效，用户需重新登录（令牌密文不受影响）       | 接受一次全员重登；换完观察 `/api/health`             |
| `AUTH_TOKEN_ENC_KEY` | **已有令牌密文全部无法解密**，每个用户都要重新授权一次 | 目前无在线重加密工具；如需轮换，安排在低峰并提前公告 |

### 6.6 单实例与多实例

- 单实例：`STORE_BACKEND=memory` 可用（进程内缓存 + 限流快照），重启即丢缓存，不影响正确性。
- 多实例 / 容器横向扩容：必须 `STORE_BACKEND=postgres`，否则翻页随机 409、限流判定各实例各算。
- 令牌续期已做跨实例去重（失败方会重读库中最新令牌），但两个实例同时刷新且都失败时仍需重新授权。

## 7. 上线自检

```bash
pnpm deploy:selfcheck                                        # 默认校验生产域名
node scripts/deploy-selfcheck.mjs --base=https://git.example.com
node scripts/deploy-selfcheck.mjs --base=http://127.0.0.1:3000   # 单机形态先自查回环
```

脚本覆盖：静态页可达、未登录一律 401、Auth.js 生产 Cookie 前缀、OAuth 跳转的 `redirect_uri` 是否等于部署域名、
`/api/health` 逐项明细（`STORE_BACKEND`、数据库连通、迁移表齐全、必填密钥、加密密钥长度）。

⚠️ 它**无法**验证回调地址是否已在 GitHub 登记（GitHub 只在已登录状态校验），脚本结尾会打印「应登记的地址」，人工比对一次。

人工再走一遍关键路径：登录 → `/repos` 列表 → 打开仓库时间线 → 建分支 → 操作历史里能看到这条记录 → `/me` 导出审计。

## 8. 已知限制

- **不提供官方 Docker 镜像**：镜像构建与运行没有进 CI（仓库里也没有 Docker 环境），
  与其发布一个没人验证过的产物，不如明确说明。要容器化可自行封装：多阶段构建、`next start` 作为入口、
  把 `apps/web/.env` 换成运行时环境变量即可；若希望用 `output: "standalone"` 瘦身，
  注意 pnpm workspace 需要把 `outputFileTracingRoot` 指到仓库根。
- **英文路径无 E2E 覆盖、时间格式未本地化**（与 TODO-256 的「已知问题」同口径）。
- **Webhook 准实时更新未做**（BLOCK-03）：时间线靠拉取 + 短 TTL 缓存，最坏延迟约 2 分钟。
- **OAuth App 而非 GitHub App**：无法安装到组织、无法细粒度按仓库授权，授权范围是账号级 `repo`。
- **审计导出上限 1000 条操作**（预取 3000 条原始记录），超出请直接用 SQL 查 `operation_audit`。
