// M3-5 删除分支：可删除性判定与操作描述构造（纯逻辑，前后端共用，无 IO）。
// 判定顺序即优先级：默认分支 > 受保护分支 > 当前正在查看的分支。

import { describeOperationFailure, repositorySlug, type OperationDescriptor } from "./operations";

export type BranchDeletionInput = {
  branch: string;
  /** 仓库默认分支（来自仓库元数据）。 */
  defaultBranch: string | null;
  /** 上游分支保护规则：受保护的分支禁止删除。 */
  protectedBranch: boolean;
  /** 时间线当前正在查看的分支；删除它会丢失当前浏览上下文。 */
  currentBranch: string | null;
};

export type BranchDeletionVerdict = {
  canDelete: boolean;
  /** 不可删除的可读原因；可删除时为 null。 */
  reason: string | null;
};

/** 判定分支能否删除，并给出不可删除的原因。 */
export function evaluateBranchDeletion(input: BranchDeletionInput): BranchDeletionVerdict {
  const branch = input.branch.trim();
  if (!branch) {
    return { canDelete: false, reason: "请选择要删除的分支。" };
  }
  if (input.defaultBranch && branch === input.defaultBranch) {
    return { canDelete: false, reason: "默认分支不能删除。" };
  }
  if (input.protectedBranch) {
    return { canDelete: false, reason: "该分支受保护规则保护，不能删除。" };
  }
  if (input.currentBranch && branch === input.currentBranch) {
    return { canDelete: false, reason: "不能删除当前正在查看的分支。" };
  }
  return { canDelete: true, reason: null };
}

/** 默认分支天然受保护（上游保护规则之外的第一道防线）。 */
export function isProtectedBranch(defaultBranch: string | null, branch: string): boolean {
  return Boolean(defaultBranch && defaultBranch === branch.trim());
}

export type DeleteBranchInput = {
  owner: string;
  name: string;
  branch: string;
  /** 删除前分支指向的提交；有值时写入影响预览与审计，便于后续恢复。 */
  headSha?: string | null;
};

/** 构造「删除分支」操作描述：确认卡片与审计记录共用同一份数据。 */
export function createDeleteBranchDescriptor(input: DeleteBranchInput): OperationDescriptor {
  const { owner, name, headSha } = input;
  const branch = input.branch.trim();
  const repo = repositorySlug({ owner, name });
  const impacts = [
    `删除分支 ${branch}，该分支引用将从仓库移除`,
    "不会删除任何提交：被删除的提交仍可被其他分支或标签引用",
  ];
  if (headSha) {
    impacts.push(`删除前分支指向 ${headSha}，如需恢复请先记录该 SHA`);
  }
  impacts.push("一键恢复将在 M3-6 提供，当前版本请自行记录 SHA");
  return {
    kind: "deleteBranch",
    repo: { owner, name },
    summary: `在 ${repo} 删除分支 ${branch}`,
    impacts,
    payload: headSha ? { branch, sha: headSha } : { branch },
  };
}

/** 把删除分支接口的失败映射为可读文案（供客户端展示）。 */
export function describeDeleteBranchFailure(status: number, code?: string): string {
  return describeOperationFailure(status, code, "分支不存在、受保护或已被删除，请刷新后重试。");
}
