import Link from "next/link";

import { signIn } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n/server";
// 权限用途文案集中在 i18n 消息目录的 scopes.*，登录页与 /permissions 说明页共用
import { GITHUB_SCOPES } from "@/lib/permissions";

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
  const { t } = await getTranslator();

  async function loginWithGitHub() {
    "use server";
    await signIn("github", { redirectTo: callbackUrl });
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-xl rounded-2xl border border-black/[.08] bg-white p-8 shadow-sm dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {t("login.title")}
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {t("login.description")}
        </p>

        <form action={loginWithGitHub} className="mt-6">
          <button
            type="submit"
            className="flex h-11 w-full items-center justify-center rounded-full bg-[#24292f] px-5 text-sm font-medium text-white transition-colors hover:bg-[#3a4048]"
          >
            {t("login.submit")}
          </button>
        </form>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            {t("login.permissionsTitle")}
          </h2>
          <ul className="mt-3 space-y-2">
            {GITHUB_SCOPES.map((item) => (
              <li
                key={item.scope}
                className="rounded-lg bg-zinc-50 px-3 py-2 text-sm leading-6 text-zinc-700 dark:bg-white/[.06] dark:text-zinc-300"
              >
                <code className="font-mono text-xs text-zinc-950 dark:text-zinc-50">
                  {item.scope}
                </code>
                <span className="ml-2">{t(`scopes.${item.key}.purpose`)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6 space-y-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          <p>{t("login.tokenNote")}</p>
          <p>{t("login.revokeNote")}</p>
          <p>
            <Link href="/permissions" className="underline underline-offset-4">
              {t("login.fullNote")}
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
