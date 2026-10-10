import Link from "next/link";

import { GITHUB_SCOPES, authorizationSettingsUrl } from "@/lib/permissions";

export const metadata = {
  title: "授权说明 · utf8-git",
  description: "utf8-git 申请的 GitHub 权限范围、数据使用方式与撤销入口。",
};

const GUARANTEES = [
  "不会创建、修改或删除任何仓库内容（不提交、不推送、不合并、不改分支保护）",
  "不会以你的名义创建 Issue / PR / 评论",
  "不会读取仓库之外的隐私数据（如私信、账号设置）",
  "访问令牌不会返回给浏览器，也不会写入应用日志",
];

export default function PermissionsPage() {
  const settingsUrl = authorizationSettingsUrl(process.env.AUTH_GITHUB_ID);

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-2xl rounded-2xl border border-black/[.08] bg-white p-8 shadow-sm dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          授权说明
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          utf8-git 使用 GitHub OAuth 登录。下面是申请的全部权限、用途与撤销方式。
        </p>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">申请的权限与用途</h2>
          <ul className="mt-3 space-y-3">
            {GITHUB_SCOPES.map((item) => (
              <li
                key={item.scope}
                className="rounded-lg bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700 dark:bg-white/[.06] dark:text-zinc-300"
              >
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  <code className="font-mono text-xs">{item.scope}</code>
                  <span className="ml-2">{item.title}</span>
                </p>
                <p className="mt-1">{item.purpose}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">我们如何使用令牌</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            <li>访问令牌仅以 AES-256-GCM 密文存储于服务端数据库，密钥独立于数据库保管。</li>
            <li>仅在服务端调用 GitHub API，浏览器与前端代码接触不到令牌。</li>
            <li>令牌不会写入应用日志；令牌过期后通过 refresh token 自动续期。</li>
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">我们不会做什么</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {GUARANTEES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">组织仓库与 SSO</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            若组织启用了 SAML SSO，即使授权成功也可能看不到该组织的仓库，需要为 utf8-git
            单独批准组织访问。授权成功但仓库为空时，可在
            <a
              href={settingsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mx-1 font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              GitHub 授权管理页
            </a>
            的 Organization access 中授予对应组织。
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">如何撤销授权</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            随时前往
            <a
              href={settingsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mx-1 font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              GitHub 的 Settings → Applications → Authorized OAuth Apps
            </a>
            移除 utf8-git，撤销后令牌立即失效，本应用将无法再读取任何仓库。也可以直接在{" "}
            <Link
              href="/me"
              className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              我的账号
            </Link>{" "}
            页点「撤销 GitHub 授权」：它会调用 GitHub
            接口撤销令牌，并删除本应用保存的令牌密文与登录会话。
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            如何清除本应用的数据
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            「我的账号」页的「清除我的数据」会删除本应用保存的全部账号数据——访问令牌、登录会话、
            写操作审计记录与缓存，并删除该账号在本应用中的用户记录，随后自动结束登录会话。
            这是不可恢复的操作；它不会影响你 GitHub 上的仓库、提交、Issue 与 PR。
          </p>
        </section>

        <div className="mt-8 flex gap-3 text-sm">
          <Link
            href="/login"
            className="h-10 rounded-full border border-black/[.08] px-5 leading-10 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            返回登录
          </Link>
          <Link
            href="/"
            className="h-10 rounded-full border border-black/[.08] px-5 leading-10 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
          >
            返回首页
          </Link>
        </div>
      </main>
    </div>
  );
}
