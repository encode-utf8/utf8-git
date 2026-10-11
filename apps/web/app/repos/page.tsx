import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getGitHubAccessToken } from "@/lib/access-token";
import { auth, signIn } from "@/lib/auth";
import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubNetworkError,
  GitHubRateLimitError,
  GitHubTimeoutError,
  GitHubUnauthorizedError,
} from "@/lib/github-repos";
import { describeGithubError } from "@/lib/error-state";
import { getTranslator } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/translate";
import { loadReposPage } from "@/lib/repos-data";

import { RepoList } from "./repo-list";

// ISO 时间 → 「YYYY-MM-DD HH:mm（UTC）」文本
function formatUtc(iso: string | null, t: Translate): string {
  return iso
    ? `${iso.slice(0, 16).replace("T", " ")}${t("common.utcSuffix")}`
    : t("common.unknownTime");
}

async function PageShell({ children }: { children: ReactNode }) {
  const { t } = await getTranslator();
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-12 font-sans dark:bg-black">
      <div className="w-full max-w-4xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
              {t("repos.title")}
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t("repos.subtitle")}</p>
          </div>
          <Link
            href="/me"
            className="h-9 rounded-full border border-black/[.08] px-4 text-sm leading-8 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            {t("repos.account")}
          </Link>
        </header>
        <main className="mt-8">{children}</main>
      </div>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-black dark:text-zinc-50">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {children}
      </div>
    </section>
  );
}

function ReauthButton({ action, label }: { action: () => Promise<void>; label: string }) {
  return (
    <form action={action}>
      <button
        type="submit"
        className="h-10 rounded-full bg-[#24292f] px-5 text-sm font-medium text-white transition-colors hover:bg-[#3a4048]"
      >
        {label}
      </button>
    </form>
  );
}

// 指向 GitHub 上本应用的授权管理页（组织 SSO 授权 / 撤销授权都在这里）
function GitHubAuthorizationLink({ label }: { label: string }) {
  const url = process.env.AUTH_GITHUB_ID
    ? `https://github.com/settings/connections/applications/${process.env.AUTH_GITHUB_ID}`
    : "https://github.com/settings/connections/applications";
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
    >
      {label}
    </a>
  );
}

export default async function ReposPage() {
  const { t } = await getTranslator();
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect("/login?callbackUrl=/repos");
  }

  // 行内 Server Action：重新走 GitHub 授权流程（令牌失效 / 权限不足 / SSO 场景）
  async function reauthorize() {
    "use server";
    await signIn("github", { redirectTo: "/repos" });
  }

  const token = await getGitHubAccessToken(userId);
  if (!token) {
    return (
      <PageShell>
        <Notice title={t("repos.noToken.title")}>
          <p>{t("repos.noToken.body")}</p>
          <ReauthButton action={reauthorize} label={t("repos.reauth")} />
        </Notice>
      </PageShell>
    );
  }

  let result;
  try {
    result = await loadReposPage({ userId, token });
  } catch (error) {
    if (error instanceof GitHubUnauthorizedError) {
      return (
        <PageShell>
          <Notice title={t("repos.tokenInvalid.title")}>
            <p>{t("repos.tokenInvalid.body")}</p>
            <ReauthButton action={reauthorize} label={t("repos.reauth")} />
          </Notice>
        </PageShell>
      );
    }
    if (error instanceof GitHubRateLimitError) {
      const resetText = error.resetAt
        ? `${error.resetAt.toISOString().slice(0, 16).replace("T", " ")}${t("common.utcSuffix")}`
        : null;
      return (
        <PageShell>
          <Notice title={t("repos.rateLimit.title")}>
            <p>
              {t("repos.rateLimit.before")}
              {resetText ? t("repos.rateLimit.reset", { time: resetText }) : ""}
              {t("repos.rateLimit.after")}
            </p>
            <Link
              href="/repos"
              className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              {t("common.retry")}
            </Link>
          </Notice>
        </PageShell>
      );
    }
    if (error instanceof GitHubForbiddenError) {
      return (
        <PageShell>
          <Notice title={t("repos.forbidden.title")}>
            <p>{t("repos.forbidden.body")}</p>
            {error.ssoUrl ? (
              <p>
                {t("repos.forbidden.ssoBefore")}
                <GitHubAuthorizationLink label={t("repos.forbidden.ssoLink")} />
                {t("repos.forbidden.ssoAfter")}
              </p>
            ) : (
              <p>
                {t("repos.forbidden.manageBefore")}
                <GitHubAuthorizationLink label={t("repos.forbidden.manageLink")} />
                {t("repos.forbidden.manageAfter")}
              </p>
            )}
            <ReauthButton action={reauthorize} label={t("repos.reauthShort")} />
          </Notice>
        </PageShell>
      );
    }
    if (error instanceof GitHubNetworkError || error instanceof GitHubTimeoutError) {
      const info = describeGithubError(error, t);
      return (
        <PageShell>
          <Notice title={info.title}>
            <p>{info.message}</p>
            <Link
              href="/repos"
              className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              {t("common.retry")}
            </Link>
          </Notice>
        </PageShell>
      );
    }
    if (error instanceof GitHubApiError) {
      return (
        <PageShell>
          <Notice title={t("repos.api.title")}>
            <p>{t("repos.api.body", { status: error.status })}</p>
            <Link
              href="/repos"
              className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              {t("common.retry")}
            </Link>
          </Notice>
        </PageShell>
      );
    }
    throw error;
  }

  const page = result.page;

  if (page.repos.length === 0) {
    return (
      <PageShell>
        <Notice title={t("repos.empty.title")}>
          <p>{t("repos.empty.intro")}</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              {t("repos.empty.createBefore")}
              <a
                href="https://github.com/new"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
              >
                {t("repos.empty.createLink")}
              </a>
              {t("repos.empty.createAfter")}
            </li>
            <li>
              {t("repos.empty.ssoBefore")}
              <GitHubAuthorizationLink label={t("repos.empty.ssoLink")} />
              {t("repos.empty.ssoAfter")}
            </li>
            <li>
              {t("repos.empty.scopeBefore")}
              <Link
                href="/permissions"
                className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
              >
                {t("repos.empty.scopeLink")}
              </Link>
              {t("repos.empty.scopeAfter")}
            </li>
          </ul>
          <ReauthButton action={reauthorize} label={t("repos.reauth")} />
        </Notice>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {result.meta.degraded ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">{t("repos.degraded.title")}</p>
          <p className="mt-1">
            {t("repos.degraded.before", { time: formatUtc(result.meta.fetchedAt, t) })}
            {result.meta.resetAt
              ? t("repos.degraded.reset", { time: formatUtc(result.meta.resetAt, t) })
              : ""}
            {t("repos.degraded.after")}
          </p>
        </div>
      ) : null}
      {page.sso ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">{t("repos.sso.title")}</p>
          <p className="mt-1">
            {t("repos.sso.body", {
              orgs:
                page.sso.organizations.length > 0
                  ? `${page.sso.organizations.join(t("common.listSeparator"))} `
                  : "",
            })}
            {page.sso.url ? (
              <>
                {" "}
                <a
                  className="underline underline-offset-4"
                  href={page.sso.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("repos.sso.authorizeLink")}
                </a>
              </>
            ) : (
              <>
                {" "}
                <GitHubAuthorizationLink label={t("repos.sso.manageLink")} />
              </>
            )}
          </p>
        </div>
      ) : null}
      <RepoList
        initialRepos={page.repos}
        initialHasMore={page.hasMore}
        initialNextPage={page.nextPage}
      />
    </PageShell>
  );
}
