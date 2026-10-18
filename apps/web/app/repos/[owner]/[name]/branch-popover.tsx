"use client";

import { useEffect, useRef } from "react";

import { useTranslator } from "@/lib/i18n/client";

type BranchPopoverProps = {
  /** 起点提交的短 SHA（已格式化）。 */
  fromLabel: string;
  value: string;
  error: string | null;
  pending: boolean;
  /** 相对画布容器的坐标（父组件已做过边界收敛）。 */
  left: number;
  top: number;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 就地命名气泡（P0）：把提交节点拖到画布空白处松手后，在落点处直接命名。
 * 与按钮路径的确认卡片并存：拖拽是快路径，卡片是键盘 / 无障碍路径。
 */
export function BranchPopover({
  fromLabel,
  value,
  error,
  pending,
  left,
  top,
  onChange,
  onConfirm,
  onCancel,
}: BranchPopoverProps) {
  const { t } = useTranslator();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 打开即聚焦并全选预填内容：这是整条拖拽路径里唯一需要打字的地方。
  // 不用 autoFocus 属性（jsx-a11y 禁止），改为挂载后显式聚焦。
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Esc 关闭：监听 window，避免给 role="dialog" 的容器挂键盘监听（jsx-a11y 会报错）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-label={t("timeline.newBranchFrom", { sha: fromLabel })}
      style={{ left, top }}
      className="absolute z-30 w-[15rem] rounded-xl border border-black/[.12] bg-white p-3 shadow-xl dark:border-white/[.2] dark:bg-zinc-950"
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t("timeline.newBranchFrom", { sha: fromLabel })}
      </p>
      <input
        ref={inputRef}
        aria-label={t("timeline.newBranchName")}
        value={value}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onConfirm();
          }
        }}
        className="mt-2 h-8 w-full rounded-lg border border-black/[.08] bg-white px-2 font-mono text-xs text-zinc-700 dark:border-white/[.145] dark:bg-zinc-900 dark:text-zinc-200"
      />
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="h-8 rounded-full border border-black/[.08] px-3 text-xs text-zinc-700 transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="h-8 rounded-full bg-zinc-900 px-3 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending ? t("confirm.executing") : t("timeline.createBranchHere")}
        </button>
      </div>
    </div>
  );
}
