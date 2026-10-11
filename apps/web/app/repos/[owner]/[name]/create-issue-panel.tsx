"use client";

import { useCallback, useMemo, useState } from "react";

import { fetchJsonWithRetry } from "@/lib/client-fetch";
import type { ExplainMode } from "@/lib/glossary";
import { useTranslator } from "@/lib/i18n/client";
import {
  ISSUE_LABEL_MAX_LENGTH,
  ISSUE_LABELS_MAX_COUNT,
  ISSUE_TITLE_MAX_LENGTH,
  createIssueDescriptor,
  describeCreateIssueFailure,
  parseIssueLabels,
  validateIssueLabels,
  validateIssueTitle,
} from "@/lib/issue-ops";
import { confirmationView } from "@/lib/operations";

import { ConceptNote } from "./concept-note";
import { ConfirmCard } from "./confirm-card";
import { MarkdownPreview } from "./markdown-preview";

type CreateIssuePanelProps = {
  owner: string;
  name: string;
  /** 术语解释模式（新手 / 进阶时在表单上方内联说明 Issue 是什么）。 */
  mode: ExplainMode;
  /** 创建成功后由父组件展示提示并关闭面板（携带 Issue 编号文案）。 */
  onCreated: (message: string) => void;
  onCancel: () => void;
};

const FIELD_CLASS =
  "w-full rounded-lg border border-black/[.08] bg-white px-3 text-xs text-zinc-700 placeholder:text-zinc-400 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200";

/**
 * 创建 Issue 面板（M3-3）：标题 / 正文（Markdown 预览）/ 标签三段表单，
 * 复用确认卡片与统一写管线。状态内聚在此，父组件只负责开关与成功提示。
 */
export function CreateIssuePanel({
  owner,
  name,
  mode,
  onCreated,
  onCancel,
}: CreateIssuePanelProps) {
  const { t } = useTranslator();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const titleError = trimmedTitle ? validateIssueTitle(title, t) : null;
  const labelList = useMemo(() => parseIssueLabels(labels), [labels]);
  const labelsError = labelList.length > 0 ? validateIssueLabels(labelList, t) : null;

  // 确认卡片与审计共用同一份描述：标题留空时也渲染卡片，提示信息才不会消失
  const view = useMemo(
    () =>
      confirmationView(
        createIssueDescriptor({ owner, name, title: trimmedTitle, body, labels: labelList }, t),
        t,
      ),
    [body, labelList, name, owner, t, trimmedTitle],
  );

  const submit = useCallback(async () => {
    if (pending) {
      return;
    }
    const titleProblem = validateIssueTitle(title, t);
    if (titleProblem) {
      setError(titleProblem);
      return;
    }
    const parsedLabels = parseIssueLabels(labels);
    const labelProblem = validateIssueLabels(parsedLabels, t);
    if (labelProblem) {
      setError(labelProblem);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetchJsonWithRetry(
        `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/operations/create-issue`,
        {
          body: JSON.stringify({
            title: title.trim(),
            body,
            labels: parsedLabels.join(","),
            confirmed: true,
          }),
          t,
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        number?: number;
        title?: string;
      };
      if (!response.ok) {
        setError(describeCreateIssueFailure(response.status, data.error, t));
        return;
      }
      // 回放（幂等命中）同样带编号，用上游返回值拼提示，避免与本地状态不一致
      const numberLabel =
        typeof data.number === "number" && data.number > 0 ? `#${data.number} ` : "";
      onCreated(
        t("panels.createIssue.created", { number: numberLabel, title: data.title || title.trim() }),
      );
    } catch {
      setError(t("panels.createIssue.networkError"));
    } finally {
      setPending(false);
    }
  }, [body, labels, name, onCreated, owner, pending, t, title]);

  return (
    <ConfirmCard
      view={view}
      pending={pending}
      error={error}
      onConfirm={() => void submit()}
      onCancel={onCancel}
    >
      <ConceptNote id="issue" mode={mode} className="mt-3" />
      <div className="mt-3 space-y-1">
        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="new-issue-title">
          {t("panels.createIssue.title")}
        </label>
        <input
          id="new-issue-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("panels.createIssue.titlePlaceholder")}
          className={`h-9 ${FIELD_CLASS}`}
        />
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {titleError ?? t("panels.createIssue.titleHint", { max: ISSUE_TITLE_MAX_LENGTH })}
        </p>

        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="new-issue-body">
          {t("panels.createIssue.body")}
        </label>
        <textarea
          id="new-issue-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          placeholder={t("panels.createIssue.bodyPlaceholder")}
          className={`py-2 ${FIELD_CLASS}`}
        />

        <label
          className="block text-xs text-zinc-600 dark:text-zinc-300"
          htmlFor="new-issue-labels"
        >
          {t("panels.createIssue.labels")}
        </label>
        <input
          id="new-issue-labels"
          value={labels}
          onChange={(event) => setLabels(event.target.value)}
          placeholder="bug, ui"
          className={`h-9 max-w-sm ${FIELD_CLASS}`}
        />
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {labelsError ??
            t("panels.createIssue.labelsHint", {
              count: ISSUE_LABELS_MAX_COUNT,
              max: ISSUE_LABEL_MAX_LENGTH,
            })}
        </p>
      </div>

      <div className="mt-3">
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {t("panels.createIssue.bodyPreview")}
        </p>
        <div className="mt-1 rounded-lg border border-black/[.08] p-2 dark:border-white/[.145]">
          <MarkdownPreview source={body} />
        </div>
      </div>
    </ConfirmCard>
  );
}
