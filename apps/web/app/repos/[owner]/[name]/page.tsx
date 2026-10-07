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
import { loadTimelinePage } from "@/lib/timeline-data";

import { TimelineView } from "./timeline-view";

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-_.]{0,98})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-12 font-sans dark:bg-black">
      <div className="w-full max-w-5xl">{children}</div>
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

function ReauthButton({
  action,
  label = "重新授权 GitHub",
}: {
  action: () => Promise<void>;
  label?: string;
}) {
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

function formatUtc(iso: string | null): string {
  return iso ? `${iso.slice(0, 16).replace("T", " ")}（UTC）` : "未知时间";
}

export default async function RepoTimelinePage({
  params,
}: {
  params: Promise<{ owner: string; name: string }>;
}) {
  const { owner, name } = await params;

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
        <Notice title="仓库地址不合法">
          <p>
            请从
            <Link href="/repos" className="font-medium underline underline-offset-4">
              仓库列表
            </Link>
            重新进入。
          </p>
        </Notice>
      </PageShell>
    );
  }

  const token = await getGitHubAccessToken(userId);
  if (!token) {
    return (
      <PageShell>
        <Notice title="尚未完成 GitHub 授权">
          <p>当前账号没有可用的 GitHub 令牌，可能是授权已被撤销。请重新授权后继续。</p>
          <ReauthButton action={reauthorize} />
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
          <Notice title="GitHub 授权已失效">
            <p>令牌可能已被撤销或过期。重新授权后即可继续浏览时间线。</p>
            <ReauthButton action={reauthorize} />
          </Notice>
        </PageShell>
      );
    }
    if (error instanceof GitHubNotFoundError) {
      return (
        <PageShell>
          <Notice title="仓库不存在或无权访问">
            <p>可能原因：仓库已被删除、改名，或当前授权不包含该私有仓库。</p>
            <Link
              href="/repos"
              className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              返回我的仓库
            </Link>
          </Notice>
        </PageShell>
      );
    }
    if (error instanceof GitHubRateLimitError) {
      return (
        <PageShell>
          <Notice title="GitHub API 访问频率超限">
            <p>
              请求次数暂时超出 GitHub 配额
              {error.resetAt ? `，预计于 ${formatUtc(error.resetAt.toISOString())} 恢复` : ""}
              。当前没有可展示的缓存数据，请在配额恢复后重试。
            </p>
            <Link
              href={`/repos/${owner}/${name}`}
              className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              重试
            </Link>
          </Notice>
        </PageShell>
      );
    }
    if (error instanceof GitHubForbiddenError) {
      return (
        <PageShell>
          <Notice title="访问被 GitHub 拒绝（403）">
            <p>可能原因：组织开启了 SAML SSO 且本应用尚未获批，或当前授权的权限不足。</p>
            <ReauthButton action={reauthorize} label="重新授权" />
          </Notice>
        </PageShell>
      );
    }
    if (error instanceof GitHubNetworkError || error instanceof GitHubTimeoutError) {
      const info = describeGithubError(error);
      return (
        <PageShell>
          <Notice title={info.title}>
            <p>{info.message}</p>
            <Link
              href={`/repos/${owner}/${name}`}
              className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              重试
            </Link>
          </Notice>
        </PageShell>
      );
    }
    if (error instanceof GitHubApiError) {
      return (
        <PageShell>
          <Notice title="GitHub 服务暂时不可用">
            <p>GitHub 返回了服务端错误（{error.status}）。请稍后重试。</p>
            <Link
              href={`/repos/${owner}/${name}`}
              className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              重试
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
              我的仓库
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
                私有
              </span>
            ) : (
              <span className="rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                公开
              </span>
            )}
            {timeline.repo.defaultBranch ? (
              <span>默认分支 {timeline.repo.defaultBranch}</span>
            ) : null}
            {timeline.repo.description ? (
              <span className="basis-full text-zinc-500 dark:text-zinc-400">
                {timeline.repo.description}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href={`https://github.com/${owner}/${name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="h-9 rounded-full border border-black/[.08] px-4 text-sm leading-8 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            在 GitHub 打开
          </a>
          <Link
            href="/repos"
            className="h-9 rounded-full border border-black/[.08] px-4 text-sm leading-8 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            返回列表
          </Link>
        </div>
      </header>

      {result.meta.degraded ? (
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">GitHub 配额不足，当前展示缓存数据</p>
          <p className="mt-1">
            数据获取于 {formatUtc(result.meta.fetchedAt)}
            {result.meta.resetAt ? `，预计 ${formatUtc(result.meta.resetAt)} 恢复实时数据` : ""}。
          </p>
        </div>
      ) : null}

      {result.meta.warnings.length > 0 ? (
        <div className="mt-4 rounded-xl border border-zinc-300 bg-white p-3 text-xs leading-5 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
          部分关联数据未能取回：{result.meta.warnings.join("；")}
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
        />
      </div>
    </PageShell>
  );
}
