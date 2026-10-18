import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { LocaleSwitcher } from "./locale-switcher";
import { OnlineBanner } from "./online-banner";

import { LocaleProvider } from "@/lib/i18n/client";
import { getLocale, getTranslator } from "@/lib/i18n/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 标题与描述跟随界面语言；根布局读 Cookie，故所有页面按请求动态渲染（i18n 的常规代价）
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: t("layout.title"),
    description: t("layout.description"),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const { t } = await getTranslator();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LocaleProvider locale={locale}>
          <OnlineBanner />
          <LocaleSwitcher />
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:border focus:border-black/[.08] focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-zinc-900 focus:shadow-sm dark:focus:border-white/[.145] dark:focus:bg-zinc-900 dark:focus:text-zinc-50"
          >
            {t("a11y.skipToContent")}
          </a>
          <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
            {children}
          </div>
        </LocaleProvider>
      </body>
    </html>
  );
}
