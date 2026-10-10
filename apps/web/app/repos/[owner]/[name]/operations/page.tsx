import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { formatUtcDateTime } from "@/lib/commit-format";
import { getDataStores } from "@/lib/data-stores";
import { operationGitCommand, operationResultLink } from "@/lib/git-commands";
import { latestPerIdempotencyKey } from "@/lib/operation-audit";
import { OPERATION_KIND_LABEL, type OperationAuditStatus } from "@/lib/operations";

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-_.]{0,98})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const HISTORY_LIMIT = 50;

const STATUS_LABEL: Record<OperationAuditStatus, string> = {
  started: "进行中",
  succeeded: "成功",
  failed: "失败",
};

function statusClass(status: OperationAuditStatus): string {
  if (status === "succeeded") {
    return "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200";
  }
  if (status === "failed") {
    return "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200";
  }
  return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200";
}

export default async function RepoOperationsPage({
  params,
}: {
  params: Promise<{ owner: string; name: string }>;
}) {
  const { owner, name } = await params;

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/repos/${owner}/${name}/operations`)}`);
  }

  const repo = `${owner}/${name}`;
  const validRepo = OWNER_PATTERN.test(owner) && REPO_PATTERN.test(name);
  const records = validRepo
    ? latestPerIdempotencyKey(
        await getDataStores().operationAudit.list({
          repo,
          actor: userId,
          limit: HISTORY_LIMIT,
        }),
      )
    : [];

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-12 font-sans dark:bg-black">
      <div className="w-full max-w-4xl">
        <header>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            <Link href="/repos" className="underline-offset-4 hover:underline">
              我的仓库
            </Link>
            <span className="mx-1">/</span>
            {validRepo ? (
              <Link href={`/repos/${owner}/${name}`} className="underline-offset-4 hover:underline">
                {repo}
              </Link>
            ) : (
              repo
            )}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            操作历史
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            只列出你在本应用里发起的写操作（最多最近 {HISTORY_LIMIT} 条），含失败记录；每条附带 等价
            Git / gh 命令与结果链接。git 命令假设 <code>origin</code> 指向该仓库，命令仅供
            参考与复制，本应用不会执行它。
          </p>
          <div className="mt-3">
            <Link
              href={validRepo ? `/repos/${owner}/${name}` : "/repos"}
              className="inline-block h-9 rounded-full border border-black/[.08] px-4 text-sm leading-8 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]"
            >
              返回时间线
            </Link>
          </div>
        </header>

        {!validRepo ? (
          <p className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            仓库地址不合法，无法展示操作历史。
          </p>
        ) : records.length === 0 ? (
          <p className="mt-6 rounded-xl border border-black/[.08] bg-white p-4 text-sm text-zinc-600 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-300">
            还没有写操作记录。在时间线上完成一次「新建分支 / 提交 Issue / 合并 PR / 删除分支」后，
            这里就会出现对应的审计记录。
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {records.map((record) => {
              const command = operationGitCommand(record.kind, repo, record.payload);
              const link = operationResultLink(record.kind, repo, record.payload, record.result);
              return (
                <li
                  key={`${record.idempotencyKey}@${record.recordedAt}`}
                  className="rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                      {OPERATION_KIND_LABEL[record.kind]}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(record.status)}`}
                    >
                      {STATUS_LABEL[record.status]}
                    </span>
                    <time
                      dateTime={record.recordedAt}
                      className="text-xs text-zinc-500 dark:text-zinc-400"
                    >
                      {formatUtcDateTime(record.recordedAt)}（UTC）
                    </time>
                  </div>

                  <p className="mt-2 text-sm text-zinc-800 dark:text-zinc-100">{record.summary}</p>
                  {record.error ? (
                    <p className="mt-1 text-xs text-red-700 dark:text-red-300">
                      失败原因：{record.error}
                    </p>
                  ) : null}

                  {command ? (
                    <div className="mt-2 flex flex-wrap items-baseline gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                      <span className="shrink-0">等价命令</span>
                      <code className="break-all rounded-lg border border-black/[.08] bg-zinc-50 px-2 py-1 font-mono text-[11px] dark:border-white/[.145] dark:bg-zinc-900">
                        {command}
                      </code>
                    </div>
                  ) : null}

                  {link ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
                    >
                      {link.label}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
