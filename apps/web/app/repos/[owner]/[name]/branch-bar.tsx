"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { ExplainMode } from "@/lib/glossary";
import type { TimelineBranch } from "@/lib/github-timeline";
import { useTranslator } from "@/lib/i18n/client";

import { GlossaryHint } from "./glossary-hint";

export type DragPoint = { x: number; y: number };

type BranchBarProps = {
  branches: TimelineBranch[];
  /** 时间线当前正在查看的分支。 */
  current: string | null;
  defaultBranch: string | null;
  disabled?: boolean;
  mode: ExplainMode;
  onSelect: (name: string) => void;
  onDragStart: (name: string) => void;
  onDragMove: (name: string, point: DragPoint) => void;
  onDragEnd: (name: string, point: DragPoint) => void;
  onDragCancel: () => void;
};

/** 指针移动超过该阈值才判定为「拖动」，否则仍算一次点击。 */
const DRAG_THRESHOLD = 6;

/**
 * 分支芯片条（P0）：替代原来的 `<select>`。
 * - 点击 / Enter / Space：切换分支（键盘与无障碍路径，与旧选择器等价）；
 * - 鼠标拖动：交给父组件决定落点（拖到删除区 = 删除该分支）。
 * 触摸端不启用拖动：拖拽与纵向滚动会互相抢手势，触摸用户仍可点芯片切换。
 */
export function BranchBar({
  branches,
  current,
  defaultBranch,
  disabled = false,
  mode,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: BranchBarProps) {
  const { t } = useTranslator();
  // 拖动结束后浏览器仍会补发一次 click：用它把这次 click 吞掉，避免「拖完顺带切了分支」
  const suppressClickRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // 用 window 监听而不是 setPointerCapture + React 合成事件：
  // 与提交行拖拽同一套写法（那套已在 CI 验证可用），少一层指针捕获的行为差异。
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, name: string) => {
      if (disabled || event.pointerType !== "mouse" || event.button !== 0) {
        return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;

      const handleMove = (moveEvent: PointerEvent) => {
        if (!moved) {
          const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
          if (distance < DRAG_THRESHOLD) {
            return;
          }
          moved = true;
          setDragging(name);
          onDragStart(name);
        }
        onDragMove(name, { x: moveEvent.clientX, y: moveEvent.clientY });
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
      };

      const handleUp = (upEvent: PointerEvent) => {
        cleanup();
        setDragging(null);
        if (moved) {
          suppressClickRef.current = name;
          onDragEnd(name, { x: upEvent.clientX, y: upEvent.clientY });
        } else {
          onDragCancel();
        }
      };

      const handleCancel = () => {
        cleanup();
        setDragging(null);
        onDragCancel();
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleCancel);
    },
    [disabled, onDragCancel, onDragEnd, onDragMove, onDragStart],
  );

  const handleClick = useCallback(
    (name: string) => {
      if (suppressClickRef.current === name) {
        suppressClickRef.current = null;
        return;
      }
      onSelect(name);
    },
    [onSelect],
  );

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span id="branch-bar-label">{t("timeline.branchLabel")}</span>
        <GlossaryHint id="branch" mode={mode} />
      </span>
      <div
        role="group"
        aria-labelledby="branch-bar-label"
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-1"
      >
        {branches.map((item) => {
          const isCurrent = item.name === current;
          const isDefault = item.name === defaultBranch;
          return (
            <button
              key={item.name}
              type="button"
              disabled={disabled}
              aria-pressed={isCurrent}
              title={item.name}
              onClick={() => handleClick(item.name)}
              onPointerDown={(event) => handlePointerDown(event, item.name)}
              className={[
                "flex h-7 shrink-0 select-none items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                "cursor-grab active:cursor-grabbing disabled:opacity-60",
                isCurrent
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-black/[.12] bg-white text-zinc-700 hover:bg-black/[.04] dark:border-white/[.16] dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-white/[.08]",
                dragging === item.name ? "opacity-40" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span
                aria-hidden="true"
                className={[
                  "h-1.5 w-1.5 rounded-full",
                  isCurrent
                    ? "bg-white dark:bg-zinc-900"
                    : isDefault
                      ? "bg-sky-600 dark:bg-sky-400"
                      : "bg-zinc-400 dark:bg-zinc-500",
                ].join(" ")}
              />
              <span className="max-w-[12rem] truncate">{item.name}</span>
              {isDefault ? (
                <span
                  className={
                    isCurrent
                      ? "text-[10px] text-white/70 dark:text-zinc-900/60"
                      : "text-[10px] text-zinc-500 dark:text-zinc-400"
                  }
                >
                  {t("timeline.defaultBranchTag")}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
