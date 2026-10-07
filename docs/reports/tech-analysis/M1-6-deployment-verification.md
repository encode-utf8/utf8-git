# M1-6 线上部署验收报告（Vercel + Neon）

> 关联：`docs/deployment.md` · `docs/todo.md` TODO-104 · `docs/roadmap.md` M1-6
> 验收时间：2026-10-07（本地 16:58 / 08:58 UTC）
> 生产地址：<https://utf8-git.vercel.app/>

## 1. 环境

| 项         | 值                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 应用       | Vercel Production（`main` 分支自动部署）                                                                                                         |
| 数据库     | Neon（库名 `neondb`，区域 ap-southeast-1）                                                                                                       |
| 运行时配置 | `STORE_BACKEND=postgres`；未设置 `AUTH_TRUST_HOST`（Vercel 自动信任 Host）                                                                       |
| 访问方式   | 本机直连 `vercel.app` 的 DNS 被污染（解析到 `108.160.169.175` 等不可达地址），本次验收经本地代理完成；因此下列耗时**包含代理转发开销，属保守值** |

## 2. 数据库

- 迁移：`20261004144043_init_auth`、`20261007081155_m1_6_shared_stores` 均已应用（使用**直连主机**，非 `-pooler`），
  `prisma migrate status` 输出 `Database schema is up to date!`。
- 表已建齐：`users`、`accounts`、`sessions`、`verification_tokens`、`shared_cache_entries`、`rate_limit_states`、`_prisma_migrations`。
- 登录前各业务表均为 0 行（符合预期，生产库为全新库）。

## 3. 接口验收（未登录路径）

| 检查                                            | 结果                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                                         | 200，冷 897 ms / 热 201 ms，12.3 KB                                                                                                            |
| `GET /login`                                    | 200，458–496 ms，12.0 KB                                                                                                                       |
| `GET /api/repos`                                | 401（符合预期）                                                                                                                                |
| `GET /api/repos/{owner}/{name}/timeline?page=1` | 401（符合预期）                                                                                                                                |
| `GET /api/auth/session`                         | 200                                                                                                                                            |
| `GET /api/auth/providers`                       | 200，返回 github provider，`callbackUrl = https://utf8-git.vercel.app/api/auth/callback/github`                                                |
| `GET /api/auth/csrf`                            | 200，下发 `__Host-authjs.csrf-token` / `__Secure-authjs.callback-url`（生产 HTTPS 前缀正确 → `AUTH_SECRET` 与信任主机配置正常）                |
| `POST /api/auth/signin/github`                  | 302 → `github.com/login/oauth/authorize`，`client_id` / `redirect_uri` / `scope=read:user repo` 均正确                                         |
| 打开该 authorize URL                            | 302 跳 GitHub 登录页（GitHub 要求先登录）——**该结果不能证明回调地址已注册**（未登录时 GitHub 不校验 `redirect_uri`，登录后才校验），见 §4 更正 |

## 4. 结论

- **通过**：静态页与登录页可达、鉴权边界正确（未登录一律 401）、Auth.js 生产配置生效、OAuth 跳转参数正确、Neon 迁移完整。
- **更正（用户实测反馈）**：浏览器登录时 GitHub 返回 `The redirect_uri is not associated with this application`，即 **OAuth App 回调地址未登记**；上文「打开 authorize URL 得 302 ⇒ 回调地址已注册」的推断不成立。
  - 根因：`docs/deployment.md` §3 步骤 3 原写「回调地址**追加**生产域名」，但 **GitHub OAuth App 的 Authorization callback URL 只能填一个**，无法与本地 `localhost` 共存，导致生产地址实际未登记。属**平台配置问题，非代码缺陷**。
  - 处置：文档已修正，操作步骤见 `docs/deployment.md` §3 步骤 3 与 §3.1 新增条目。
- **待用户完成**：按修正后的配置登记回调地址，再重新在浏览器完整登录一次。这是唯一能覆盖「写入会话 + 令牌加密入库 + 按令牌拉取仓库列表」的路径。
- **未验证**：Lighthouse ≥ 80（需浏览器）；纯净冷启动耗时（当前读数含代理开销）；预览部署随机域名的 OAuth 回调。

## 5. 复现方式

```powershell
# 未登录路径与 OAuth 跳转检查（本机需代理访问 vercel.app）
$env:NODE_USE_ENV_PROXY="1"; $env:HTTPS_PROXY="http://127.0.0.1:7897"
node <检查脚本>            # 生成 /api/auth/csrf → POST /api/auth/signin/github → 校验 302 目标

# 数据库迁移与状态
$env:DATABASE_URL="<Neon 直连串>"
pnpm --filter @utf8-git/web exec prisma migrate status
```
