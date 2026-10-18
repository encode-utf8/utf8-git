"use client";

import { useCallback, useMemo, useState } from "react";

import { fetchJsonWithRetry } from "@/lib/client-fetch";
import type { ExplainMode } from "@/lib/glossary";
import { useTranslator } from "@/lib/i18n/client";
import {
  PR_TITLE_MAX_LENGTH,
  createPullRequestDescriptor,
  describeCreatePullRequestFailure,
  validatePullBody,
  validatePullBranches,
  validatePullTitle,
} from "@/lib/pull-ops";
import { confirmationView } from "@/lib/operations";

import { ConceptNote } from "./concept-note";
import { ConfirmCard } from "./confirm-card";
import { MarkdownPreview } from "./markdown-preview";

type CreatePullPanelProps = {
  owner: string;
  name: string;
  /** 仓库现有分支（base / head 都从这里选）。 */
  branches: string[];
  /** 默认目标分支（通常是仓库默认分支）。 */
  defaultBase: string | null;
  /** 预填的目标分支（拖分支芯片到另一个芯片时由手势给出）。 */
  presetBase?: string | null;
  /** 预填的来源分支（同上）。 */
  presetHead?: string | null;
  /** 术语解释模式（新手 / 进阶时在表单上方内联说明 PR 是什么）。 */
  mode: ExplainMode;
  /** 创建成功后由父组件展示提示并关闭面板。 */
  onCreated: (message: string) => void;
  onCancel: () => void;
};

const FIELD_CLASS =
  "w-full rounded-lg border border-black/[.08] bg-white px-3 text-xs text-zinc-700 placeholder:text-zinc-500 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200";

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
  presetBase = null,
  presetHead = null,
  mode,
  onCreated,
  onCancel,
}: CreatePullPanelProps) {
  const { t } = useTranslator();
  // 手势带入的分支可能比服务端分支列表更新（刚建完分支就拖它）：
  // 缺了就补进选项，避免预填值落在 <select> 之外被静默丢弃。
  const options = useMemo(() => {
    const list = [...branches];
    for (const preset of [presetBase, presetHead]) {
      if (preset && !list.includes(preset)) {
        list.unshift(preset);
      }
    }
    return list;
  }, [branches, presetBase, presetHead]);

  const [base, setBase] = useState(() =>
    presetBase ? presetBase : initialBase(options, defaultBase),
  );
  const [head, setHead] = useState(() => {
    if (presetHead && presetHead !== presetBase) {
      return presetHead;
    }
    return initialHead(options, initialBase(options, defaultBase));
  });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const titleError = trimmedTitle ? validatePullTitle(title, t) : null;
  const branchError = head && base ? validatePullBranches({ head, base }, t) : null;

  // 确认卡片与审计共用同一份描述
  const view = useMemo(
    () =>
      confirmationView(
        createPullRequestDescriptor(
          {
            owner,
            name,
            head,
            base,
            title: trimmedTitle,
            body,
            draft,
          },
          t,
        ),
        t,
      ),
    [base, body, draft, head, name, owner, t, trimmedTitle],
  );

  const submit = useCallback(async () => {
    if (pending) {
      return;
    }
    const titleProblem = validatePullTitle(title, t);
    if (titleProblem) {
      setError(titleProblem);
      return;
    }
    const branchProblem = validatePullBranches({ head, base }, t);
    if (branchProblem) {
      setError(branchProblem);
      return;
    }
    const bodyProblem = validatePullBody(body, t);
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
          t,
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        number?: number;
        title?: string;
      };
      if (!response.ok) {
        setError(data.message ?? describeCreatePullRequestFailure(response.status, data.error, t));
        return;
      }
      const numberLabel =
        typeof data.number === "number" && data.number > 0 ? `#${data.number} ` : "";
      onCreated(
        t("panels.createPull.created", { number: numberLabel, title: data.title || title.trim() }),
      );
    } catch {
      setError(t("panels.createPull.networkError"));
    } finally {
      setPending(false);
    }
  }, [base, body, draft, head, name, onCreated, owner, pending, t, title]);

  if (branches.length < 2) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
      >
        <p className="text-sm font-semibold">{t("panels.createPull.needTwoBranchesTitle")}</p>
        <p className="mt-1">{t("panels.createPull.needTwoBranchesBody")}</p>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-full border border-amber-400 px-4 text-xs font-medium transition-colors hover:bg-amber-100 dark:border-amber-600 dark:hover:bg-amber-900"
          >
            {t("common.cancel")}
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
      <ConceptNote id="pull-request" mode={mode} className="mt-3" />
      <div
        className="mt-3 space-y-1"
        data-debug={`${presetHead ?? "null"}|${presetBase ?? "null"}|${head}|${base}`}
      >
        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="pr-base">
          {t("panels.createPull.base")}
        </label>
        <select
          id="pr-base"
          value={base}
          onChange={(event) => setBase(event.target.value)}
          className={`h-9 max-w-sm ${FIELD_CLASS}`}
        >
          {options.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </select>

        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="pr-head">
          {t("panels.createPull.head")}
        </label>
        <select
          id="pr-head"
          value={head}
          onChange={(event) => setHead(event.target.value)}
          className={`h-9 max-w-sm ${FIELD_CLASS}`}
        >
          {options.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </select>
        {branchError ? (
          <p className="text-[11px] text-red-700 dark:text-red-300">{branchError}</p>
        ) : null}

        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="pr-title">
          {t("panels.createPull.title")}
        </label>
        <input
          id="pr-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("panels.createPull.titlePlaceholder")}
          className={`h-9 ${FIELD_CLASS}`}
        />
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {titleError ?? t("panels.createPull.titleHint", { max: PR_TITLE_MAX_LENGTH })}
        </p>

        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="pr-body">
          {t("panels.createPull.body")}
        </label>
        <textarea
          id="pr-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          placeholder={t("panels.createPull.bodyPlaceholder")}
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
          {t("panels.createPull.draft")}
        </label>
      </div>

      <div className="mt-3">
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {t("panels.createPull.bodyPreview")}
        </p>
        <div className="mt-1 rounded-lg border border-black/[.08] p-2 dark:border-white/[.145]">
          <MarkdownPreview source={body} />
        </div>
      </div>
    </ConfirmCard>
  );
}
