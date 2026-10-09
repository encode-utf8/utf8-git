import Link from "next/link";

import { signIn } from "@/lib/auth";
import { GITHUB_SCOPES } from "@/lib/permissions";

// 权限文案集中在 lib/permissions.ts，登录页与 /permissions 说明页共用
const PERMISSIONS = GITHUB_SCOPES;

// 仅允许站内相对路径，避免开放重定向
function normalizeCallbackUrl(value: string | undefined): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/repos";
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const callbackUrl = normalizeCallbackUrl(
    typeof params.callbackUrl === "string" ? params.callbackUrl : undefined,
  );

  async function loginWithGitHub() {
    "use server";
    await signIn("github", { redirectTo: callbackUrl });
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-xl rounded-2xl border border-black/[.08] bg-white p-8 shadow-sm dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          登录 utf8-git
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          使用 GitHub 账号登录，授权后即可浏览你的提交时间线（含私有仓库）。
        </p>

        <form action={loginWithGitHub} className="mt-6">
          <button
            type="submit"
            className="flex h-11 w-full items-center justify-center rounded-full bg-[#24292f] px-5 text-sm font-medium text-white transition-colors hover:bg-[#3a4048]"
          >
            使用 GitHub 登录
          </button>
        </form>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">申请的权限与用途</h2>
          <ul className="mt-3 space-y-2">
            {PERMISSIONS.map((item) => (
              <li
                key={item.scope}
                className="rounded-lg bg-zinc-50 px-3 py-2 text-sm leading-6 text-zinc-700 dark:bg-white/[.06] dark:text-zinc-300"
              >
                <code className="font-mono text-xs text-zinc-950 dark:text-zinc-50">
                  {item.scope}
                </code>
                <span className="ml-2">{item.purpose}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6 space-y-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          <p>访问令牌仅以 AES-256-GCM 密文存储于服务端数据库，不会返回给浏览器或写入日志。</p>
          <p>
            撤销授权：随时前往 GitHub 的 Settings → Applications → Authorized OAuth Apps 中移除
            utf8-git，撤销后令牌立即失效。
          </p>
          <p>
            <Link href="/permissions" className="underline underline-offset-4">
              查看完整授权说明
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
