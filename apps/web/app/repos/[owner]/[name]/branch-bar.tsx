"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

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
  /** 点击芯片 / 菜单项：切换到这个分支。 */
  onSelect: (name: string) => void;
  /** 菜单项：用这个分支作为 head 开 PR（base 取当前查看的分支）。 */
  onOpenPull: (name: string) => void;
  /** 菜单项：删除这个分支（仍走确认浮层）。 */
  onRequestDelete: (name: string) => void;
  onDragStart: (name: string) => void;
  /** 拖动中持续回调：`target` 是当前指针悬停的另一个分支芯片（用于「开 PR」落点）。 */
  onDragMove: (name: string, point: DragPoint, target: string | null) => void;
  /** 松手：`target` 非空表示落在了另一个分支芯片上。 */
  onDragEnd: (name: string, point: DragPoint, target: string | null) => void;
  onDragCancel: () => void;
};

/** 指针移动超过该阈值才判定为「拖动」，否则仍算一次点击。 */
const DRAG_THRESHOLD = 6;

/** 菜单宽度（px）：与 w-44 对应，用来做右边界钳制。 */
const MENU_WIDTH = 176;
/** 菜单预估高度（三条菜单项 + 内边距）：判断向上还是向下展开。 */
const MENU_ESTIMATED_HEIGHT = 152;
const VIEWPORT_MARGIN = 8;

/**
 * 分支芯片条（P0 起替代 `<select>`）：
 * - 点击 / Enter / Space：切换分支（键盘等价路径）；
 * - 芯片上的「⋯」菜单：切换 / 开 PR / 删除——手势的点击等价物，摸不到手势的人也能用；
 * - 鼠标拖动芯片：拖到右侧删除区 = 删除，拖到另一个芯片 = 开 PR。
 * 触摸端不启用拖动：拖拽与纵向滚动抢手势，触摸用户可以点芯片或用菜单。
 */
