"use client";

import { useOnlineStatus } from "@/lib/use-online-status";

// 全局在线状态横幅：断网时给出明确提示与重新加载入口，恢复后自动隐藏。
// 依据 docs/requirements.md 场景表「断网」：展示「无法连接 GitHub」提示与重试按钮。
export function OnlineBanner() {
  const online = useOnlineStatus();
  if (online) {
    return null;
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      网络已断开，无法连接 GitHub。请检查网络后
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mx-1 font-medium underline underline-offset-4"
      >
        重新加载
      </button>
      。
    </div>
  );
}
