"use client";

import type { ReactNode } from "react";

import type { ConfirmationView } from "@/lib/operations";

type ConfirmCardProps = {
  view: ConfirmationView;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** 额外表单字段（如新分支名输入框），渲染在标题与影响预览之间。 */
  children?: ReactNode;
};

/**
 * 写操作确认卡片（M3-1）：展示操作标题、影响预览与确认 / 取消按钮。
 * 纯展示组件，不做任何 IO；执行交由操作编排管线（lib/operations.ts）。
 */
export function ConfirmCard({
  view,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
  children,
}: ConfirmCardProps) {
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={view.title}
      className="rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950"
    >
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{view.title}</p>
      {children}
      {view.impacts.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-600 dark:text-zinc-300">
          {view.impacts.map((impact) => (
            <li key={impact}>{impact}</li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="h-9 rounded-full border border-black/[.08] px-4 text-xs text-zinc-700 transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={
            view.danger
              ? "h-9 rounded-full border border-red-400 bg-red-600 px-4 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60 dark:border-red-600"
              : "h-9 rounded-full border border-black/[.08] bg-zinc-900 px-4 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:border-white/[.145] dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          }
        >
          {pending ? "执行中…" : view.confirmLabel}
        </button>
      </div>
    </div>
  );
}
