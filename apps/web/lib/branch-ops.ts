// M3-2 创建分支：分支名校验与操作描述构造（纯逻辑，前后端共用，无 IO）。

import { shortSha } from "./commit-format";
import { describeOperationFailure, repositorySlug, type OperationDescriptor } from "./operations";

export const BRANCH_NAME_MAX_LENGTH = 255;

// Git 引用名非法字符：控制字符、空格与 ~ ^ : ? * [ \（git check-ref-format 规则）
const ILLEGAL_CHARS = /[\x00-\x1f\x7f ~^:?*\[\\]/;

/** 校验分支名；通过返回 null，否则返回可读的中文原因。 */
export function validateBranchName(name: string): string | null {
  if (!name) {
    return "分支名不能为空。";
  }
  if (name.length > BRANCH_NAME_MAX_LENGTH) {
    return `分支名不能超过 ${BRANCH_NAME_MAX_LENGTH} 个字符。`;
  }
  if (ILLEGAL_CHARS.test(name)) {
    return "分支名不能包含空格或 ~ ^ : ? * [ \\ 等特殊字符。";
  }
  if (name.startsWith("-")) {
    return "分支名不能以 - 开头。";
  }
  if (name.startsWith("/") || name.endsWith("/")) {
    return "分支名不能以 / 开头或结尾。";
  }
  if (name.endsWith(".")) {
    return "分支名不能以 . 结尾。";
  }
  if (name === "@") {
    return "分支名不能是 @。";
  }
  if (name.includes("..")) {
    return "分支名不能包含连续的 ..";
  }
  if (name.includes("@{")) {
    return "分支名不能包含 @{";
  }
  if (name.includes("//")) {
    return "分支名不能包含连续的 //";
  }
  for (const part of name.split("/")) {
    if (!part) {
      return "分支名的每一段都不能为空。";
    }
    if (part.startsWith(".")) {
      return "分支名的每一段都不能以 . 开头。";
    }
    if (part.endsWith(".lock")) {
      return "分支名的每一段都不能以 .lock 结尾。";
    }
  }
  return null;
}

export type CreateBranchInput = {
  owner: string;
  name: string;
  branch: string;
  fromSha: string;
  fromLabel: string;
};

/** 构造「创建分支」操作描述：确认卡片与审计记录共用同一份数据。 */
export function createBranchDescriptor(input: CreateBranchInput): OperationDescriptor {
  const { owner, name, branch, fromSha, fromLabel } = input;
  const repo = repositorySlug({ owner, name });
  return {
    kind: "createBranch",
    repo: { owner, name },
    summary: `在 ${repo} 创建分支 ${branch}`,
    impacts: [
      `基于 ${fromLabel}（${shortSha(fromSha)}）新建分支 ${branch}`,
      "不会修改任何现有分支或提交",
    ],
    payload: { branch, from: fromSha },
  };
}

/** 把创建分支接口的失败映射为可读文案（供客户端展示）。 */
export function describeCreateBranchFailure(status: number, code?: string): string {
  return describeOperationFailure(status, code, "分支已存在或名称不被接受，请换一个名字。");
}
