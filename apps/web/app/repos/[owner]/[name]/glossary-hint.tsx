"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { shouldExplain, termById, type ExplainMode, type GlossaryTermId } from "@/lib/glossary";

const CARD_WIDTH = 320;
const CARD_GAP = 6;
const EDGE_MARGIN = 8;

type Position = { top: number; left: number };

/**
 * 术语悬浮提示：模式关闭时直接不渲染；开启后显示一个「?」标记，
 * 悬停 / 聚焦弹出解释卡片。卡片用 portal 渲染到 body，
 * 以免被时间线滚动容器的 overflow 与行内 transform 裁剪。
 */
export function GlossaryHint({ id, mode }: { id: GlossaryTermId; mode: ExplainMode }) {
  const term = termById(id);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  const openCard = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const left = Math.max(
      EDGE_MARGIN,
      Math.min(rect.left, window.innerWidth - CARD_WIDTH - EDGE_MARGIN),
    );
    setPosition({ top: rect.bottom + CARD_GAP, left });
    setOpen(true);
  }, []);

  const closeCard = useCallback(() => setOpen(false), []);

  // 打开期间滚动 / 缩放会改变标记位置，直接收起以免卡片与标记脱节；Esc 同样收起。
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleDismiss = () => setOpen(false);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!shouldExplain(term, mode)) {
    return null;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`解释：${term.term}`}
        aria-describedby={open ? panelId : undefined}
        aria-expanded={open}
        onClick={openCard}
        onMouseEnter={openCard}
        onMouseLeave={closeCard}
        onFocus={openCard}
        onBlur={closeCard}
        className="pointer-events-auto inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-400 text-[10px] leading-none text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500 dark:border-zinc-500 dark:text-zinc-400 dark:hover:border-zinc-300 dark:hover:text-zinc-200"
      >
        ?
      </button>
      {open && position
        ? createPortal(
            <div
              id={panelId}
              role="tooltip"
              style={{ top: position.top, left: position.left, width: CARD_WIDTH }}
              className="fixed z-50 rounded-xl border border-black/[.08] bg-white p-3 text-left shadow-lg dark:border-white/[.145] dark:bg-zinc-900"
            >
              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">{term.term}</p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{term.summary}</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{term.detail}</p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
