"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { setLocalePreference } from "@/lib/i18n/actions";
import { useTranslator } from "@/lib/i18n/client";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/config";

/**
 * 语言切换：调 Server Action 记住语言偏好，再 `router.refresh()` 让服务端组件按新语言重渲染。
 * 悬浮在右上角，避免改动各页面已有的头部结构。
 */
export function LocaleSwitcher() {
  const { locale, t } = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === locale || pending) return;
    startTransition(async () => {
      await setLocalePreference(next);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t("locale.label")}
      className="fixed top-3 right-3 z-50 flex items-center gap-1 rounded-full border border-black/[.08] bg-white/90 px-1 py-1 text-xs shadow-sm backdrop-blur dark:border-white/[.145] dark:bg-zinc-900/90"
    >
      {LOCALES.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => switchTo(item)}
          aria-pressed={item === locale}
          aria-label={t("locale.switchTo", { language: LOCALE_LABELS[item] })}
          className={`rounded-full px-2 py-1 transition-colors ${
            item === locale
              ? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.08]"
          }`}
        >
          {LOCALE_LABELS[item]}
        </button>
      ))}
    </div>
  );
}
