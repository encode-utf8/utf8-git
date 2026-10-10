"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createDeleteBranchDescriptor, describeDeleteBranchFailure } from "@/lib/branch-delete-ops";
import { fetchWithRetry } from "@/lib/client-fetch";
import { OnlineRequestError, describeApiFailure } from "@/lib/error-state";
import type { TimelineBranch } from "@/lib/github-timeline";
import { confirmationView } from "@/lib/operations";

import { ConfirmCard } from "./confirm-card";

// 可删除性预检响应（GET 只读，不改动任何数据）
type DeleteCheckResponse = {
  branch: string;
  defaultBranch: string | null;
  protected: boolean;
  canDelete: boolean;
  reason: string | null;
};

// 预检结果与其对应的分支一起保存，切换分支时旧结果自然失效（无需在 effect 内 setState）
type DeleteCheckState = { branch: string; data?: DeleteCheckResponse; error?: string };

type DeleteBranchPanelProps = {
  owner: string;
  name: string;
  /** 仓库现有分支（含各自分支头 SHA，用于恢复提示） */
  branches: TimelineBranch[];
  defaultBranch: string | null;
  /** 时间线当前正在查看的分支（删除它会丢失浏览上下文） */
  currentBranch: string | null;
  /** 删除成功后由父组件展示提示并关闭面板。 */
  onDeleted: (message: string) => void;
  onCancel: () => void;
};

const FIELD_CLASS =
  "w-full rounded-lg border border-black/[.08] bg-white px-3 text-xs text-zinc-700 placeholder:text-zinc-400 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-200";

const NOTICE_CLASS = "rounded-xl border p-3 text-xs leading-5";

// 默认选中第一个「既非默认分支、也非当前分支」的候选，减少一次无意义的不可删除提示
function initialBranch(
  branches: TimelineBranch[],
  defaultBranch: string | null,
  currentBranch: string | null,
): string {
  const candidate = branches.find(
    (item) => item.name !== defaultBranch && item.name !== currentBranch,
  );
  return candidate?.name ?? branches[0]?.name ?? "";
}

/**
 * 删除分支面板（M3-5）：选分支 → 服务端可删除性预检 → 影响预览 → 确认删除。
 * 默认 / 受保护 / 当前查看的分支都会被拦截，只解释原因、不提供确认入口。
 */
export function DeleteBranchPanel({
  owner,
  name,
  branches,
  defaultBranch,
  currentBranch,
  onDeleted,
  onCancel,
}: DeleteBranchPanelProps) {
  const [branch, setBranch] = useState(() => initialBranch(branches, defaultBranch, currentBranch));
  const [check, setCheck] = useState<DeleteCheckState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/operations/delete-branch`;

  // 切换分支即重新预检（只读请求，可安全重试）；结果与分支一起保存，天然避免过期结果误用
  useEffect(() => {
    if (!branch) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const url = `${endpoint}?branch=${encodeURIComponent(branch)}&current=${encodeURIComponent(
          currentBranch ?? "",
        )}`;
        const response = await fetchWithRetry(url, { signal: controller.signal });
        const data = (await response.json()) as DeleteCheckResponse;
        if (!controller.signal.aborted) {
          setCheck({ branch, data });
        }
      } catch (failure) {
        if (controller.signal.aborted) {
          return;
        }
        const info =
          failure instanceof OnlineRequestError ? failure.info : describeApiFailure(500, null);
        setCheck({ branch, error: info.message });
      }
    })();
    return () => controller.abort();
  }, [branch, currentBranch, endpoint]);

  // 只采用与当前所选分支匹配的预检结果；不匹配时视为仍在检查
  const active = check?.branch === branch ? check : null;

  const headSha = useMemo(
    () => branches.find((item) => item.name === branch)?.headOid ?? null,
    [branch, branches],
  );

  const view = useMemo(
    () => confirmationView(createDeleteBranchDescriptor({ owner, name, branch, headSha })),
    [branch, headSha, name, owner],
  );

  const submit = useCallback(async () => {
    if (pending || !branch) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branch,
          current: currentBranch ?? undefined,
          sha: headSha ?? undefined,
          confirmed: true,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        // 服务端给出的原因（默认 / 受保护分支）比通用文案更具体，优先展示
        setError(data.message ?? describeDeleteBranchFailure(response.status, data.error));
        return;
      }
      onDeleted(`已删除分支 ${branch}`);
    } catch {
      setError("网络异常，未能删除分支，请稍后重试。");
    } finally {
      setPending(false);
    }
  }, [branch, currentBranch, endpoint, headSha, onDeleted, pending]);

  return (
    <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
      <div className="space-y-1">
        <label
          className="block text-xs text-zinc-600 dark:text-zinc-300"
          htmlFor="delete-branch-name"
        >
          要删除的分支
        </label>
        <select
          id="delete-branch-name"
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          disabled={pending}
          className={`h-9 max-w-sm ${FIELD_CLASS}`}
        >
          {branches.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
              {item.name === defaultBranch ? "（默认）" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        {active?.error ? (
          <div
            role="alert"
            className={`${NOTICE_CLASS} border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200`}
          >
            <p>
              无法检查分支「{branch}」的可删除性：{active.error}
            </p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="h-8 rounded-full border border-red-400 px-4 text-xs font-medium transition-colors hover:bg-red-100 dark:border-red-600 dark:hover:bg-red-900"
              >
                关闭
              </button>
            </div>
          </div>
        ) : !active?.data ? (
          <p
            className={`${NOTICE_CLASS} border-black/[.08] bg-zinc-50 text-zinc-600 dark:border-white/[.145] dark:bg-zinc-900 dark:text-zinc-300`}
          >
            正在检查分支「{branch}」的可删除性…
          </p>
        ) : active.data.canDelete ? (
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
            <p className="text-sm font-semibold">不可删除：{active.data.reason}</p>
            <p className="mt-1">
              请更换要删除的分支；默认分支与受保护分支只能在 GitHub 仓库设置中调整。
            </p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="h-8 rounded-full border border-amber-400 px-4 text-xs font-medium transition-colors hover:bg-amber-100 dark:border-amber-600 dark:hover:bg-amber-900"
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
