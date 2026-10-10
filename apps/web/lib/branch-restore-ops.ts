// M3-6 分支恢复：可恢复性判定与操作描述构造（纯逻辑，前后端共用，无 IO）。
// 恢复窗口固定 24h；删除记录由写操作审计（operation_audit）保存，其中含删除前的分支头 SHA。

import { shortSha } from "./commit-format";
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
export function evaluateBranchRestore(input: BranchRestoreInput): BranchRestoreVerdict {
  const branch = input.branch.trim();
  if (!branch) {
    return { canRestore: false, reason: "缺少要恢复的分支名。" };
  }
  if (!input.sha) {
    return { canRestore: false, reason: "该删除记录没有保存提交 SHA，无法恢复。" };
  }
  const deletedAt = new Date(input.recordedAt).getTime();
  if (!Number.isFinite(deletedAt)) {
    return { canRestore: false, reason: "删除记录的时间无效，无法恢复。" };
  }
  const now = input.now ?? Date.now();
  if (now - deletedAt > RESTORE_WINDOW_MS) {
    return {
      canRestore: false,
      reason: `已超出 ${RESTORE_WINDOW_HOURS} 小时恢复窗口，无法恢复。`,
    };
  }
  return { canRestore: true, reason: null };
}

/** 剩余恢复时间的中文描述（候选列表展示用）。 */
export function describeRestoreRemaining(recordedAt: string, now: number = Date.now()): string {
  const remaining = new Date(recordedAt).getTime() + RESTORE_WINDOW_MS - now;
  if (!Number.isFinite(remaining)) {
    return "恢复窗口未知";
  }
  if (remaining <= 0) {
    return "恢复窗口已过期";
  }
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  if (hours >= 1) {
    return `剩余约 ${hours} 小时`;
  }
  const minutes = Math.max(1, Math.ceil(remaining / (60 * 1000)));
  return `剩余约 ${minutes} 分钟`;
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
export function createRestoreBranchDescriptor(input: RestoreBranchInput): OperationDescriptor {
  const { owner, name, sha, source } = input;
  const branch = input.branch.trim();
  const repo = repositorySlug({ owner, name });
  return {
    kind: "restoreBranch",
    repo: { owner, name },
    summary: `在 ${repo} 恢复分支 ${branch}`,
    impacts: [
      `把分支 ${branch} 重新指向删除前的提交 ${shortSha(sha)}`,
      "不会修改其他分支或提交",
      "恢复后的分支不继承原保护规则，如需保护请在 GitHub 仓库设置中重新开启",
    ],
    payload: { branch, from: sha, source },
  };
}

/** 把恢复分支接口的失败映射为可读文案（供客户端展示）。 */
export function describeRestoreBranchFailure(status: number, code?: string): string {
  return describeOperationFailure(
    status,
    code,
    "分支已存在或提交 SHA 已不可达，无法恢复，请刷新后重试。",
  );
}
