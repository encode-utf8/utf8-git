import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountActions } from "./account-actions";

import { auth, signOut } from "@/lib/auth";
import { formatUtcDateTime } from "@/lib/commit-format";
import { getDataStores } from "@/lib/data-stores";
import { getPrismaClient } from "@/lib/prisma";

export default async function MePage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect("/login?callbackUrl=/me");
  }

  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    redirect("/login?callbackUrl=/me");
  }

  // 已授权信息（M3-9）：scope 与令牌有效期都来自授权时落库的账号记录
  const account = await prisma.account.findFirst({
    where: { userId, provider: "github" },
    orderBy: { id: "desc" },
  });
  const tokenExpiresAt = account?.expiresAt
    ? formatUtcDateTime(new Date(account.expiresAt * 1000).toISOString())
    : null;
  // 「清除我的数据」的影响预览要说明会删掉多少条审计记录
  const auditRecords = await getDataStores().operationAudit.count({ actor: userId });

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-xl rounded-2xl border border-black/[.08] bg-white p-8 shadow-sm dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          我的账号
        </h1>

        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          前往{" "}
          <Link
            href="/repos"
            className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
          >
            我的仓库
          </Link>{" "}
          查看仓库列表。
        </p>

        <div className="mt-6 flex items-center gap-4">
          {user.image ? (
            <Image
              src={user.image}
              alt={`${user.name ?? user.githubLogin ?? "GitHub 用户"} 的头像`}
              width={64}
              height={64}
              className="h-16 w-16 rounded-full"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-200 text-lg font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {(user.name ?? user.githubLogin ?? "U").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-lg font-medium text-black dark:text-zinc-50">
              {user.name ?? "未设置昵称"}
            </p>
            {user.githubLogin ? (
              <Link
                href={`https://github.com/${user.githubLogin}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
              >
                @{user.githubLogin}
              </Link>
            ) : null}
            {user.email ? (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{user.email}</p>
            ) : null}
          </div>
        </div>

        <dl className="mt-8 space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-white/[.06]">
            <dt className="text-zinc-500 dark:text-zinc-400">会话策略</dt>
            <dd className="text-zinc-800 dark:text-zinc-200">数据库会话（服务端可撤销）</dd>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-white/[.06]">
            <dt className="text-zinc-500 dark:text-zinc-400">授权范围</dt>
            <dd className="font-mono text-xs text-zinc-800 dark:text-zinc-200">
              {account?.scope ?? "read:user repo"}
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-white/[.06]">
            <dt className="text-zinc-500 dark:text-zinc-400">令牌有效期至</dt>
            <dd className="text-zinc-800 dark:text-zinc-200">
              {tokenExpiresAt ? `${tokenExpiresAt}（UTC）` : "当前授权未设置过期时间"}
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-white/[.06]">
            <dt className="text-zinc-500 dark:text-zinc-400">写操作审计</dt>
            <dd className="text-zinc-800 dark:text-zinc-200">{auditRecords} 条记录</dd>
          </div>
        </dl>

        <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          权限用途与数据处理的完整说明见{" "}
          <Link
            href="/permissions"
            className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
          >
            授权说明
          </Link>
          。
        </p>

        <div className="mt-4">
          <AccountActions auditRecords={auditRecords} signOutAction={logout} />
        </div>

        <form action={logout} className="mt-8">
          <button
            type="submit"
            className="flex h-10 w-full items-center justify-center rounded-full border border-black/[.08] px-5 text-sm font-medium text-black transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-white/[.08]"
          >
            退出登录
          </button>
        </form>
      </main>
    </div>
  );
}
