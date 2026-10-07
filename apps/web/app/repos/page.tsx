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
import { loadReposPage } from "@/lib/repos-data";

import { RepoList } from "./repo-list";

// ISO 时间 → 「YYYY-MM-DD HH:mm（UTC）」文本
function formatUtc(iso: string | null): string {
  return iso ? `${iso.slice(0, 16).replace("T", " ")}（UTC）` : "未知时间";
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-12 font-sans dark:bg-black">
      <div className="w-full max-w-4xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
              我的仓库
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              包含你创建、参与与组织授权的仓库（含私有仓库）。
            </p>
          </div>
          <Link
            href="/me"
            className="h-9 rounded-full border border-black/[.08] px-4 text-sm leading-8 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            账号
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
        <Notice title="尚未完成 GitHub 授权">
          <p>当前账号没有可用的 GitHub 令牌，可能是授权已被撤销。请重新授权后继续。</p>
          <ReauthButton action={reauthorize} />
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
          <Notice title="GitHub 授权已失效">
            <p>令牌可能已被撤销或过期。重新授权后即可继续查看仓库列表。</p>
            <ReauthButton action={reauthorize} />
          </Notice>
        </PageShell>
      );
    }
    if (error instanceof GitHubRateLimitError) {
      const resetText = error.resetAt
        ? `${error.resetAt.toISOString().slice(0, 16).replace("T", " ")}（UTC）`
        : null;
      return (
        <PageShell>
          <Notice title="GitHub API 访问频率超限">
            <p>
              请求次数暂时超出 GitHub 配额
              {resetText ? `，预计于 ${resetText} 恢复` : ""}
              。当前没有可展示的缓存数据，请在配额恢复后重试。
            </p>
            <Link
              href="/repos"
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
            {error.ssoUrl ? (
              <p>
                请<GitHubAuthorizationLink label="完成组织 SSO 授权" />
                后重试（或直接访问 GitHub 返回的授权链接）。
              </p>
            ) : (
              <p>
                请在
                <GitHubAuthorizationLink label="GitHub 授权管理页" />
                检查组织访问权限，或重新授权。
              </p>
            )}
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
              href="/repos"
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
              href="/repos"
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

  const page = result.page;

  if (page.repos.length === 0) {
    return (
      <PageShell>
        <Notice title="没有找到仓库">
          <p>可能的原因与处理方式：</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              账号还没有任何仓库：可以先
              <a
                href="https://github.com/new"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
              >
                在 GitHub 上创建仓库
              </a>
              。
            </li>
            <li>
              组织仓库未显示：组织可能启用了 SAML SSO，需要为本应用批准组织访问（
              <GitHubAuthorizationLink label="打开 GitHub 授权管理页" />
              ，在 Organization access 中授权对应组织）。
            </li>
            <li>授权范围不足：重新授权并确认包含 repo 权限。</li>
          </ul>
          <ReauthButton action={reauthorize} />
        </Notice>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {result.meta.degraded ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">GitHub 配额不足，当前展示缓存数据</p>
          <p className="mt-1">
            数据获取于 {formatUtc(result.meta.fetchedAt)}
            {result.meta.resetAt ? `，预计 ${formatUtc(result.meta.resetAt)} 恢复实时数据` : ""}。
          </p>
        </div>
      ) : null}
      {page.sso ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">部分组织的仓库未显示</p>
          <p className="mt-1">
            {page.sso.organizations.length > 0 ? `${page.sso.organizations.join("、")} ` : ""}
            启用了 SAML SSO，需要先为 utf8-git 批准组织访问。
            {page.sso.url ? (
              <>
                {" "}
                <a
                  className="underline underline-offset-4"
                  href={page.sso.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  完成 SSO 授权
                </a>
              </>
            ) : (
              <>
                {" "}
                <GitHubAuthorizationLink label="打开授权管理页" />
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
