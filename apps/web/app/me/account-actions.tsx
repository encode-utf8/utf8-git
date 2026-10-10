"use client";

import { useCallback, useMemo, useState } from "react";

import {
  createPurgeAccountDataDescriptor,
  createRevokeAuthorizationDescriptor,
  describePurgeDataFailure,
  describeRevokeAuthorizationFailure,
} from "@/lib/account-ops";
import { fetchJsonWithRetry } from "@/lib/client-fetch";
import { OnlineRequestError, describeApiFailure } from "@/lib/error-state";
import { confirmationView } from "@/lib/operations";

import { ConfirmCard } from "../repos/[owner]/[name]/confirm-card";

type AccountActionsProps = {
  /** 该用户的写操作审计记录条数（影响预览里说明会删掉多少）。 */
  auditRecords: number;
  /** 退出登录的服务端动作（清 Cookie 并回到首页）。 */
  signOutAction: () => Promise<void>;
};

type PanelKind = "revoke" | "purge";

const DANGER_BUTTON =
  "h-9 rounded-full border border-red-300 px-4 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950";

/**
 * 账号危险操作（M3-9）：撤销 GitHub 授权 / 清除本应用数据。
 * 两者都先弹确认卡片（展示影响预览），确认后走服务端写管线（确认 + 审计 + 频率限制）。
 */
export function AccountActions({ auditRecords, signOutAction }: AccountActionsProps) {
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const view = useMemo(() => {
    if (panel === "revoke") {
      return confirmationView(createRevokeAuthorizationDescriptor());
    }
    if (panel === "purge") {
      return confirmationView(createPurgeAccountDataDescriptor({ auditRecords }));
    }
    return null;
  }, [auditRecords, panel]);

  const open = useCallback((next: PanelKind) => {
    setPanel(next);
    setError(null);
    setDone(null);
  }, []);

  const submit = useCallback(async () => {
    if (!panel || pending) {
      return;
    }
    const current = panel;
    setPending(true);
    setError(null);
    try {
      const response = await fetchJsonWithRetry(`/api/account/${current}`, {
        body: JSON.stringify({ confirmed: true }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(
          current === "purge"
            ? describePurgeDataFailure(response.status, data.error)
            : describeRevokeAuthorizationFailure(response.status, data.error),
        );
        return;
      }
      setPanel(null);
      setDone(
        current === "purge"
          ? "已清除本应用内的账号数据：审计、缓存与账号记录均已删除，登录会话已结束。"
          : "已撤销 GitHub 授权：令牌已失效、本地密文已删除，登录会话已结束。",
      );
    } catch (failure) {
      const info =
        failure instanceof OnlineRequestError ? failure.info : describeApiFailure(500, null);
      setError(info.message);
    } finally {
      setPending(false);
    }
  }, [panel, pending]);

  return (
    <section className="mt-8 border-t border-black/[.08] pt-6 dark:border-white/[.145]">
      <h2 className="text-sm font-semibold text-black dark:text-zinc-50">危险操作</h2>
      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        两项操作都需要二次确认；执行后当前登录会话立即结束。
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => open("revoke")}
          disabled={pending}
          className={DANGER_BUTTON}
        >
          撤销 GitHub 授权
        </button>
        <button
          type="button"
          onClick={() => open("purge")}
          disabled={pending}
          className={DANGER_BUTTON}
        >
          清除我的数据
        </button>
      </div>

      {view ? (
        <div className="mt-4">
          <ConfirmCard
            view={view}
            pending={pending}
            error={error}
            onConfirm={() => void submit()}
            onCancel={() => {
              setPanel(null);
              setError(null);
            }}
          />
        </div>
      ) : null}

      {done ? (
        <div
          role="status"
          className="mt-4 rounded-xl border border-green-300 bg-green-50 p-3 text-xs leading-5 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200"
        >
          <p>{done}</p>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void signOutAction()}
              className="h-8 rounded-full border border-green-400 px-4 text-xs font-medium transition-colors hover:bg-green-100 dark:border-green-600 dark:hover:bg-green-900"
            >
              退出并返回首页
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
