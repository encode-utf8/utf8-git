import NextAuth, { type User } from "next-auth";
import GitHub from "next-auth/providers/github";

import { createAuthAdapter, upsertAccountTokens } from "./auth-adapter";
import { resolveGithubAuthorizeUrl } from "./github-endpoints";

// GitHub 资料会透传扩展字段（login）给适配器 createUser，这里显式声明类型
type GitHubProfileUser = User & { login?: string | null };

// Auth.js（next-auth v5）配置：
// - 数据持久化：PostgreSQL + 自定义 Prisma 适配器（令牌密文入库）
// - 会话策略：数据库会话（Cookie 仅保存随机会话令牌，HttpOnly / SameSite）
// - GitHub scope：read:user（基础资料）+ repo（用户可访问的私有仓库，决策 D2）
// - OAuth 安全：Auth.js 默认启用 state 与 PKCE
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: createAuthAdapter(),
  session: { strategy: "database" },
  pages: { signIn: "/login" },
  events: {
    // 重新授权（账号已存在）时 Auth.js 会跳过 linkAccount，令牌会停留在首次授权；
    // 这里在每次成功登录后写回最新令牌密文（修复：重新授权后仍提示授权失效）
    async signIn({ user, account }) {
      if (account?.provider === "github" && account.access_token && user.id) {
        await upsertAccountTokens(user.id, account);
      }
    },
  },
  providers: [
    GitHub({
      // 授权端点默认指向真实 GitHub；E2E 下可改道本地 mock（见 lib/github-endpoints.ts）
      authorization: { url: resolveGithubAuthorizeUrl(), params: { scope: "read:user repo" } },
      // GitHub 为 OAuth 2.0（非 OIDC），Auth.js 默认只启用 PKCE；这里显式加入 state 防 CSRF
      checks: ["pkce", "state"],
      profile(profile) {
        const user: GitHubProfileUser = {
          id: profile.id.toString(),
          name: profile.name ?? profile.login,
          email: profile.email,
          image: profile.avatar_url,
          login: profile.login,
        };
        return user;
      },
    }),
  ],
});
