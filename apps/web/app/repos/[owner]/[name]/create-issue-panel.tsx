"use client";

import { useCallback, useMemo, useState } from "react";

import { fetchJsonWithRetry } from "@/lib/client-fetch";
import {
  createIssueDescriptor,
  describeCreateIssueFailure,
  parseIssueLabels,
  validateIssueLabels,
  validateIssueTitle,
} from "@/lib/issue-ops";
import { confirmationView } from "@/lib/operations";

import { ConfirmCard } from "./confirm-card";
import { MarkdownPreview } from "./markdown-preview";

type CreateIssuePanelProps = {
  owner: string;
  name: string;
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
export function CreateIssuePanel({ owner, name, onCreated, onCancel }: CreateIssuePanelProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const titleError = trimmedTitle ? validateIssueTitle(title) : null;
  const labelList = useMemo(() => parseIssueLabels(labels), [labels]);
  const labelsError = labelList.length > 0 ? validateIssueLabels(labelList) : null;

  // 确认卡片与审计共用同一份描述：标题留空时也渲染卡片，提示信息才不会消失
  const view = useMemo(
    () =>
      confirmationView(
        createIssueDescriptor({ owner, name, title: trimmedTitle, body, labels: labelList }),
      ),
    [body, labelList, name, owner, trimmedTitle],
  );

  const submit = useCallback(async () => {
    if (pending) {
      return;
    }
    const titleProblem = validateIssueTitle(title);
    if (titleProblem) {
      setError(titleProblem);
      return;
    }
    const parsedLabels = parseIssueLabels(labels);
    const labelProblem = validateIssueLabels(parsedLabels);
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
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        number?: number;
        title?: string;
      };
      if (!response.ok) {
        setError(describeCreateIssueFailure(response.status, data.error));
        return;
      }
      // 回放（幂等命中）同样带编号，用上游返回值拼提示，避免与本地状态不一致
      const numberLabel =
        typeof data.number === "number" && data.number > 0 ? `#${data.number} ` : "";
      onCreated(`已创建 Issue ${numberLabel}${data.title || title.trim()}`);
    } catch {
      setError("网络异常，未能创建 Issue，请稍后重试。");
    } finally {
      setPending(false);
    }
  }, [body, labels, name, onCreated, owner, pending, title]);

  return (
    <ConfirmCard
      view={view}
      pending={pending}
      error={error}
      onConfirm={() => void submit()}
      onCancel={onCancel}
    >
      <div className="mt-3 space-y-1">
        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="new-issue-title">
          Issue 标题
        </label>
        <input
          id="new-issue-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="简要描述问题或需求"
          className={`h-9 ${FIELD_CLASS}`}
        />
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {titleError ?? "标题必填，最多 256 个字符。"}
        </p>

        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="new-issue-body">
          正文（Markdown）
        </label>
        <textarea
          id="new-issue-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          placeholder={"## 复现步骤\n\n- 第一步\n\n**期望**：…"}
          className={`py-2 ${FIELD_CLASS}`}
        />

        <label
          className="block text-xs text-zinc-600 dark:text-zinc-300"
          htmlFor="new-issue-labels"
        >
          标签（逗号分隔）
        </label>
        <input
          id="new-issue-labels"
          value={labels}
          onChange={(event) => setLabels(event.target.value)}
          placeholder="bug, ui"
          className={`h-9 max-w-sm ${FIELD_CLASS}`}
        />
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {labelsError ?? "最多 10 个标签，单个不超过 50 个字符。"}
        </p>
      </div>

      <div className="mt-3">
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">正文预览</p>
        <div className="mt-1 rounded-lg border border-black/[.08] p-2 dark:border-white/[.145]">
          <MarkdownPreview source={body} />
        </div>
      </div>
    </ConfirmCard>
  );
}
