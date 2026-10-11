// M3-3 创建 Issue：字段校验与操作描述构造（纯逻辑，前后端共用，无 IO）。

import { sourceTranslate, type Translate } from "./i18n/translate";
import { describeOperationFailure, repositorySlug, type OperationDescriptor } from "./operations";

export const ISSUE_TITLE_MAX_LENGTH = 256;
export const ISSUE_LABEL_MAX_LENGTH = 50;
export const ISSUE_LABELS_MAX_COUNT = 10;

/** 校验 Issue 标题；通过返回 null，否则返回可读原因。 */
export function validateIssueTitle(title: string, t: Translate = sourceTranslate): string | null {
  const trimmed = title.trim();
  if (!trimmed) {
    return t("ops.issueTitle.empty");
  }
  if (trimmed.length > ISSUE_TITLE_MAX_LENGTH) {
    return t("ops.issueTitle.tooLong", { max: ISSUE_TITLE_MAX_LENGTH });
  }
  return null;
}

/** 解析逗号分隔的标签输入：去空白、丢空项。 */
export function parseIssueLabels(raw: string): string[] {
  return raw
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

/** 校验标签列表；通过返回 null，否则返回可读原因。 */
export function validateIssueLabels(
  labels: string[],
  t: Translate = sourceTranslate,
): string | null {
  if (labels.length > ISSUE_LABELS_MAX_COUNT) {
    return t("ops.issueLabels.tooMany", { count: ISSUE_LABELS_MAX_COUNT });
  }
  for (const label of labels) {
    if (label.includes("\n")) {
      return t("ops.issueLabels.newline");
    }
    if (label.length > ISSUE_LABEL_MAX_LENGTH) {
      return t("ops.issueLabels.tooLong", { max: ISSUE_LABEL_MAX_LENGTH });
    }
  }
  return null;
}

export type CreateIssueInput = {
  owner: string;
  name: string;
  title: string;
  body: string;
  labels: string[];
};

/** 构造「创建 Issue」操作描述：确认卡片与审计记录共用同一份数据。 */
export function createIssueDescriptor(
  input: CreateIssueInput,
  t: Translate = sourceTranslate,
): OperationDescriptor {
  const { owner, name, title, body, labels } = input;
  const repo = repositorySlug({ owner, name });
  const trimmedTitle = title.trim();
  return {
    kind: "createIssue",
    repo: { owner, name },
    summary: t("ops.descriptor.createIssue.summary", { repo, title: trimmedTitle }),
    impacts: [
      t("ops.descriptor.createIssue.created", { title: trimmedTitle }),
      labels.length > 0
        ? t("ops.descriptor.createIssue.labels", { labels: labels.join("、") })
        : t("ops.descriptor.createIssue.noLabels"),
      t("ops.descriptor.createIssue.noChange"),
    ],
    payload: { title: trimmedTitle, body, labels: labels.join(",") },
  };
}

/** 把创建 Issue 接口的失败映射为可读文案（供客户端展示）。 */
export function describeCreateIssueFailure(
  status: number,
  code?: string,
  t: Translate = sourceTranslate,
): string {
  return describeOperationFailure(status, code, t("ops.conflict.createIssue"), t);
}
