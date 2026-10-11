"use client";

// 客户端入口：语言由根布局（服务端读 Cookie）注入，客户端组件据此取翻译函数。

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { DEFAULT_LOCALE, type Locale } from "./config";
import { createTranslator, type Translator } from "./translate";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useTranslator(): Translator {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}
