import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getGitHubAccessToken } from "@/lib/access-token";
import { auth, signIn } from "@/lib/auth";
import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubNetworkError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubTimeoutError,
  GitHubUnauthorizedError,
} from "@/lib/github-errors";
import { describeGithubError } from "@/lib/error-state";
import { getTranslator } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/translate";
import { loadTimelinePage } from "@/lib/timeline-data";

import { TimelineView } from "./timeline-view";

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-_.]{0,98})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-12 font-sans dark:bg-black">
      <main className="w-full max-w-5xl">{children}</main>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
      <h1 className="text-base font-semibold text-black dark:text-zinc-50">{title}</h1>
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

function formatUtc(iso: string | null, t: Translate): string {
  return iso
    ? `${iso.slice(0, 16).replace("T", " ")}${t("common.utcSuffix")}`
    : t("common.unknownTime");
}

export default async function RepoTimelinePage({
  params,
}: {
  params: Promise<{ owner: string; name: string }>;
}) {
  const { owner, name } = await params;
  const { t } = await getTranslator();

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/repos/${owner}/${name}`)}`);
  }

  // 行内 Server Action：重新走 GitHub 授权流程（令牌失效 / 权限不足场景）
  async function reauthorize() {
    "use server";
    await signIn("github", { redirectTo: `/repos/${owner}/${name}` });
  }

  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(name)) {
    return (
      <PageShell>
        <Notice title={t("timeline.invalidPath.title")}>
          <p>
            {t("timeline.invalidPath.before")}
            <Link href="/repos" className="font-medium underline underline-offset-4">
              {t("timeline.invalidPath.link")}
            </Link>
            {t("timeline.invalidPath.after")}
          </p>
        </Notice>
      </PageShell>
    );
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
    result = await loadTimelinePage({ userId, token, owner, name, page: 1 });
  } catch (error) {
    if (error instanceof GitHubUnauthorizedError) {
      return (
        <PageShell>
          <Notice title={t("repos.tokenInvalid.title")}>
            <p>{t("timeline.tokenInvalidBody")}</p>
            <ReauthButton action={reauthorize} label={t("repos.reauth")} />
          </Notice>
        </PageShell>
      );
    }
    if (error instanceof GitHubNotFoundError) {
      return (
        <PageShell>
          <Notice title={t("timeline.notFound.title")}>
            <p>{t("timeline.notFound.body")}</p>
            <Link
              href="/repos"
              className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              {t("timeline.notFound.link")}
            </Link>
          </Notice>
        </PageShell>
      );
    }
    if (error instanceof GitHubRateLimitError) {
      return (
        <PageShell>
          <Notice title={t("repos.rateLimit.title")}>
            <p>
              {t("repos.rateLimit.before")}
              {error.resetAt
                ? t("repos.rateLimit.reset", { time: formatUtc(error.resetAt.toISOString(), t) })
                : ""}
              {t("repos.rateLimit.after")}
            </p>
            <Link
              href={`/repos/${owner}/${name}`}
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
              href={`/repos/${owner}/${name}`}
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
              href={`/repos/${owner}/${name}`}
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

  const timeline = result.timeline;
  const displayName = timeline.repo.nameWithOwner || `${owner}/${name}`;

  return (
    <PageShell>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            <Link href="/repos" className="underline-offset-4 hover:underline">
              {t("repos.title")}
            </Link>
            <span className="mx-1">/</span>
            {owner}
          </p>
          <h1 className="mt-1 break-all text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            {displayName}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {timeline.repo.isPrivate ? (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                {t("common.private")}
              </span>
            ) : (
              <span className="rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {t("common.public")}
              </span>
            )}
            {timeline.repo.defaultBranch ? (
              <span>{t("repoList.defaultBranch", { branch: timeline.repo.defaultBranch })}</span>
            ) : null}
            {timeline.repo.description ? (
              <span className="basis-full text-zinc-500 dark:text-zinc-400">
                {timeline.repo.description}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href={`/repos/${owner}/${name}/operations`}
            className="h-9 rounded-full border border-black/[.08] px-4 text-sm leading-8 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            {t("timeline.operations")}
          </Link>
          <a
            href={`https://github.com/${owner}/${name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="h-9 rounded-full border border-black/[.08] px-4 text-sm leading-8 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            {t("timeline.openOnGithub")}
          </a>
          <Link
            href="/repos"
            className="h-9 rounded-full border border-black/[.08] px-4 text-sm leading-8 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            {t("timeline.backToList")}
          </Link>
        </div>
      </header>

      {result.meta.degraded ? (
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
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

      {result.meta.warnings.length > 0 ? (
        <div className="mt-4 rounded-xl border border-zinc-300 bg-white p-3 text-xs leading-5 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
          {t("timeline.warningsBefore")}
          {result.meta.warnings.join(t("timeline.warningSeparator"))}
        </div>
      ) : null}

      <div className="mt-6">
        <TimelineView
          owner={owner}
          name={name}
          initialCommits={timeline.commits}
          initialHasNextPage={timeline.pageInfo.hasNextPage}
          initialBranch={timeline.branch}
          branches={timeline.branches}
          defaultBranch={timeline.repo.defaultBranch}
          initialLaneLayout={result.laneLayout}
        />
      </div>
    </PageShell>
  );
}
