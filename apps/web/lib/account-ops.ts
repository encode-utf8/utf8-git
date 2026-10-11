// M3-9 账号数据与授权：撤销 GitHub 授权 / 清除本应用数据（纯逻辑，前后端共用，无 IO）。
//
// 这两类操作不针对某个仓库，但写操作管线（幂等键 / 审计 / 频率限制）都以「仓库」为上下文，
// 因此统一挂在一个约定的账号作用域下（`account/self`）。它在 GitHub 上不存在，
// 只用来让审计记录可区分「账号级操作」与「仓库级操作」。
// 文案取自消息目录（`ops.account.*`）：默认源语言，组件传入当前语言的 `t` 时随语言切换。

import { sourceTranslate, type Translate } from "./i18n/translate";
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
export function createRevokeAuthorizationDescriptor(
  t: Translate = sourceTranslate,
): OperationDescriptor {
  return {
    kind: "revokeAuthorization",
    repo: ACCOUNT_SCOPE,
    summary: t("ops.account.revokeSummary"),
    impacts: [
      t("ops.account.revokeImpact1"),
      t("ops.account.revokeImpact2"),
      t("ops.account.revokeImpact3"),
      t("ops.account.revokeImpact4"),
    ],
    payload: { provider: "github" },
  };
}

/** 构造「清除我的数据」操作描述（影响预览里带上将要删除的审计条数）。 */
export function createPurgeAccountDataDescriptor(
  input: PurgeAccountDataInput,
  t: Translate = sourceTranslate,
): OperationDescriptor {
  const records = Math.max(0, Math.trunc(input.auditRecords));
  return {
    kind: "purgeAccountData",
    repo: ACCOUNT_SCOPE,
    summary: t("ops.account.purgeSummary"),
    impacts: [
      t("ops.account.purgeImpact1"),
      t("ops.account.purgeImpact2", { records }),
      t("ops.account.purgeImpact3"),
      t("ops.account.purgeImpact4"),
    ],
    payload: { records: String(records) },
  };
}

/** 把撤销授权接口的失败映射为可读文案（供客户端展示）。 */
export function describeRevokeAuthorizationFailure(
  status: number,
  code?: string,
  t: Translate = sourceTranslate,
): string {
  return describeOperationFailure(status, code, t("ops.account.revokeConflict"), t);
}

/** 把清除数据接口的失败映射为可读文案（供客户端展示）。 */
export function describePurgeDataFailure(
  status: number,
  code?: string,
  t: Translate = sourceTranslate,
): string {
  return describeOperationFailure(status, code, t("ops.account.purgeConflict"), t);
}
