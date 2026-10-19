"use client";

import { useTranslator } from "@/lib/i18n/client";

/**
 * 首次进入的手势速查条：三个手势各配一张小示意图。
 *
 * 为什么放在流内而不是浮层：浮层会盖住提交行、挡住第一次点击，
 * 而它恰恰是给「还不知道能拖」的人看的——挡住操作就本末倒置了。
 * 关掉后写 localStorage，不再打扰；工具栏的「?」可以随时重新打开。
 */
export function GestureGuide({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslator();
  return (
    <section
      aria-label={t("timeline.guideTitle")}
      className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900 dark:bg-sky-950/30"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-sky-900 dark:text-sky-100">
            {t("timeline.guideTitle")}
          </p>
          <ul className="mt-2 grid gap-x-4 gap-y-2 text-[11px] leading-4 text-sky-900/80 sm:grid-cols-3 dark:text-sky-100/80">
            <li className="flex items-start gap-2">
              <CommitBranchIcon />
              <span>{t("timeline.guideCommit")}</span>
            </li>
            <li className="flex items-start gap-2">
              <ChipToChipIcon />
              <span>{t("timeline.guideChip")}</span>
            </li>
            <li className="flex items-start gap-2">
              <ChipToTrashIcon />
              <span>{t("timeline.guideTrash")}</span>
            </li>
          </ul>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="h-7 shrink-0 rounded-full border border-sky-300 bg-white px-3 text-[11px] text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-900/60 dark:text-sky-100 dark:hover:bg-sky-900"
        >
          {t("timeline.guideDismiss")}
        </button>
      </div>
    </section>
  );
}

const iconClass = "mt-0.5 h-4 w-4 shrink-0";

/** 提交节点 + 分叉：拖到空白处建分支。 */
function CommitBranchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className={iconClass}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <circle cx="4" cy="12" r="1.8" />
      <path d="M4 10.2V6.5A2.5 2.5 0 0 1 6.5 4h3" strokeLinecap="round" />
      <circle cx="11.5" cy="4" r="1.8" />
      <path d="M12.5 8.5v1.2M11.9 9.1l1.2 1.2" strokeLinecap="round" />
    </svg>
  );
}

/** 两个分支芯片 + 箭头：拖到另一个芯片开 PR。 */
function ChipToChipIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className={iconClass}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="1.2" y="2.4" width="6" height="3.2" rx="1.6" />
      <rect x="8.8" y="10.4" width="6" height="3.2" rx="1.6" />
      <path d="M7.6 5.2l2.6 4.2M10.2 9.4l-1.3-.2M10.2 9.4l.1-1.3" strokeLinecap="round" />
    </svg>
  );
}

/** 芯片 + 删除竖轨：拖到右侧删除。 */
function ChipToTrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className={iconClass}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="1.2" y="6.4" width="6" height="3.2" rx="1.6" />
      <path d="M8 8h3.2M9.9 6.6 11.4 8l-1.5 1.4" strokeLinecap="round" />
      <path
        d="M12.6 4.6h2.2M13.2 4.6v6.2a.8.8 0 0 0 .8.8h.4a.8.8 0 0 0 .8-.8V4.6M13.8 4.6V4a.6.6 0 0 1 .6-.6h.4a.6.6 0 0 1 .6.6v.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
