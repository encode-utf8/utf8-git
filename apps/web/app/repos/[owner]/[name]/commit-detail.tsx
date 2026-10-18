"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { formatUtcDateTime, shortSha } from "@/lib/commit-format";
import { fetchWithRetry } from "@/lib/client-fetch";
import { OnlineRequestError, describeApiFailure } from "@/lib/error-state";
import type { CommitDetail } from "@/lib/github-commits";
import { collectIssues, type TimelineCommit } from "@/lib/github-timeline";
import { useTranslator } from "@/lib/i18n/client";
import type { MessageKey, Translate } from "@/lib/i18n/translate";

import { MergePullPanel } from "./merge-pull-panel";

// 详情接口响应：归一化提交详情 + 缓存 / 降级元信息（与 commit-data.ts 对齐）
type CommitDetailMeta = {
  cached: boolean;
  stale: boolean;
  degraded: boolean;
  fetchedAt: string | null;
  resetAt: string | null;
};

type CommitDetailResponse = CommitDetail & { meta: CommitDetailMeta };

type CommitDetailPanelProps = {
  owner: string;
  name: string;
  commit: TimelineCommit | null;
  onClose: () => void;
};

// GitHub 单次文件变更响应上限（与上游一致），截断提示里要说明这个数字
const FILE_LIMIT = 300;

// 文件变更状态在消息目录中的键：文案随界面语言切换，未知状态回退原始值
const FILE_STATUS_KEY: Record<string, MessageKey> = {
  added: "commitDetail.fileStatus.added",
  removed: "commitDetail.fileStatus.removed",
  modified: "commitDetail.fileStatus.modified",
  renamed: "commitDetail.fileStatus.renamed",
  copied: "commitDetail.fileStatus.copied",
  changed: "commitDetail.fileStatus.changed",
  unchanged: "commitDetail.fileStatus.unchanged",
};

const PR_STATE_KEY: Record<string, MessageKey> = {
  OPEN: "timeline.prState.open",
  MERGED: "timeline.prState.merged",
  CLOSED: "timeline.prState.closed",
};

const ISSUE_STATE_KEY: Record<string, MessageKey> = {
  OPEN: "timeline.issueState.open",
  CLOSED: "timeline.issueState.closed",
};

function fileStatusLabel(status: string, t: Translate): string {
  const key = FILE_STATUS_KEY[status];
  return key ? t(key) : status;
}

function prStateLabel(state: string, t: Translate): string {
  const key = PR_STATE_KEY[state];
  return key ? t(key) : state;
}

function issueStateLabel(state: string, t: Translate): string {
  const key = ISSUE_STATE_KEY[state];
  return key ? t(key) : state;
}

function fileStatusClass(status: string): string {
  if (status === "added") {
    return "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200";
  }
  if (status === "removed") {
    return "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200";
  }
  if (status === "renamed" || status === "copied") {
    return "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200";
  }
  return "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
}

function issueStateClass(state: string): string {
  if (state === "OPEN") {
    return "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200";
  }
  return "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
}

function prStateClass(state: string): string {
  if (state === "MERGED") {
    return "border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-200";
  }
  if (state === "OPEN") {
    return "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200";
  }
  return "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
}

type CommitDetailState = {
  sha: string | null;
  loading: boolean;
  error: string | null;
  detail: CommitDetailResponse | null;
};

