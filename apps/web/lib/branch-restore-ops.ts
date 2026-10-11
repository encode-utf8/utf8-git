// M3-6 分支恢复：可恢复性判定与操作描述构造（纯逻辑，前后端共用，无 IO）。
// 恢复窗口固定 24h；删除记录由写操作审计（operation_audit）保存，其中含删除前的分支头 SHA。

import { shortSha } from "./commit-format";
import { sourceTranslate, type Translate } from "./i18n/translate";
import { describeOperationFailure, repositorySlug, type OperationDescriptor } from "./operations";

export const RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RESTORE_WINDOW_HOURS = RESTORE_WINDOW_MS / (60 * 60 * 1000);

/** 删除记录的恢复截止时间。 */
export function restoreDeadline(recordedAt: string): Date {
  return new Date(new Date(recordedAt).getTime() + RESTORE_WINDOW_MS);
}

export type BranchRestoreInput = {
  branch: string;
  /** 删除记录中保存的分支头 SHA；缺失则无法重建引用。 */
  sha: string | null;
  /** 删除操作的时间（ISO）。 */
  recordedAt: string;
  now?: number;
};

export type BranchRestoreVerdict = {
  canRestore: boolean;
  /** 不可恢复的可读原因；可恢复时为 null。 */
  reason: string | null;
};

/** 判定删除记录能否在恢复窗口内撤销。 */
export function evaluateBranchRestore(
  input: BranchRestoreInput,
  t: Translate = sourceTranslate,
): BranchRestoreVerdict {
  const branch = input.branch.trim();
  if (!branch) {
    return { canRestore: false, reason: t("ops.restore.missingBranch") };
  }
  if (!input.sha) {
    return { canRestore: false, reason: t("ops.restore.missingSha") };
  }
  const deletedAt = new Date(input.recordedAt).getTime();
  if (!Number.isFinite(deletedAt)) {
    return { canRestore: false, reason: t("ops.restore.invalidTime") };
  }
  const now = input.now ?? Date.now();
  if (now - deletedAt > RESTORE_WINDOW_MS) {
    return {
      canRestore: false,
      reason: t("ops.restore.windowExpired", { hours: RESTORE_WINDOW_HOURS }),
    };
  }
  return { canRestore: true, reason: null };
}

/** 剩余恢复时间的可读描述（候选列表展示用）。 */
export function describeRestoreRemaining(
  recordedAt: string,
  now: number = Date.now(),
  t: Translate = sourceTranslate,
): string {
  const remaining = new Date(recordedAt).getTime() + RESTORE_WINDOW_MS - now;
  if (!Number.isFinite(remaining)) {
    return t("ops.restore.unknownWindow");
  }
  if (remaining <= 0) {
    return t("ops.restore.expired");
  }
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  if (hours >= 1) {
    return t("ops.restore.remainingHours", { hours });
  }
  const minutes = Math.max(1, Math.ceil(remaining / (60 * 1000)));
  return t("ops.restore.remainingMinutes", { minutes });
}

export type RestoreBranchInput = {
  owner: string;
  name: string;
  branch: string;
  sha: string;
  /**
   * 来源删除记录的幂等键：既作为审计溯源，也让「删 → 恢复 → 再删 → 再恢复」
   * 各自生成独立幂等键，避免命中历史成功记录而被当作回放（静默不执行）。
   */
  source: string;
};

/** 构造「恢复分支」操作描述：确认卡片与审计记录共用同一份数据。 */
export function createRestoreBranchDescriptor(
  input: RestoreBranchInput,
  t: Translate = sourceTranslate,
): OperationDescriptor {
  const { owner, name, sha, source } = input;
  const branch = input.branch.trim();
  const repo = repositorySlug({ owner, name });
  return {
    kind: "restoreBranch",
    repo: { owner, name },
    summary: t("ops.descriptor.restoreBranch.summary", { repo, branch }),
    impacts: [
      t("ops.descriptor.restoreBranch.rePoint", { branch, sha: shortSha(sha) }),
      t("ops.descriptor.restoreBranch.noChange"),
      t("ops.descriptor.restoreBranch.noProtection"),
    ],
    payload: { branch, from: sha, source },
  };
}

/** 把恢复分支接口的失败映射为可读文案（供客户端展示）。 */
export function describeRestoreBranchFailure(
  status: number,
  code?: string,
  t: Translate = sourceTranslate,
): string {
  return describeOperationFailure(status, code, t("ops.conflict.restoreBranch"), t);
}
