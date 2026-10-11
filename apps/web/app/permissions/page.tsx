import type { Metadata } from "next";
import Link from "next/link";

import { getTranslator } from "@/lib/i18n/server";
import { GITHUB_SCOPES, authorizationSettingsUrl } from "@/lib/permissions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: t("permissions.metaTitle"),
    description: t("permissions.metaDescription"),
  };
}

export default async function PermissionsPage() {
  const settingsUrl = authorizationSettingsUrl(process.env.AUTH_GITHUB_ID);
  const { t } = await getTranslator();

  const notDoItems = [
    t("permissions.notDoContent"),
    t("permissions.notDoIssues"),
    t("permissions.notDoPrivacy"),
    t("permissions.notDoToken"),
  ];

  const linkClass =
    "mx-1 font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100";

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-2xl rounded-2xl border border-black/[.08] bg-white p-8 shadow-sm dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {t("permissions.title")}
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {t("permissions.description")}
        </p>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            {t("permissions.permissionsTitle")}
          </h2>
          <ul className="mt-3 space-y-3">
            {GITHUB_SCOPES.map((item) => (
              <li
                key={item.scope}
                className="rounded-lg bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700 dark:bg-white/[.06] dark:text-zinc-300"
              >
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  <code className="font-mono text-xs">{item.scope}</code>
                  <span className="ml-2">{t(`scopes.${item.key}.title`)}</span>
                </p>
                <p className="mt-1">{t(`scopes.${item.key}.purpose`)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            {t("permissions.tokenTitle")}
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            <li>{t("permissions.tokenStorage")}</li>
            <li>{t("permissions.tokenServerOnly")}</li>
            <li>{t("permissions.tokenNoLogs")}</li>
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            {t("permissions.notDoTitle")}
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {notDoItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            {t("permissions.ssoTitle")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {t("permissions.ssoBefore")}{" "}
            <a href={settingsUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {t("permissions.ssoLink")}
            </a>{" "}
            {t("permissions.ssoAfter")}
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            {t("permissions.revokeTitle")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {t("permissions.revokeBefore")}{" "}
            <a href={settingsUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {t("permissions.revokeLink")}
            </a>{" "}
            {t("permissions.revokeMiddle")}{" "}
            <Link href="/me" className={linkClass}>
              {t("permissions.revokeAccountLink")}
            </Link>{" "}
            {t("permissions.revokeAfter")}
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            {t("permissions.purgeTitle")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {t("permissions.purgeBody")}
          </p>
        </section>

        <div className="mt-8 flex gap-3 text-sm">
          <Link
            href="/login"
            className="h-10 rounded-full border border-black/[.08] px-5 leading-10 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            {t("common.backToLogin")}
          </Link>
          <Link
            href="/"
            className="h-10 rounded-full border border-black/[.08] px-5 leading-10 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            {t("common.backToHome")}
          </Link>
        </div>
      </main>
    </div>
  );
}
