// M3-9 账号数据：撤销授权 / 清除数据要动的那几处存储，收敛在这里。
//
// 依赖全部可注入：默认实现走 data-stores（内存 / Postgres 双后端）与 Prisma，
// 单测传入假实现即可验证「删了什么、按什么顺序删」，不需要数据库。

import { getDataStores, invalidateUserCaches } from "./data-stores";
import { getPrismaClient } from "./prisma";

export type AccountDataDeps = {
  /** 删除某个操作人的全部写操作审计记录，返回条数。 */
  deleteAuditRecords?: (actor: string) => Promise<number>;
  /** 删除该用户的 GitHub 配额快照。 */
  deleteRateLimitSnapshot?: (userId: string) => Promise<void>;
  /** 按用户前缀失效仓库列表 / 时间线 / 游标链 / 提交详情缓存。 */
  invalidateCaches?: (userId: string) => Promise<void>;
  /** 删除 OAuth 账号记录（令牌密文）与全部登录会话。 */
  deleteTokensAndSessions?: (userId: string) => Promise<void>;
  /** 删除用户记录本身（级联清掉账号与会话）。 */
  deleteUser?: (userId: string) => Promise<void>;
};

export type PurgeSummary = {
  /** 被删除的写操作审计记录条数。 */
  auditRecords: number;
};

async function deleteTokensAndSessionsDefault(userId: string): Promise<void> {
  const prisma = getPrismaClient();
  // 先用 deleteMany 而不是 delete：重复调用（或数据已被部分清除）不应报错
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
}

async function deleteUserDefault(userId: string): Promise<void> {
  // User 上 accounts / sessions 是级联删除，这里仍显式调用一次，保证语义与顺序可读
  await getPrismaClient().user.deleteMany({ where: { id: userId } });
}

/**
 * 撤销授权后的本地清理：删掉不再有效的令牌密文与登录会话，并清掉缓存与配额快照。
 * 保留用户记录与审计（用户可能只是换一次授权，不需要重建账号）。
 */
export async function clearAuthorizationData(
  userId: string,
  deps: AccountDataDeps = {},
): Promise<void> {
  const deleteRateLimitSnapshot =
    deps.deleteRateLimitSnapshot ?? ((id) => getDataStores().rateLimitStore.delete(id));
  const invalidateCaches = deps.invalidateCaches ?? invalidateUserCaches;
  const deleteTokensAndSessions = deps.deleteTokensAndSessions ?? deleteTokensAndSessionsDefault;

  await deleteTokensAndSessions(userId);
  await invalidateCaches(userId);
  await deleteRateLimitSnapshot(userId);
}

/**
 * 清除本应用内属于该用户的全部数据（GDPR 友好）：
 * 审计记录 → 缓存 / 配额快照 → 账号与会话 → 用户记录。
 * 不含 GitHub 侧的数据——那些属于用户自己的 GitHub 账号，本应用从未写过。
 */
export async function purgeAccountData(
  userId: string,
  deps: AccountDataDeps = {},
): Promise<PurgeSummary> {
  const deleteAuditRecords =
    deps.deleteAuditRecords ?? ((actor) => getDataStores().operationAudit.deleteByActor(actor));
  const auditRecords = await deleteAuditRecords(userId);

  await clearAuthorizationData(userId, deps);
  await (deps.deleteUser ?? deleteUserDefault)(userId);

  return { auditRecords };
}
