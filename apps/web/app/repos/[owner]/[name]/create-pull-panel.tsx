"use client";

import { useCallback, useMemo, useState } from "react";

import { fetchJsonWithRetry } from "@/lib/client-fetch";
import {
  PR_TITLE_MAX_LENGTH,
  createPullRequestDescriptor,
  describeCreatePullRequestFailure,
  validatePullBody,
  validatePullBranches,
  validatePullTitle,
} from "@/lib/pull-ops";
import { confirmationView } from "@/lib/operations";

import { ConfirmCard } from "./confirm-card";
import { MarkdownPreview } from "./markdown-preview";

type CreatePullPanelProps = {
  owner: string;
  name: string;
  /** 仓库现有分支（base / head 都从这里选）。 */
  branches: string[];
  /** 默认目标分支（通常是仓库默认分支）。 */
  defaultBase: string | null;
  /** 创建成功后由父组件展示提示并关闭面板。 */
  onCreated: (message: string) => void;
  onCancel: () => void;
};

const FIELD_CLASS =
  "w-full rounded-lg border border-black/[.08] bg-white px-3 text-xs text-zinc-700 placeholder:text-zinc-400 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200";

function initialBase(branches: string[], defaultBase: string | null): string {
  if (defaultBase && branches.includes(defaultBase)) {
    return defaultBase;
  }
  return branches[0] ?? "";
}

function initialHead(branches: string[], base: string): string {
  return branches.find((branch) => branch !== base) ?? branches[0] ?? "";
}

/**
 * 创建 PR 面板（M3-4）：目标 / 来源分支 + 标题 + 正文（Markdown 预览）+ 草稿开关，
 * 复用确认卡片与统一写管线。
 */
export function CreatePullPanel({
  owner,
  name,
  branches,
  defaultBase,
  onCreated,
  onCancel,
}: CreatePullPanelProps) {
  const [base, setBase] = useState(() => initialBase(branches, defaultBase));
  const [head, setHead] = useState(() => initialHead(branches, initialBase(branches, defaultBase)));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const titleError = trimmedTitle ? validatePullTitle(title) : null;
  const branchError = head && base ? validatePullBranches({ head, base }) : null;

  // 确认卡片与审计共用同一份描述
  const view = useMemo(
    () =>
      confirmationView(
        createPullRequestDescriptor({
          owner,
          name,
          head,
          base,
          title: trimmedTitle,
          body,
          draft,
        }),
      ),
    [base, body, draft, head, name, owner, trimmedTitle],
  );

  const submit = useCallback(async () => {
    if (pending) {
      return;
    }
    const titleProblem = validatePullTitle(title);
    if (titleProblem) {
      setError(titleProblem);
      return;
    }
    const branchProblem = validatePullBranches({ head, base });
    if (branchProblem) {
      setError(branchProblem);
      return;
    }
    const bodyProblem = validatePullBody(body);
    if (bodyProblem) {
      setError(bodyProblem);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetchJsonWithRetry(
        `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/operations/create-pull-request`,
        {
          body: JSON.stringify({
            head: head.trim(),
            base: base.trim(),
            title: title.trim(),
            body,
            draft,
            confirmed: true,
          }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        number?: number;
        title?: string;
      };
      if (!response.ok) {
        setError(data.message ?? describeCreatePullRequestFailure(response.status, data.error));
        return;
      }
      const numberLabel =
        typeof data.number === "number" && data.number > 0 ? `#${data.number} ` : "";
      onCreated(`已创建 PR ${numberLabel}${data.title || title.trim()}`);
    } catch {
      setError("网络异常，未能创建 PR，请稍后重试。");
    } finally {
      setPending(false);
    }
  }, [base, body, draft, head, name, onCreated, owner, pending, title]);

  if (branches.length < 2) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
      >
        <p className="text-sm font-semibold">无法创建 PR</p>
        <p className="mt-1">仓库至少需要两个分支才能创建 PR，请先新建一个分支。</p>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-full border border-amber-400 px-4 text-xs font-medium transition-colors hover:bg-amber-100 dark:border-amber-600 dark:hover:bg-amber-900"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <ConfirmCard
      view={view}
      pending={pending}
      error={error}
      onConfirm={() => void submit()}
      onCancel={onCancel}
    >
      <div className="mt-3 space-y-1">
        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="pr-base">
          目标分支（base）
        </label>
        <select
          id="pr-base"
          value={base}
          onChange={(event) => setBase(event.target.value)}
          className={`h-9 max-w-sm ${FIELD_CLASS}`}
        >
          {branches.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </select>

        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="pr-head">
          来源分支（head）
        </label>
        <select
          id="pr-head"
          value={head}
          onChange={(event) => setHead(event.target.value)}
          className={`h-9 max-w-sm ${FIELD_CLASS}`}
        >
          {branches.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </select>
        {branchError ? (
          <p className="text-[11px] text-red-700 dark:text-red-300">{branchError}</p>
        ) : null}

        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="pr-title">
          PR 标题
        </label>
        <input
          id="pr-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="简要描述这次改动"
          className={`h-9 ${FIELD_CLASS}`}
        />
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {titleError ?? `标题必填，最多 ${PR_TITLE_MAX_LENGTH} 个字符。`}
        </p>

        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="pr-body">
          PR 正文（Markdown）
        </label>
        <textarea
          id="pr-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          placeholder={"## 背景\n\n- 改动点\n\n**验证**：…"}
          className={`py-2 ${FIELD_CLASS}`}
        />

        <label
          className="mt-1 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300"
          htmlFor="pr-draft"
        >
          <input
            id="pr-draft"
            type="checkbox"
            checked={draft}
            onChange={(event) => setDraft(event.target.checked)}
            className="h-4 w-4 rounded border-black/[.08] dark:border-white/[.145]"
          />
          创建为草稿
        </label>
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
