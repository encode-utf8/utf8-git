// M3-9 账号数据与授权：撤销 GitHub 授权 / 清除本应用数据（纯逻辑，前后端共用，无 IO）。
//
// 这两类操作不针对某个仓库，但写操作管线（幂等键 / 审计 / 频率限制）都以「仓库」为上下文，
// 因此统一挂在一个约定的账号作用域下（`account/self`）。它在 GitHub 上不存在，
// 只用来让审计记录可区分「账号级操作」与「仓库级操作」。

import {
  describeOperationFailure,
  type OperationDescriptor,
  type RepositoryRef,
} from "./operations";

/** 账号级操作的作用域占位仓库（不是真实仓库，仅用于审计与幂等键的上下文）。 */
export const ACCOUNT_SCOPE: RepositoryRef = { owner: "account", name: "self" };

/** 清除数据的输入：只用于让影响预览说清「删掉多少东西」。 */
export type PurgeAccountDataInput = {
  /** 本应用内该用户的写操作审计记录条数。 */
  auditRecords: number;
};

/** 构造「撤销 GitHub 授权」操作描述。 */
export function createRevokeAuthorizationDescriptor(): OperationDescriptor {
  return {
    kind: "revokeAuthorization",
    repo: ACCOUNT_SCOPE,
    summary: "撤销 utf8-git 的 GitHub 授权",
    impacts: [
      "调用 GitHub 接口撤销本应用的访问令牌，撤销后该令牌立即失效",
      "删除本应用保存的令牌密文，以及该账号的缓存与 GitHub 配额快照",
      "结束当前登录会话，需要重新登录并重新授权才能继续使用",
      "保留已有的写操作审计记录（如需全部删除请用「清除我的数据」）",
    ],
    payload: { provider: "github" },
  };
}

/** 构造「清除我的数据」操作描述（影响预览里带上将要删除的审计条数）。 */
export function createPurgeAccountDataDescriptor(
  input: PurgeAccountDataInput,
): OperationDescriptor {
  const records = Math.max(0, Math.trunc(input.auditRecords));
  return {
    kind: "purgeAccountData",
    repo: ACCOUNT_SCOPE,
    summary: "清除 utf8-git 中的账号数据",
    impacts: [
      "删除本应用保存的账号记录、令牌密文与登录会话，并立即退出登录",
      `删除你的写操作审计记录（${records} 条）与该账号的全部缓存、配额快照`,
      "尽力调用 GitHub 撤销访问令牌；即使撤销失败，本地数据仍会被清除",
      "不会影响 GitHub 上的仓库、提交、Issue 与 PR（本应用只读地展示它们）",
    ],
    payload: { records: String(records) },
  };
}

/** 把撤销授权接口的失败映射为可读文案（供客户端展示）。 */
export function describeRevokeAuthorizationFailure(status: number, code?: string): string {
  return describeOperationFailure(
    status,
    code,
    "GitHub 拒绝了本次撤销，请稍后重试；也可到 GitHub 设置 → Applications 中手动移除授权。",
  );
}

/** 把清除数据接口的失败映射为可读文案（供客户端展示）。 */
export function describePurgeDataFailure(status: number, code?: string): string {
  return describeOperationFailure(
    status,
    code,
    "数据清除未完成，请稍后重试；若反复失败请在仓库提 Issue 反馈。",
  );
}
