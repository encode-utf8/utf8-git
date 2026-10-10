// M3-3 创建 Issue：字段校验与操作描述构造（纯逻辑，前后端共用，无 IO）。

import { describeOperationFailure, repositorySlug, type OperationDescriptor } from "./operations";

export const ISSUE_TITLE_MAX_LENGTH = 256;
export const ISSUE_LABEL_MAX_LENGTH = 50;
export const ISSUE_LABELS_MAX_COUNT = 10;

/** 校验 Issue 标题；通过返回 null，否则返回可读原因。 */
export function validateIssueTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) {
    return "Issue 标题不能为空。";
  }
  if (trimmed.length > ISSUE_TITLE_MAX_LENGTH) {
    return `Issue 标题不能超过 ${ISSUE_TITLE_MAX_LENGTH} 个字符。`;
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
export function validateIssueLabels(labels: string[]): string | null {
  if (labels.length > ISSUE_LABELS_MAX_COUNT) {
    return `标签最多 ${ISSUE_LABELS_MAX_COUNT} 个。`;
  }
  for (const label of labels) {
    if (label.includes("\n")) {
      return "标签不能包含换行。";
    }
    if (label.length > ISSUE_LABEL_MAX_LENGTH) {
      return `单个标签不能超过 ${ISSUE_LABEL_MAX_LENGTH} 个字符。`;
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
export function createIssueDescriptor(input: CreateIssueInput): OperationDescriptor {
  const { owner, name, title, body, labels } = input;
  const repo = repositorySlug({ owner, name });
  const trimmedTitle = title.trim();
  return {
    kind: "createIssue",
    repo: { owner, name },
    summary: `在 ${repo} 创建 Issue：${trimmedTitle}`,
    impacts: [
      `新建 Issue「${trimmedTitle}」`,
      labels.length > 0 ? `标签：${labels.join("、")}` : "不添加标签",
      "不会修改任何代码、分支或提交",
    ],
    payload: { title: trimmedTitle, body, labels: labels.join(",") },
  };
}

/** 把创建 Issue 接口的失败映射为可读文案（供客户端展示）。 */
export function describeCreateIssueFailure(status: number, code?: string): string {
  return describeOperationFailure(status, code, "Issue 标题或内容不被接受，请检查后重试。");
}
