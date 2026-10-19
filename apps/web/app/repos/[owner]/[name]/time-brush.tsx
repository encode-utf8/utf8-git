"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { useTranslator } from "@/lib/i18n/client";

export type TimeWindow = { from: number; to: number };

type TimeBrushProps = {
  /** 域的下界 / 上界（已加载提交的最早 / 最晚时间戳）。 */
  min: number;
  max: number;
  /** 当前时间窗；null 表示全量（两端贴合）。 */
  value: TimeWindow | null;
  onChange: (next: TimeWindow) => void;
  onReset: () => void;
};

/** 键盘步长：默认 1/40 域宽，按住 Shift 为 1/8。 */
const STEP_RATIO = 1 / 40;
const COARSE_STEP_RATIO = 1 / 8;

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 时间刷子（P1）：把「近一周 / 近一月」的下拉换成可拖的时间窗。
 * 两端手柄支持拖动与方向键（role="slider"），中间区域整体平移；
 * 拖动过程实时回调，过滤是纯内存计算，所以画面即时反馈。
 */
export function TimeBrush({ min, max, value, onChange, onReset }: TimeBrushProps) {
  const { t } = useTranslator();
  const trackRef = useRef<HTMLDivElement | null>(null);

  const span = Math.max(1, max - min);
  const from = value ? value.from : min;
  const to = value ? value.to : max;
  const fromRatio = clampRatio((from - min) / span);
  const toRatio = clampRatio((to - min) / span);
  const active = value !== null;

  const ratioAt = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      return 0;
    }
    return clampRatio((clientX - rect.left) / rect.width);
  }, []);

  const emit = useCallback(
    (nextFrom: number, nextTo: number) => {
      const low = Math.min(nextFrom, nextTo);
      const high = Math.max(nextFrom, nextTo);
      onChange({ from: min + low * span, to: min + high * span });
    },
    [min, onChange, span],
  );

  // 指针拖动：与提交行 / 分支芯片同一套写法（window 监听 + 阈值不适用，手柄按下即拖）
  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, mode: "from" | "to" | "move") => {
      if (event.pointerType !== "mouse" || event.button !== 0) {
        return;
      }
      event.preventDefault();
      const startX = event.clientX;
      const startFrom = fromRatio;
      const startTo = toRatio;
      const handleMove = (moveEvent: PointerEvent) => {
        if (mode === "from") {
          emit(ratioAt(moveEvent.clientX), toRatio);
          return;
        }
        if (mode === "to") {
          emit(fromRatio, ratioAt(moveEvent.clientX));
          return;
        }
        const delta = ratioAt(moveEvent.clientX) - ratioAt(startX);
        let nextFrom = startFrom + delta;
        let nextTo = startTo + delta;
        if (nextFrom < 0) {
          nextTo -= nextFrom;
          nextFrom = 0;
        }
        if (nextTo > 1) {
          nextFrom -= nextTo - 1;
          nextTo = 1;
        }
        emit(nextFrom, nextTo);
      };
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [emit, fromRatio, ratioAt, toRatio],
  );

  const nudge = useCallback(
    (edge: "from" | "to", direction: -1 | 1, coarse: boolean) => {
      const step = (coarse ? COARSE_STEP_RATIO : STEP_RATIO) * direction;
      if (edge === "from") {
        emit(fromRatio + step, toRatio);
        return;
      }
      emit(fromRatio, toRatio + step);
    },
    [emit, fromRatio, toRatio],
  );

  const timeLabel = (ratio: number) => new Date(min + ratio * span).toISOString().slice(0, 10);

  return (
    <div className="mt-2 flex items-center gap-3 rounded-xl border border-black/[.08] bg-white px-3 py-2 text-xs dark:border-white/[.145] dark:bg-zinc-950">
      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{t("timeline.brushLabel")}</span>
      <div
        ref={trackRef}
        className="relative h-6 min-w-0 flex-1 cursor-pointer select-none"
        onPointerDown={(event) => {
          // 点在轨道空白处：把较近的一端挪过去（一次性到位，不进入拖动）
          const ratio = ratioAt(event.clientX);
          emit(
            Math.abs(ratio - fromRatio) <= Math.abs(ratio - toRatio) ? ratio : fromRatio,
            Math.abs(ratio - fromRatio) <= Math.abs(ratio - toRatio) ? toRatio : ratio,
          );
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-sky-500/70"
          style={{ left: `${fromRatio * 100}%`, right: `${(1 - toRatio) * 100}%` }}
          aria-hidden="true"
          onPointerDown={(event) => startDrag(event, "move")}
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label={t("timeline.brushLeft")}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={from}
          aria-valuetext={timeLabel(fromRatio)}
          onPointerDown={(event) => startDrag(event, "from")}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              nudge("from", -1, event.shiftKey);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              nudge("from", 1, event.shiftKey);
            }
          }}
          style={{ left: `calc(${fromRatio * 100}% - 5px)` }}
          className="absolute top-1/2 h-4 w-2.5 -translate-y-1/2 cursor-ew-resize rounded-sm border border-black/[.2] bg-white shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-white/[.3] dark:bg-zinc-900 dark:focus-visible:outline-sky-400"
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label={t("timeline.brushRight")}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={to}
          aria-valuetext={timeLabel(toRatio)}
          onPointerDown={(event) => startDrag(event, "to")}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              nudge("to", -1, event.shiftKey);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              nudge("to", 1, event.shiftKey);
            }
          }}
          style={{ left: `calc(${toRatio * 100}% - 5px)` }}
          className="absolute top-1/2 h-4 w-2.5 -translate-y-1/2 cursor-ew-resize rounded-sm border border-black/[.2] bg-white shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-white/[.3] dark:bg-zinc-900 dark:focus-visible:outline-sky-400"
        />
      </div>
      <span className="shrink-0 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
        {timeLabel(fromRatio)} → {timeLabel(toRatio)}
      </span>
      {active ? (
        <button
          type="button"
          onClick={onReset}
          className="h-7 shrink-0 rounded-full border border-black/[.08] px-3 text-[11px] text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
        >
          {t("timeline.brushReset")}
        </button>
      ) : null}
    </div>
  );
}
