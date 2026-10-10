import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { formatUtcDateTime } from "@/lib/commit-format";
import { getDataStores } from "@/lib/data-stores";
import { operationGitCommand, operationResultLink } from "@/lib/git-commands";
import { OPERATION_KIND_LABEL, type OperationAuditStatus } from "@/lib/operations";

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-_.]{0,98})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

// 每页条数按「操作条数」计（同一次操作在审计里是 started + 终态两条记录）
const PAGE_SIZE = 20;

const STATUS_LABEL: Record<OperationAuditStatus, string> = {
  started: "进行中",
  succeeded: "成功",
  failed: "失败",
};

const STATUS_FILTERS = [
  { value: "all", label: "全部", status: undefined },
  { value: "succeeded", label: "仅成功", status: "succeeded" },
  { value: "failed", label: "仅失败", status: "failed" },
] as const;

type HistoryFilter = (typeof STATUS_FILTERS)[number]["value"];
type HistorySearch = { page?: string; status?: string };

function parsePage(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 1 ? value : 1;
}

function parseFilter(raw: string | undefined): HistoryFilter {
  const matched = STATUS_FILTERS.find((item) => item.value === raw);
  return matched ? matched.value : "all";
}

/** 历史页地址：默认值（第 1 页 / 全部状态）不进查询串，保持初始 URL 干净。 */
function historyHref(
  owner: string,
  name: string,
  params: { page?: number; filter?: HistoryFilter },
): string {
  const query = new URLSearchParams();
  if (params.filter && params.filter !== "all") {
    query.set("status", params.filter);
  }
  if (params.page && params.page > 1) {
    query.set("page", String(params.page));
  }
  const suffix = query.toString();
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/operations`;
  return suffix ? `${base}?${suffix}` : base;
}

function statusClass(status: OperationAuditStatus): string {
  if (status === "succeeded") {
    return "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200";
  }
  if (status === "failed") {
    return "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200";
  }
  return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200";
}

const FILTER_BASE = "inline-block h-8 rounded-full border px-3 text-xs leading-8 transition-colors";
const FILTER_IDLE =
  "border-black/[.08] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]";
const FILTER_ACTIVE =
  "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900";
const PAGE_LINK =
  "inline-block h-9 rounded-full border border-black/[.08] px-4 text-sm leading-8 text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-white/[.08]";

export default async function RepoOperationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; name: string }>;
  searchParams: Promise<HistorySearch>;
}) {
  const { owner, name } = await params;
  const search = await searchParams;

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/repos/${owner}/${name}/operations`)}`);
  }

  const repo = `${owner}/${name}`;
  const validRepo = OWNER_PATTERN.test(owner) && REPO_PATTERN.test(name);
  const page = parsePage(search.page);
  const filter = parseFilter(search.status);
  const status = STATUS_FILTERS.find((item) => item.value === filter)?.status;

  const records = validRepo
    ? await getDataStores().operationAudit.listOperations({
        repo,
        actor: userId,
        status,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
    : [];
  const hasNext = records.length === PAGE_SIZE;

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
            只列出你在本应用里发起的写操作（每页 {PAGE_SIZE} 条，含失败记录）；每条附带 等价 Git /
            gh 命令与结果链接。git 命令假设 <code>origin</code> 指向该仓库，命令仅供 参考与复制，
            本应用不会执行它。
          </p>
          <div className="mt-3">
            <Link href={validRepo ? `/repos/${owner}/${name}` : "/repos"} className={PAGE_LINK}>
              返回时间线
            </Link>
          </div>
          {validRepo ? (
            <nav
              aria-label="按状态筛选"
              className="mt-4 flex flex-wrap items-center gap-2 text-zinc-500 dark:text-zinc-400"
            >
              <span className="text-xs">状态</span>
              {STATUS_FILTERS.map((item) => (
                <Link
                  key={item.value}
                  href={historyHref(owner, name, { filter: item.value })}
                  aria-current={filter === item.value ? "page" : undefined}
                  className={`${FILTER_BASE} ${filter === item.value ? FILTER_ACTIVE : FILTER_IDLE}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </header>

        {!validRepo ? (
          <p className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            仓库地址不合法，无法展示操作历史。
          </p>
        ) : records.length === 0 ? (
          <p className="mt-6 rounded-xl border border-black/[.08] bg-white p-4 text-sm text-zinc-600 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-300">
            {page > 1 || filter !== "all" ? (
              <>
                这一页没有符合条件的记录。
                <Link
                  href={historyHref(owner, name, {})}
                  className="ml-1 font-medium underline underline-offset-4"
                >
                  回到全部记录
                </Link>
              </>
            ) : (
              <>
                还没有写操作记录。在时间线上完成一次「新建分支 / 提交 Issue / 合并 PR /
                删除分支」后，这里就会出现对应的审计记录。
              </>
            )}
          </p>
        ) : (
          <>
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

                    <p className="mt-2 text-sm text-zinc-800 dark:text-zinc-100">
                      {record.summary}
                    </p>
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

            {page > 1 || hasNext ? (
              <nav
                aria-label="操作历史分页"
                className="mt-6 flex items-center justify-between gap-3"
              >
                {page > 1 ? (
                  <Link
                    href={historyHref(owner, name, { filter, page: page - 1 })}
                    className={PAGE_LINK}
                  >
                    上一页
                  </Link>
                ) : (
                  <span aria-hidden="true" />
                )}
                <span className="text-xs text-zinc-500 dark:text-zinc-400">第 {page} 页</span>
                {hasNext ? (
                  <Link
                    href={historyHref(owner, name, { filter, page: page + 1 })}
                    className={PAGE_LINK}
                  >
                    下一页
                  </Link>
                ) : (
                  <span aria-hidden="true" />
                )}
              </nav>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
