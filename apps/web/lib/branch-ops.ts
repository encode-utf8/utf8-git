// M3-2 创建分支：分支名校验与操作描述构造（纯逻辑，前后端共用，无 IO）。
// 文案取自消息目录（`ops.*`）：默认源语言，组件传入当前语言的 `t` 时随语言切换。

import { shortSha } from "./commit-format";
import { sourceTranslate, type Translate } from "./i18n/translate";
import { describeOperationFailure, repositorySlug, type OperationDescriptor } from "./operations";

export const BRANCH_NAME_MAX_LENGTH = 255;

// Git 引用名非法字符：控制字符、空格与 ~ ^ : ? * [ \（git check-ref-format 规则）
const ILLEGAL_CHARS = /[\x00-\x1f\x7f ~^:?*\[\\]/;

/** 校验分支名；通过返回 null，否则返回可读原因。 */
export function validateBranchName(name: string, t: Translate = sourceTranslate): string | null {
  if (!name) {
    return t("ops.branchName.empty");
  }
  if (name.length > BRANCH_NAME_MAX_LENGTH) {
    return t("ops.branchName.tooLong", { max: BRANCH_NAME_MAX_LENGTH });
  }
  if (ILLEGAL_CHARS.test(name)) {
    return t("ops.branchName.illegalChars");
  }
  if (name.startsWith("-")) {
    return t("ops.branchName.leadingDash");
  }
  if (name.startsWith("/") || name.endsWith("/")) {
    return t("ops.branchName.leadingSlash");
  }
  if (name.endsWith(".")) {
    return t("ops.branchName.trailingDot");
  }
  if (name === "@") {
    return t("ops.branchName.atSign");
  }
  if (name.includes("..")) {
    return t("ops.branchName.doubleDot");
  }
  if (name.includes("@{")) {
    return t("ops.branchName.atBrace");
  }
  if (name.includes("//")) {
    return t("ops.branchName.doubleSlash");
  }
  for (const part of name.split("/")) {
    if (!part) {
      return t("ops.branchName.emptySegment");
    }
    if (part.startsWith(".")) {
      return t("ops.branchName.dotSegment");
    }
    if (part.endsWith(".lock")) {
      return t("ops.branchName.lockSegment");
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
export function createBranchDescriptor(
  input: CreateBranchInput,
  t: Translate = sourceTranslate,
): OperationDescriptor {
  const { owner, name, branch, fromSha, fromLabel } = input;
  const repo = repositorySlug({ owner, name });
  return {
    kind: "createBranch",
    repo: { owner, name },
    summary: t("ops.descriptor.createBranch.summary", { repo, branch }),
    impacts: [
      t("ops.descriptor.createBranch.from", { fromLabel, sha: shortSha(fromSha), branch }),
      t("ops.descriptor.createBranch.noChange"),
    ],
    payload: { branch, from: fromSha },
  };
}

/** 把创建分支接口的失败映射为可读文案（供客户端展示）。 */
export function describeCreateBranchFailure(
  status: number,
  code?: string,
  t: Translate = sourceTranslate,
): string {
  return describeOperationFailure(status, code, t("ops.conflict.createBranch"), t);
}
