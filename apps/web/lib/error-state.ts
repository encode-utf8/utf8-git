// 在线状态错误呈现（服务端页面与客户端组件共用）
// 纯函数、不依赖 DOM：服务端用它把 GitHub 错误类翻成用户文案，
// 客户端用它把 HTTP 状态 / fetch 失败翻成同一套文案与重试策略。
//
// 依据：docs/requirements.md FR-5.1（每种状态有明确文案与行动按钮）、
// FR-5.2（限流提示恢复时间）、场景表「断网」；docs/roadmap.md M1-9。

import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubGraphQLError,
  GitHubNetworkError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubTimeoutError,
  GitHubUnauthorizedError,
} from "./github-errors";

// 在线状态错误类别
export type OnlineErrorKind =
  | "offline" // 设备未联网
  | "network" // 请求未能到达 GitHub
  | "timeout" // 请求已发出但超时
  | "rate_limited" // GitHub 配额超限
  | "unauthorized" // 授权失效，需重新授权
  | "forbidden" // 权限不足 / SSO 未获批
  | "not_found" // 资源不存在或无权访问
  | "cursor_expired" // 服务端分页游标过期
  | "server_error"; // GitHub 服务端异常

// 用户可见的呈现信息：组件直接渲染，不再各自拼文案
export type OnlineErrorInfo = {
  kind: OnlineErrorKind;
  title: string;
  message: string;
  action: string;
  retryable: boolean;
  resetAt: string | null;
  status: number | null;
};

// 可自动重试的类别：只覆盖瞬时故障。
// 鉴权（401/403）与限流（429）不自动重试，避免无意义请求浪费配额。
const RETRYABLE_KINDS: ReadonlySet<OnlineErrorKind> = new Set<OnlineErrorKind>([
  "offline",
  "network",
  "timeout",
  "server_error",
]);

export function isRetryableKind(kind: OnlineErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind);
}

// 指数退避：attempt 从 0 开始（首次重试等待 baseDelayMs，之后翻倍，封顶 maxDelayMs）
export function retryDelayMs(attempt: number, baseDelayMs = 400, maxDelayMs = 4000): number {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return Math.min(baseDelayMs * 2 ** safeAttempt, maxDelayMs);
}

// ISO 时间 → 「YYYY-MM-DD HH:mm（UTC）」
export function formatResetAt(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) {
    return null;
  }
  return `${new Date(time).toISOString().slice(0, 16).replace("T", " ")}（UTC）`;
}

// 中止类错误（超时 / 主动取消）：不视为网络失败
export function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

// 按类别生成统一的用户文案
export function describeKind(
  kind: OnlineErrorKind,
  options: { resetAt?: string | null; status?: number | null } = {},
): OnlineErrorInfo {
  const resetAt = options.resetAt ?? null;
  const status = options.status ?? null;
  const info = (
    values: Omit<OnlineErrorInfo, "retryable" | "resetAt" | "status">,
  ): OnlineErrorInfo => ({
    ...values,
    retryable: isRetryableKind(values.kind),
    resetAt,
    status,
  });

  switch (kind) {
    case "offline":
      return info({
        kind,
        title: "网络已断开",
        message: "当前设备未联网，无法连接 GitHub。请检查网络后重试。",
        action: "重试",
      });
    case "network":
      return info({
        kind,
        title: "无法连接 GitHub",
        message: "请求未能到达 GitHub（可能是网络中断、代理或 DNS 问题）。请稍后重试。",
        action: "重试",
      });
    case "timeout":
      return info({
        kind,
        title: "请求超时",
        message: "GitHub 在预期时间内没有响应，可能是网络缓慢或服务繁忙。请重试。",
        action: "重试",
      });
    case "rate_limited": {
      const when = formatResetAt(resetAt);
      return info({
        kind,
        title: "GitHub API 访问频率超限",
        message: when
          ? `请求次数暂时超出 GitHub 配额，预计 ${when} 恢复。当前展示的是缓存数据（如有），可在恢复后重试。`
          : "请求次数暂时超出 GitHub 配额，且暂无可用的缓存数据。请稍后重试。",
        action: "重试",
      });
    }
    case "unauthorized":
      return info({
        kind,
        title: "GitHub 授权已失效",
        message: "令牌可能已被撤销或过期，重新授权后即可继续。",
        action: "重新授权",
      });
    case "forbidden":
      return info({
        kind,
        title: "访问被 GitHub 拒绝（403）",
        message:
          "可能原因：组织开启了 SAML SSO 且本应用尚未获批，或当前授权权限不足。请重新授权或前往 GitHub 处理。",
        action: "重新授权",
      });
    case "not_found":
      return info({
        kind,
        title: "资源不存在或无权访问",
        message: "目标可能已被删除、改名，或当前授权不包含该私有资源。",
        action: "返回列表",
      });
    case "cursor_expired":
      return info({
        kind,
        title: "分页数据已过期",
        message: "服务端分页游标已失效，请刷新页面后从第一页重新加载。",
        action: "刷新页面",
      });
    default:
      return info({
        kind: "server_error",
        title: "GitHub 服务暂时不可用",
        message: `GitHub 返回了服务端错误${status ? `（${status}）` : ""}，请稍后重试。`,
        action: "重试",
      });
  }
}

