"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { formatUtcDateTime, shortSha } from "@/lib/commit-format";
import type { CommitDetail } from "@/lib/github-commits";
import type { TimelineCommit } from "@/lib/github-timeline";

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

const FILE_STATUS_LABEL: Record<string, string> = {
  added: "新增",
  removed: "删除",
  modified: "修改",
  renamed: "重命名",
  copied: "复制",
  changed: "变更",
  unchanged: "未变",
};

const PR_STATE_LABEL: Record<string, string> = {
  OPEN: "开放",
  MERGED: "已合并",
  CLOSED: "已关闭",
};

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
  const [state, setState] = useState<CommitDetailState>({
    sha: null,
    loading: false,
    error: null,
    detail: null,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [copyHint, setCopyHint] = useState<{ sha: string; result: "copied" | "failed" } | null>(
    null,
  );

  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const sha = commit?.oid ?? null;
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
        const response = await fetch(
          `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) {
          return;
        }
        if (!response.ok) {
          let message = `加载详情失败（HTTP ${response.status}），请重试。`;
          if (response.status === 429) {
            const payload = (await response.json().catch(() => null)) as {
              resetAt?: string | null;
            } | null;
            message = payload?.resetAt
              ? `GitHub 配额受限，预计 ${formatUtcDateTime(payload.resetAt)}（UTC）恢复，请稍后重试。`
              : "GitHub 配额受限，且暂无可用的缓存数据，请稍后重试。";
          } else if (response.status === 401) {
            message = "GitHub 授权已失效，请返回列表页重新授权。";
          } else if (response.status === 403) {
            message = "访问被 GitHub 拒绝（403），可能是授权权限不足。";
          } else if (response.status === 404) {
            message = "提交不存在或当前授权无权访问。";
          }
          if (!controller.signal.aborted) {
            setState({ sha, loading: false, error: message, detail: null });
          }
          return;
        }
        const data = (await response.json()) as CommitDetailResponse;
        if (!controller.signal.aborted) {
          setState({ sha, loading: false, error: null, detail: data });
        }
      } catch {
        if (!controller.signal.aborted) {
          setState({
            sha,
            loading: false,
            error: "网络异常，加载详情失败，请重试。",
            detail: null,
          });
        }
      }
    })();

    return () => controller.abort();
  }, [owner, name, sha, reloadKey]);

  // Esc 关闭
  useEffect(() => {
    if (!commit) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
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
      <div className="fixed inset-0 z-40 bg-black/30" aria-hidden="true" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="提交详情"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-black/[.08] px-5 py-4 dark:border-white/[.145]">
          <div className="min-w-0">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">提交详情</p>
            <h2 className="mt-1 break-words text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {commit.headline || "（无提交信息）"}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭详情"
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
                  ? "已复制"
                  : copyState === "failed"
                    ? "复制失败"
                    : "复制 SHA"}
              </button>
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-7 rounded-full border border-black/[.08] px-3 text-xs leading-6 text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
              >
                在 GitHub 打开
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
                  {commit.author.login ?? commit.author.name ?? "未知作者"}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  提交时间 {formatUtcDateTime(commit.committedDate)}（UTC）
                </p>
              </div>
            </div>

            {commit.parents.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span>父提交</span>
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
                <span className="text-zinc-500 dark:text-zinc-400">关联 Pull Request</span>
                {commit.pullRequests.map((pullRequest) => (
                  <a
                    key={pullRequest.number}
                    href={
                      pullRequest.url ??
                      `https://github.com/${owner}/${name}/pull/${pullRequest.number}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    title={pullRequest.title}
                    className={`rounded-full border px-2 py-0.5 underline-offset-4 hover:underline ${prStateClass(pullRequest.state)}`}
                  >
                    #{pullRequest.number} {PR_STATE_LABEL[pullRequest.state] ?? pullRequest.state}
                  </a>
                ))}
              </div>
            ) : null}
          </section>

          <section className="mt-5 border-t border-black/[.08] pt-4 dark:border-white/[.145]">
            {loading ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">正在加载文件变更…</p>
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
                  重试
                </button>
              </div>
            ) : detail ? (
              <>
                {detail.meta.degraded ? (
                  <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                    GitHub 配额不足，当前展示缓存数据
                    {detail.meta.fetchedAt
                      ? `（获取于 ${formatUtcDateTime(detail.meta.fetchedAt)} UTC）`
                      : ""}
                    {detail.meta.resetAt
                      ? `，预计 ${formatUtcDateTime(detail.meta.resetAt)}（UTC）恢复`
                      : ""}
                    。
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {detail.files.length > 0
                      ? `文件变更（${detail.files.length}${detail.filesTruncated ? "+" : ""}）`
                      : "文件变更"}
                  </h3>
                  {detail.stats ? (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="text-green-700 dark:text-green-400">
                        +{detail.stats.additions}
                      </span>{" "}
                      <span className="text-red-700 dark:text-red-400">
                        −{detail.stats.deletions}
                      </span>{" "}
                      / 共 {detail.stats.total} 行
                    </p>
                  ) : null}
                </div>

                {detail.files.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-black/[.08] bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-white/[.145] dark:bg-zinc-900 dark:text-zinc-300">
                    本次提交没有文件变更（例如合并提交或空提交）。
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
                            {FILE_STATUS_LABEL[file.status] ?? file.status}
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
                    仅展示前 {detail.files.length} 个文件（GitHub 单次响应最多 300
                    个），完整变更请在 GitHub 查看。
                  </p>
                ) : null}

                <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
                  数据获取于 {formatUtcDateTime(detail.meta.fetchedAt)}（UTC）
                  {detail.meta.cached ? "，命中 30 分钟缓存" : ""}
                </p>
              </>
            ) : null}
          </section>
        </div>
      </aside>
    </>
  );
}
