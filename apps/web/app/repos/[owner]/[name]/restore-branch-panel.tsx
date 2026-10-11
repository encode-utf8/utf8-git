"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createRestoreBranchDescriptor,
  describeRestoreBranchFailure,
  describeRestoreRemaining,
  evaluateBranchRestore,
} from "@/lib/branch-restore-ops";
import { fetchJsonWithRetry, fetchWithRetry } from "@/lib/client-fetch";
import { OnlineRequestError, describeApiFailure } from "@/lib/error-state";
import type { ExplainMode } from "@/lib/glossary";
import { useTranslator } from "@/lib/i18n/client";
import { confirmationView } from "@/lib/operations";

import { ConceptNote } from "./concept-note";
import { ConfirmCard } from "./confirm-card";

// 可恢复的删除记录（来自本应用写操作审计，含删除前的分支头 SHA）
type RestoreCandidate = {
  idempotencyKey: string;
  branch: string;
  sha: string;
  recordedAt: string;
  expiresAt: string;
};

type RestoreListResponse = { candidates: RestoreCandidate[] };

type RestoreBranchPanelProps = {
  owner: string;
  name: string;
  /** 术语解释模式（新手 / 进阶时在面板上方内联说明分支与恢复是什么）。 */
  mode: ExplainMode;
  /** 恢复成功后由父组件展示提示并关闭面板。 */
  onRestored: (message: string) => void;
  onCancel: () => void;
};

const NOTICE_CLASS = "rounded-xl border p-3 text-xs leading-5";

/**
 * 恢复分支面板（M3-6）：列出 24h 内本仓库的删除记录 → 选择 → 确认恢复。
 * 恢复靠审计里保存的分支头 SHA 重建引用；窗口过期或记录缺少 SHA 时只解释原因。
 */
export function RestoreBranchPanel({
  owner,
  name,
  mode,
  onRestored,
  onCancel,
}: RestoreBranchPanelProps) {
  const { t } = useTranslator();
  const [candidates, setCandidates] = useState<RestoreCandidate[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/operations/restore-branch`;

  // 打开面板即拉一次候选列表（只读请求，可安全重试）
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchWithRetry(endpoint, { signal: controller.signal });
        const data = (await response.json()) as RestoreListResponse;
        if (!controller.signal.aborted) {
          setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
        }
      } catch (failure) {
        if (controller.signal.aborted) {
          return;
        }
        const info =
          failure instanceof OnlineRequestError ? failure.info : describeApiFailure(500, null);
        setListError(info.message);
      }
    })();
    return () => controller.abort();
  }, [endpoint]);

  // 默认选中最新一条（审计最新优先），减少一次点击
  const selected = useMemo(() => {
    if (!candidates || candidates.length === 0) {
      return null;
    }
    return candidates.find((item) => item.idempotencyKey === selectedKey) ?? candidates[0];
  }, [candidates, selectedKey]);

  const verdict = useMemo(
    () =>
      selected
        ? evaluateBranchRestore(
            {
              branch: selected.branch,
              sha: selected.sha,
              recordedAt: selected.recordedAt,
            },
            t,
          )
        : null,
    [selected, t],
  );

  const view = useMemo(
    () =>
      selected
        ? confirmationView(
            createRestoreBranchDescriptor(
              {
                owner,
                name,
                branch: selected.branch,
                sha: selected.sha,
                source: selected.idempotencyKey,
              },
              t,
            ),
            t,
          )
        : null,
    [name, owner, selected, t],
  );

  const submit = useCallback(async () => {
    if (pending || !selected) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetchJsonWithRetry(endpoint, {
        body: JSON.stringify({ idempotencyKey: selected.idempotencyKey, confirmed: true }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        setError(data.message ?? describeRestoreBranchFailure(response.status, data.error, t));
        return;
      }
      onRestored(t("panels.restoreBranch.restored", { branch: selected.branch }));
    } catch {
      setError(t("panels.restoreBranch.networkError"));
    } finally {
      setPending(false);
    }
  }, [endpoint, onRestored, pending, selected, t]);

  if (listError) {
    return (
      <div
        role="alert"
        className={`${NOTICE_CLASS} border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200`}
      >
        <p>{t("panels.restoreBranch.listError", { message: listError })}</p>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-full border border-red-400 px-4 text-xs font-medium transition-colors hover:bg-red-100 dark:border-red-600 dark:hover:bg-red-900"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    );
  }

  if (!candidates) {
    return (
      <p
        className={`${NOTICE_CLASS} border-black/[.08] bg-zinc-50 text-zinc-600 dark:border-white/[.145] dark:bg-zinc-900 dark:text-zinc-300`}
      >
        {t("panels.restoreBranch.loading")}
      </p>
    );
  }

  if (candidates.length === 0) {
    return (
      <div
        className={`${NOTICE_CLASS} border-black/[.08] bg-zinc-50 text-zinc-600 dark:border-white/[.145] dark:bg-zinc-900 dark:text-zinc-300`}
      >
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {t("panels.restoreBranch.emptyTitle")}
        </p>
        <p className="mt-1">{t("panels.restoreBranch.emptyBody")}</p>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-full border border-black/[.08] px-4 text-xs text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
      <ConceptNote id="branch" mode={mode} className="mb-3" />
      <fieldset>
        <legend className="text-xs text-zinc-600 dark:text-zinc-300">
          {t("panels.restoreBranch.legend")}
        </legend>
        <div className="mt-2 space-y-1">
          {candidates.map((item) => (
            <label
              key={item.idempotencyKey}
              className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-200"
            >
              <input
                type="radio"
                name="restore-candidate"
                value={item.idempotencyKey}
                checked={selected?.idempotencyKey === item.idempotencyKey}
                onChange={() => {
                  setSelectedKey(item.idempotencyKey);
                  setError(null);
                }}
                className="h-4 w-4"
              />
              <span>
                {t("panels.restoreBranch.candidate", {
                  branch: item.branch,
                  remaining: describeRestoreRemaining(item.recordedAt, undefined, t),
                })}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        {t("panels.restoreBranch.hint")}
      </p>

      <div className="mt-3">
        {selected && verdict?.canRestore && view ? (
          <ConfirmCard
            view={view}
            pending={pending}
            error={error}
            onConfirm={() => void submit()}
            onCancel={onCancel}
          />
        ) : (
          <div
            role="alert"
            className={`${NOTICE_CLASS} border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100`}
          >
            <p className="text-sm font-semibold">
              {t("panels.restoreBranch.impossible", { reason: verdict?.reason ?? "" })}
            </p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="h-8 rounded-full border border-amber-400 px-4 text-xs font-medium transition-colors hover:bg-amber-100 dark:border-amber-600 dark:hover:bg-amber-900"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