// 服务端：把 GitHub 错误类翻成统一呈现
export function describeGithubError(error: unknown): OnlineErrorInfo {
  const kind = classifyGithubError(error);
  return describeKind(kind, {
    resetAt: error instanceof GitHubRateLimitError ? (error.resetAt?.toISOString() ?? null) : null,
    status: error instanceof GitHubApiError ? error.status : null,
  });
}

export function classifyGithubError(error: unknown): OnlineErrorKind {
  if (error instanceof GitHubUnauthorizedError) {
    return "unauthorized";
  }
  if (error instanceof GitHubRateLimitError) {
    return "rate_limited";
  }
  if (error instanceof GitHubForbiddenError) {
    return "forbidden";
  }
  if (error instanceof GitHubNotFoundError) {
    return "not_found";
  }
  if (error instanceof GitHubTimeoutError) {
    return "timeout";
  }
  if (error instanceof GitHubNetworkError) {
    return "network";
  }
  // GraphQL 语义错误 / 其余 HTTP 错误都归为服务端异常
  if (error instanceof GitHubGraphQLError) {
    return "server_error";
  }
  if (error instanceof GitHubApiError && error.status >= 500) {
    return error.status === 503 ? "network" : error.status === 504 ? "timeout" : "server_error";
  }
  return "server_error";
}

// HTTP 状态 → 类别（客户端兜底）
export function kindFromStatus(status: number): OnlineErrorKind {
  if (status === 401) {
    return "unauthorized";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 409) {
    return "cursor_expired";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 503) {
    return "network";
  }
  if (status === 504) {
    return "timeout";
  }
  return "server_error";
}

// 接口返回的业务错误码 → 类别（与 API 路由的 error 字段对齐）
const ERROR_CODE_KINDS: Readonly<Record<string, OnlineErrorKind>> = {
  github_unreachable: "network",
  github_timeout: "timeout",
  rate_limited: "rate_limited",
  token_invalid: "unauthorized",
  no_token: "unauthorized",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  not_found: "not_found",
  cursor_expired: "cursor_expired",
};

// 客户端：把接口的 HTTP 状态 + 业务错误码翻成统一呈现
export function describeApiFailure(
  status: number,
  payload: { error?: unknown; resetAt?: unknown } | null = null,
): OnlineErrorInfo {
  const code = typeof payload?.error === "string" ? payload.error : null;
  const resetAt = typeof payload?.resetAt === "string" ? payload.resetAt : null;
  const kind = (code ? ERROR_CODE_KINDS[code] : undefined) ?? kindFromStatus(status);
  return describeKind(kind, { resetAt, status });
}

// 客户端：把 fetch 抛出的异常（断网 / 中止 / 网络失败）翻成统一呈现
export function describeFetchRejection(error: unknown, online: boolean): OnlineErrorInfo {
  if (!online) {
    return describeKind("offline");
  }
  if (isAbortError(error)) {
    return describeKind("timeout");
  }
  return describeKind("network");
}

// 客户端请求失败的结构化错误：组件据此渲染文案与重试按钮
export class OnlineRequestError extends Error {
  readonly info: OnlineErrorInfo;
  readonly kind: OnlineErrorKind;
  readonly retryable: boolean;
  readonly resetAt: string | null;
  readonly status: number | null;

  constructor(info: OnlineErrorInfo) {
    super(info.message);
    this.name = "OnlineRequestError";
    this.info = info;
    this.kind = info.kind;
    this.retryable = info.retryable;
    this.resetAt = info.resetAt;
    this.status = info.status;
  }
}