export function BranchBar({
  branches,
  current,
  defaultBranch,
  disabled = false,
  mode,
  onSelect,
  onOpenPull,
  onRequestDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: BranchBarProps) {
  const { t } = useTranslator();
  const suppressClickRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // 指针悬停的另一个分支芯片：既是落点高亮，也是「松手开 PR」的目标
  const [hovered, setHovered] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ name: string; top: number; left: number } | null>(null);
  const chipRefs = useRef(new Map<string, HTMLDivElement | null>());

  // 当前分支被切到视口外时自动滚回来（分支多时芯片条横向溢出）
  useEffect(() => {
    if (!current) {
      return;
    }
    chipRefs.current.get(current)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);

  const closeMenu = useCallback(() => setMenu(null), []);

  // 菜单用 position: fixed 渲染在芯片条之外：芯片条是 overflow-x-auto 滚动容器，
  // absolute 定位的菜单会被它裁掉（这是「点了 ⋯ 什么都没发生」的真正原因）。
  // fixed  + 实测算坐标，并在滚动 / 缩放时关闭，避免位置过期。
  const openMenu = useCallback((name: string) => {
    const chip = chipRefs.current.get(name);
    const rect = chip?.querySelector("[data-branch-menu-trigger]")?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow >= MENU_ESTIMATED_HEIGHT + VIEWPORT_MARGIN
        ? rect.bottom + 6
        : Math.max(VIEWPORT_MARGIN, rect.top - MENU_ESTIMATED_HEIGHT - 6);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
    );
    setMenu({ name, top, left });
  }, []);

  // 菜单打开时：点外部或按 Esc 关闭。注意用冒泡阶段（不加 capture）：
  // React 的合成事件挂在根容器上，先于 window 冒泡监听执行，
  // 这样「点触发器自身」由 click 里的开合逻辑处理，不会被这里提前清掉。
  useEffect(() => {
    if (!menu) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-branch-menu]") || target?.closest("[data-branch-menu-trigger]")) {
        return;
      }
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };
    const onRelayout = () => setMenu(null);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onRelayout, true);
    window.addEventListener("resize", onRelayout);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onRelayout, true);
      window.removeEventListener("resize", onRelayout);
    };
  }, [menu]);

  const targetAt = useCallback((x: number, y: number, source: string): string | null => {
    for (const [name, element] of chipRefs.current) {
      if (name === source || !element) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return name;
      }
    }
    return null;
  }, []);

  // window 监听而不是 setPointerCapture + React 合成事件：与提交行拖拽同一套写法
  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, name: string) => {
      if (disabled || event.pointerType !== "mouse" || event.button !== 0) {
        return;
      }
      setMenu(null);
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
        const target = targetAt(moveEvent.clientX, moveEvent.clientY, name);
        setHovered(target);
        onDragMove(name, { x: moveEvent.clientX, y: moveEvent.clientY }, target);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
      };

      const handleUp = (upEvent: PointerEvent) => {
        cleanup();
        setDragging(null);
        setHovered(null);
        if (moved) {
          suppressClickRef.current = name;
          const target = targetAt(upEvent.clientX, upEvent.clientY, name);
          onDragEnd(name, { x: upEvent.clientX, y: upEvent.clientY }, target);
        } else {
          onDragCancel();
        }
      };

      const handleCancel = () => {
        cleanup();
        setDragging(null);
        setHovered(null);
        onDragCancel();
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleCancel);
    },
    [disabled, onDragCancel, onDragEnd, onDragMove, onDragStart, targetAt],
  );

  const handleChipClick = useCallback(
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
          const menuOpen = menu?.name === item.name;
          return (
            <div
              key={item.name}
              ref={(element) => {
                chipRefs.current.set(item.name, element);
              }}
              className={[
                "relative flex h-7 shrink-0 select-none items-center rounded-full border pl-2.5 pr-1 text-xs transition-colors",
                isCurrent
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-black/[.12] bg-white text-zinc-700 dark:border-white/[.16] dark:bg-zinc-950 dark:text-zinc-200",
                hovered === item.name
                  ? "ring-2 ring-sky-500 ring-offset-1 ring-offset-white dark:ring-offset-zinc-950"
                  : "",
                dragging === item.name ? "opacity-40" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <button
                type="button"
                disabled={disabled}
                aria-pressed={isCurrent}
                title={item.name}
                onClick={() => handleChipClick(item.name)}
                onPointerDown={(event) => startDrag(event, item.name)}
                className="flex min-w-0 cursor-grab items-center gap-1.5 rounded-full active:cursor-grabbing disabled:opacity-60"
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
                        ? "text-white/70 dark:text-zinc-900/60"
                        : "text-zinc-500 dark:text-zinc-400"
                    }
                  >
                    {t("timeline.defaultBranchTag")}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                data-branch-menu-trigger="true"
                aria-label={t("timeline.chipMenu", { branch: item.name })}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                disabled={disabled}
                onClick={() => (menuOpen ? closeMenu() : openMenu(item.name))}
                className={[
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs leading-none",
                  isCurrent
                    ? "hover:bg-white/20 dark:hover:bg-zinc-900/20"
                    : "hover:bg-black/[.06] dark:hover:bg-white/[.1]",
                  menuOpen ? "bg-black/[.06] dark:bg-white/[.12]" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span aria-hidden="true">⋯</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* 菜单渲染在芯片条之外（fixed）：见 openMenu 的注释——滚动容器会裁掉 absolute 菜单 */}
      {menu ? (
        <div
          role="menu"
          data-branch-menu="true"
          aria-label={t("timeline.chipMenu", { branch: menu.name })}
          style={{ top: menu.top, left: menu.left, width: MENU_WIDTH }}
          className="fixed z-50 rounded-xl border border-black/[.12] bg-white p-1 text-xs shadow-xl dark:border-white/[.2] dark:bg-zinc-900"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onSelect(menu.name);
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-zinc-700 hover:bg-black/[.04] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            {t("timeline.chipSwitch", { branch: menu.name })}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onOpenPull(menu.name);
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-zinc-700 hover:bg-black/[.04] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            {t("timeline.chipOpenPull")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onRequestDelete(menu.name);
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            {t("timeline.chipDelete")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
