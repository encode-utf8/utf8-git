import type { Adapter, AdapterUser } from "next-auth/adapters";

import { encryptToken } from "./crypto";
import { getPrismaClient } from "./prisma";

// OAuth profile 中携带的 GitHub 登录名（Auth.js 类型未内置，运行时透传）
type ProfileUser = AdapterUser & { login?: string | null };

// 数据库中的用户字段（Prisma 返回值的最小子集）
type StoredUser = {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: Date | null;
  image: string | null;
};

// Auth.js 的 AdapterUser.email 声明为非空字符串，而 GitHub 用户可能隐藏邮箱（存库为 null）
function toAdapterUser(user: StoredUser): AdapterUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? "",
    emailVerified: user.emailVerified,
    image: user.image,
  };
}

// 从 AdapterAccount 的宽松值类型中安全读取字符串 / 数字
function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

// 自定义 Prisma 适配器：
// - 令牌字段（access / refresh / id token）落库前统一用 AES-256-GCM 加密
// - 其余方法遵循 Auth.js 数据库会话契约
export function createAuthAdapter(): Adapter {
  return {
    async createUser(user) {
      const profile = user as ProfileUser;
      const created = await getPrismaClient().user.create({
        data: {
          id: profile.id,
          name: profile.name ?? null,
          email: profile.email || null,
          emailVerified: profile.emailVerified ?? null,
          image: profile.image ?? null,
          githubLogin: profile.login ?? null,
        },
      });
      return toAdapterUser(created);
    },

    async getUser(id) {
      const user = await getPrismaClient().user.findUnique({ where: { id } });
      return user ? toAdapterUser(user) : null;
    },

    async getUserByEmail(email) {
      const user = await getPrismaClient().user.findUnique({ where: { email } });
      return user ? toAdapterUser(user) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const account = await getPrismaClient().account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        include: { user: true },
      });
      return account ? toAdapterUser(account.user) : null;
    },

    async updateUser({ id, ...data }) {
      const updated = await getPrismaClient().user.update({
        where: { id },
        data: {
          name: data.name,
          email: data.email === undefined ? undefined : data.email || null,
          emailVerified: data.emailVerified,
          image: data.image,
        },
      });
      return toAdapterUser(updated);
    },

    async linkAccount(account) {
      await getPrismaClient().account.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          accessTokenEnc: encryptToken(readText(account.access_token)),
          refreshTokenEnc: encryptToken(readText(account.refresh_token)),
          idTokenEnc: encryptToken(readText(account.id_token)),
          expiresAt: readNumber(account.expires_at),
          tokenType: readText(account.token_type),
          scope: readText(account.scope),
          sessionState: readText(account.session_state),
        },
      });
    },

    async createSession(session) {
      const created = await getPrismaClient().session.create({ data: session });
      return {
        sessionToken: created.sessionToken,
        userId: created.userId,
        expires: created.expires,
      };
    },

    async getSessionAndUser(sessionToken) {
      const session = await getPrismaClient().session.findUnique({
        where: { sessionToken },
        include: { user: true },
      });
      if (!session) {
        return null;
      }
      return {
        session: {
          sessionToken: session.sessionToken,
          userId: session.userId,
          expires: session.expires,
        },
        user: toAdapterUser(session.user),
      };
    },

    async updateSession({ sessionToken, expires }) {
      const updated = await getPrismaClient().session.update({
        where: { sessionToken },
        data: { expires: expires ?? undefined },
      });
      return {
        sessionToken: updated.sessionToken,
        userId: updated.userId,
        expires: updated.expires,
      };
    },

    async deleteSession(sessionToken) {
      await getPrismaClient().session.deleteMany({ where: { sessionToken } });
    },
  };
}