// 右侧滑出式详情面板：点击遮罩 / 关闭按钮 / Esc 均可关闭
// 状态只由异步回调 / 事件处理器更新，避免在 effect 内同步 setState（React 纯净性约束）
export function CommitDetailPanel({ owner, name, commit, onClose }: CommitDetailPanelProps) {
  const { t } = useTranslator();
  const [state, setState] = useState<CommitDetailState>({
    sha: null,
    loading: false,
    error: null,
    detail: null,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [mergeTarget, setMergeTarget] = useState<number | null>(null);
  const [mergeSuccess, setMergeSuccess] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<{ sha: string; result: "copied" | "failed" } | null>(
    null,
  );

  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const router = useRouter();

  const sha = commit?.oid ?? null;
  const issues = commit ? collectIssues(commit.pullRequests) : [];
  const current = sha !== null && state.sha === sha;
  const detail = current ? state.detail : null;
  const error = current ? state.error : null;
  const loading = sha !== null && (state.loading || !current) && detail === null;
  const copyState = copyHint && copyHint.sha === sha ? copyHint.result : "idle";

  useEffect(() => {
    if (!sha) {
      return;
    }

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetchWithRetry(
          `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}`,
          { signal: controller.signal, t },
        );
        if (controller.signal.aborted) {
          return;
        }
        const data = (await response.json()) as CommitDetailResponse;
        if (!controller.signal.aborted) {
          setState({ sha, loading: false, error: null, detail: data });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        const info =
          error instanceof OnlineRequestError ? error.info : describeApiFailure(500, null, t);
        setState({
          sha,
          loading: false,
          error: `${info.title}${t("common.titleSeparator")}${info.message}`,
          detail: null,
        });
      }
    })();

    return () => controller.abort();
  }, [owner, name, sha, reloadKey, t]);

  // Esc 关闭；Tab 在面板内循环（焦点陷阱），避免键盘焦点绕到背后的时间线
  useEffect(() => {
    if (!commit) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commit, onClose]);

  // 打开时聚焦关闭按钮，关闭后还原焦点（键盘可达性）
  useEffect(() => {
    if (commit) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      closeButtonRef.current?.focus();
      return () => previousFocusRef.current?.focus();
    }
  }, [commit]);

  // 卸载时清理复制提示定时器
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  if (!commit) {
    return null;
  }

  const githubUrl = `https://github.com/${owner}/${name}/commit/${commit.oid}`;

  function handleMerged(message: string) {
    setMergeTarget(null);
    setMergeSuccess(message);
    // 让服务端重新拉取时间线，PR 徽标状态随之更新
    router.refresh();
  }

  async function copySha() {
    if (!sha) {
      return;
    }
    let result: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(sha);
    } catch {
      result = "failed";
    }
    setCopyHint({ sha, result });
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => setCopyHint(null), 2000);
  }

  return (
    <>
      {/* 轻遮罩：点击空白处关闭，但不把整张画布压暗（详情卡固定在右下角） */}
      <div className="fixed inset-0 z-40 bg-black/10" aria-hidden="true" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("commitDetail.label")}
        className="fixed bottom-4 right-4 z-50 flex max-h-[74vh] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-black/[.12] bg-white shadow-2xl ring-1 ring-black/[.04] dark:border-white/[.18] dark:bg-zinc-950 dark:ring-white/[.06]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-black/[.08] bg-zinc-50 px-5 py-4 dark:border-white/[.145] dark:bg-zinc-900">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-600/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-400/15 dark:text-sky-300">
                {t("commitDetail.label")}
              </span>
            </p>
            <h2 className="mt-1 break-words text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {commit.headline || t("commitDetail.noHeadline")}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t("commitDetail.close")}
            className="h-8 w-8 shrink-0 rounded-full border border-black/[.08] text-sm text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all font-mono text-xs text-zinc-700 dark:text-zinc-200">
                {commit.oid}
              </code>
              <button
                type="button"
                onClick={() => void copySha()}
                className="h-7 rounded-full border border-black/[.08] px-3 text-xs text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
              >
                {copyState === "copied"
                  ? t("commitDetail.copied")
                  : copyState === "failed"
                    ? t("commitDetail.copyFailed")
                    : t("commitDetail.copySha")}
              </button>
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-7 rounded-full border border-black/[.08] px-3 text-xs leading-6 text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
              >
                {t("commitDetail.openOnGithub")}
              </a>
            </div>

            <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
              {commit.author.avatarUrl ? (
                <Image
                  src={commit.author.avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 rounded-full"
                />
              ) : null}
              <div className="min-w-0">
                <p className="truncate text-zinc-900 dark:text-zinc-100">
                  {commit.author.login ?? commit.author.name ?? t("commitDetail.unknownAuthor")}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t("commitDetail.committedAt", {
                    time: `${formatUtcDateTime(commit.committedDate)}${t("common.utcSuffix")}`,
                  })}
                </p>
              </div>
            </div>

            {commit.parents.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span>{t("commitDetail.parents")}</span>
                {commit.parents.map((parent) => (
                  <a
                    key={parent}
                    href={`https://github.com/${owner}/${name}/commit/${parent}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-black/[.08] px-2 py-0.5 font-mono text-zinc-600 underline-offset-4 hover:underline dark:border-white/[.145] dark:text-zinc-300"
                  >
                    {shortSha(parent)}
                  </a>
                ))}
              </div>
            ) : null}

            {commit.pullRequests.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">
                  {t("commitDetail.pullRequests")}
                </span>
                {commit.pullRequests.map((pullRequest) => (
                  <span key={pullRequest.number} className="flex items-center gap-1">
                    <a
                      href={
                        pullRequest.url ??
                        `https://github.com/${owner}/${name}/pull/${pullRequest.number}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      title={pullRequest.title}
                      className={`rounded-full border px-2 py-0.5 underline-offset-4 hover:underline ${prStateClass(pullRequest.state)}`}
                    >
                      #{pullRequest.number} {prStateLabel(pullRequest.state, t)}
                    </a>
                    {pullRequest.state === "OPEN" ? (
                      <button
                        type="button"
                        aria-label={t("commitDetail.mergePullAria", { number: pullRequest.number })}
                        onClick={() => {
                          setMergeSuccess(null);
                          setMergeTarget(pullRequest.number);
                        }}
                        className="h-6 rounded-full border border-black/[.08] px-2 text-[11px] text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
                      >
                        {t("commitDetail.merge")}
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}

            {issues.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">{t("commitDetail.issues")}</span>
                {issues.map((issue) => (
                  <a
                    key={issue.number}
                    href={issue.url ?? `https://github.com/${owner}/${name}/issues/${issue.number}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={issue.title}
                    className={`rounded-full border px-2 py-0.5 underline-offset-4 hover:underline ${issueStateClass(issue.state)}`}
                  >
                    #{issue.number} {issueStateLabel(issue.state, t)}
                  </a>
                ))}
              </div>
            ) : null}
            {mergeSuccess ? (
              <p
                role="status"
                className="rounded-lg border border-green-300 bg-green-50 p-3 text-xs text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200"
              >
                {mergeSuccess}
              </p>
            ) : null}

            {mergeTarget !== null ? (
              <MergePullPanel
                key={mergeTarget}
                owner={owner}
                name={name}
                number={mergeTarget}
                onMerged={handleMerged}
                onCancel={() => setMergeTarget(null)}
              />
            ) : null}
          </section>

          <section className="mt-5 border-t border-black/[.08] pt-4 dark:border-white/[.145]">
            {loading ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t("commitDetail.loadingFiles")}
              </p>
            ) : error ? (
              <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    setState((previous) => ({ ...previous, loading: true, error: null }));
                    setReloadKey((value) => value + 1);
                  }}
                  className="mt-3 h-8 rounded-full border border-red-400 px-4 text-xs font-medium transition-colors hover:bg-red-100 dark:border-red-600 dark:hover:bg-red-900"
                >
                  {t("common.retry")}
                </button>
              </div>
            ) : detail ? (
              <>
                {detail.meta.degraded ? (
                  <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                    {t("commitDetail.degraded.before")}
                    {detail.meta.fetchedAt
                      ? t("commitDetail.degraded.fetched", {
                          time: formatUtcDateTime(detail.meta.fetchedAt),
                        })
                      : ""}
                    {detail.meta.resetAt
                      ? t("commitDetail.degraded.reset", {
                          time: formatUtcDateTime(detail.meta.resetAt),
                        })
                      : ""}
                    {t("commitDetail.degraded.after")}
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {detail.files.length > 0
                      ? t("commitDetail.filesChangedCount", {
                          count: `${detail.files.length}${detail.filesTruncated ? "+" : ""}`,
                        })
                      : t("commitDetail.filesChanged")}
                  </h3>
                  {detail.stats ? (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="text-green-700 dark:text-green-400">
                        +{detail.stats.additions}
                      </span>{" "}
                      <span className="text-red-700 dark:text-red-400">
                        −{detail.stats.deletions}
                      </span>{" "}
                      {t("commitDetail.statsTotal", { total: detail.stats.total })}
                    </p>
                  ) : null}
                </div>

                {detail.files.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-black/[.08] bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-white/[.145] dark:bg-zinc-900 dark:text-zinc-300">
                    {t("commitDetail.noFiles")}
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {detail.files.map((file) => (
                      <li
                        key={file.filename}
                        className="rounded-lg border border-black/[.08] px-3 py-2 dark:border-white/[.145]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <code className="break-all font-mono text-xs text-zinc-800 dark:text-zinc-200">
                            {file.filename}
                          </code>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${fileStatusClass(file.status)}`}
                          >
                            {fileStatusLabel(file.status, t)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          <span className="text-green-700 dark:text-green-400">
                            +{file.additions}
                          </span>{" "}
                          <span className="text-red-700 dark:text-red-400">−{file.deletions}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                {detail.filesTruncated ? (
                  <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                    {t("commitDetail.truncated", {
                      shown: detail.files.length,
                      max: FILE_LIMIT,
                    })}
                  </p>
                ) : null}

                <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
                  {t("commitDetail.fetchedAt", {
                    time: `${formatUtcDateTime(detail.meta.fetchedAt)}${t("common.utcSuffix")}`,
                  })}
                  {detail.meta.cached ? t("commitDetail.cachedSuffix") : ""}
                </p>
              </>
            ) : null}
          </section>
        </div>
      </aside>
    </>
  );
}
