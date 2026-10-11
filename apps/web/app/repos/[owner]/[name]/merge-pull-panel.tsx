"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchJsonWithRetry, fetchWithRetry } from "@/lib/client-fetch";
import { OnlineRequestError, describeApiFailure } from "@/lib/error-state";
import { useTranslator } from "@/lib/i18n/client";
import { confirmationView } from "@/lib/operations";
import {
  MERGE_METHODS,
  createMergePullRequestDescriptor,
  describeMergePullRequestFailure,
  isMergeMethod,
  type MergeMethod,
} from "@/lib/pull-ops";

import { ConfirmCard } from "./confirm-card";

// 可合并性检查响应（GET 只读，不改动任何数据）
type MergeCheckResponse = {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  draft: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
  headRef: string | null;
  baseRef: string | null;
  url: string | null;
  canMerge: boolean;
  reason: string | null;
};

type MergePullPanelProps = {
  owner: string;
  name: string;
  number: number;
  /** 合并成功后由父组件展示提示并关闭面板。 */
  onMerged: (message: string) => void;
  onCancel: () => void;
};

const NOTICE_CLASS = "rounded-xl border p-3 text-xs leading-5";

/**
 * 合并 PR 面板（M3-4）：打开先做可合并性检查，
 * 可合并时给出确认卡片（含合并方式），不可合并时只解释原因、不提供执行入口。
 */
export function MergePullPanel({ owner, name, number, onMerged, onCancel }: MergePullPanelProps) {
  const { t } = useTranslator();
  const [check, setCheck] = useState<MergeCheckResponse | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [method, setMethod] = useState<MergeMethod>("merge");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/operations/merge-pull-request`;

  // 打开面板即检查一次（只读请求，可安全重试）
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchWithRetry(`${endpoint}?number=${number}`, {
          signal: controller.signal,
          t,
        });
        const data = (await response.json()) as MergeCheckResponse;
        if (!controller.signal.aborted) {
          setCheck(data);
        }
      } catch (failure) {
        if (controller.signal.aborted) {
          return;
        }
        const info =
          failure instanceof OnlineRequestError ? failure.info : describeApiFailure(500, null, t);
        setCheckError(info.message);
      }
    })();
    return () => controller.abort();
  }, [endpoint, number, t]);

  const view = useMemo(
    () =>
      confirmationView(
        createMergePullRequestDescriptor(
          {
            owner,
            name,
            number,
            title: check?.title || `PR #${number}`,
            baseBranch: check?.baseRef ?? t("panels.mergePull.defaultBranch"),
            headBranch: check?.headRef ?? t("panels.mergePull.headBranch"),
            method,
          },
          t,
        ),
        t,
      ),
    [check?.baseRef, check?.headRef, check?.title, method, name, number, owner, t],
  );

  const submit = useCallback(async () => {
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetchJsonWithRetry(endpoint, {
        body: JSON.stringify({ number, method, confirmed: true }),
        t,
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        // 服务端给出的原因（如冲突）比通用文案更具体，优先展示
        setError(data.message ?? describeMergePullRequestFailure(response.status, data.error, t));
        return;
      }
      onMerged(t("panels.mergePull.merged", { number }));
    } catch {
      setError(t("panels.mergePull.networkError"));
    } finally {
      setPending(false);
    }
  }, [endpoint, method, number, onMerged, pending, t]);

  if (checkError) {
    return (
      <div
        role="alert"
        className={`${NOTICE_CLASS} border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200`}
      >
        <p>{t("panels.mergePull.checkError", { number, message: checkError })}</p>
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

  if (!check) {
    return (
      <p
        className={`${NOTICE_CLASS} border-black/[.08] bg-zinc-50 text-zinc-600 dark:border-white/[.145] dark:bg-zinc-900 dark:text-zinc-300`}
      >
        {t("panels.mergePull.checking", { number })}
      </p>
    );
  }

  if (!check.canMerge) {
    return (
      <div
        role="alert"
        className={`${NOTICE_CLASS} border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100`}
      >
        <p className="text-sm font-semibold">{t("panels.mergePull.cannotMerge", { number })}</p>
        <p className="mt-1">
          {t("panels.mergePull.checkReason", {
            reason: check.reason ?? t("panels.mergePull.notAllowed"),
          })}
        </p>
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
      <div className="mt-3 space-y-1">
        <p className="text-xs text-zinc-600 dark:text-zinc-300">
          {t("panels.mergePull.checkPassed")}
        </p>
        <label className="block text-xs text-zinc-600 dark:text-zinc-300" htmlFor="merge-method">
          {t("panels.mergePull.method")}
        </label>
        <select
          id="merge-method"
          value={method}
          onChange={(event) => {
            if (isMergeMethod(event.target.value)) {
              setMethod(event.target.value);
            }
          }}
          className="h-9 w-full max-w-sm rounded-lg border border-black/[.08] bg-white px-2 text-xs text-zinc-700 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200"
        >
          {MERGE_METHODS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {check.headRef ?? t("panels.mergePull.headBranch")} →{" "}
          {check.baseRef ?? t("panels.mergePull.defaultBranch")}
        </p>
      </div>
    </ConfirmCard>
  );
}
