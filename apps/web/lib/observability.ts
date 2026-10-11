// 可观测性（M4-1）：API 路由的统一请求日志 + 未捕获错误的集中上报。
//
// 边界：只做「记录」，不改变业务结果——上报失败、日志失败都不影响响应。
// 关联：每个请求分配一个 request id（优先复用上游 `x-request-id`，否则生成），
// 随响应头回传并写进该请求的日志，便于把一次请求产生的多条日志串起来。

import { createLogEvent, type LogEvent, type LogFields } from "./logger";
import { redactText } from "./redact";
import type { EnvLike } from "./shared-store";

export const REQUEST_ID_HEADER = "x-request-id";
export const ERROR_REPORT_ENDPOINT_ENV = "ERROR_REPORT_ENDPOINT";
export const ERROR_REPORT_TIMEOUT_MS = 2000;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_STACK_LENGTH = 4000;

/** 校验 / 归一化外部传入的 request id：不合规一律丢弃（避免注入到日志）。 */
export function normalizeRequestId(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  return value && REQUEST_ID_PATTERN.test(value) ? value : null;
}

function generateRequestId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** 请求关联 id：优先复用调用方传入的 `x-request-id`，否则生成一个。 */
export function resolveRequestId(request: { headers: Headers }): string {
  return normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? generateRequestId();
}

/** 只取路径：不记录可能含敏感串的查询参数。 */
export function requestPath(request: { url?: string }): string {
  try {
    return new URL(request.url ?? "").pathname;
  } catch {
    return "";
  }
}

export type DescribedError = { name: string; message: string; stack?: string };

/** 把任意抛出物归一化成可安全记录的形状（消息 / 堆栈先脱敏再截断）。 */
export function describeError(error: unknown): DescribedError {
  if (error instanceof Error) {
    const described: DescribedError = {
      name: error.name || "Error",
      message: redactText(error.message || String(error)),
    };
    if (error.stack) {
      described.stack = redactText(error.stack).slice(0, MAX_STACK_LENGTH);
    }
    return described;
  }
  return { name: "NonError", message: redactText(String(error)) };
}

export type ReportError = (error: unknown, context?: LogFields) => Promise<void>;

export type ReportErrorDeps = { log?: LogEvent; env?: EnvLike; fetchImpl?: typeof fetch };

/**
 * 错误上报：先落一条结构化日志（永远做），再按配置把同样内容 POST 到
 * `ERROR_REPORT_ENDPOINT`（可选，尽力而为；失败只记一条 warn，不抛出）。
 */
export function createReportError(deps: ReportErrorDeps = {}): ReportError {
  const log = deps.log ?? createLogEvent();
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  return async (error, context = {}) => {
    const described = describeError(error);
    log("error", "unhandled_error", { ...context, error: described });
    const endpoint = env[ERROR_REPORT_ENDPOINT_ENV]?.trim();
    if (!endpoint) {
      return;
    }
    try {
      await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...context,
          error: described,
          reportedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(ERROR_REPORT_TIMEOUT_MS),
      });
    } catch {
      log("warn", "error_report_failed", { endpoint: redactText(endpoint) });
    }
  };
}

export const reportError: ReportError = createReportError();

export type RouteHandler<Args extends unknown[]> = (
  request: Request,
  ...args: Args
) => Promise<Response>;

export type WithObservabilityDeps = { log?: LogEvent; report?: ReportError; now?: () => number };

/**
 * 包裹 API 路由处理函数：记录每个请求的 状态码 / 耗时 / request id，把抛出的异常
 * 转成 500 并集中上报；同时把 request id 写进响应头，便于对账。
 */
export function withObservability<Args extends unknown[]>(
  route: string,
  handler: RouteHandler<Args>,
  deps: WithObservabilityDeps = {},
): RouteHandler<Args> {
  const log = deps.log ?? createLogEvent();
  const report = deps.report ?? reportError;
  const now = deps.now ?? Date.now;
  return async (request, ...args) => {
    const requestId = resolveRequestId(request);
    const startedAt = now();
    const fields: LogFields = {
      route,
      requestId,
      method: request.method,
      path: requestPath(request),
    };
    let response: Response;
    let failure: unknown = null;
    try {
      response = await handler(request, ...args);
    } catch (error) {
      failure = error;
      response = new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    const durationMs = now() - startedAt;
    const status = response.status;
    log(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "http_request", {
      ...fields,
      status,
      durationMs,
    });
    if (failure !== null) {
      await report(failure, { ...fields, status, durationMs });
    } else if (status >= 500) {
      await report(new Error(`route responded ${status}: ${route}`), {
        ...fields,
        status,
        durationMs,
      });
    }
    try {
      if (!response.headers.has(REQUEST_ID_HEADER)) {
        response.headers.set(REQUEST_ID_HEADER, requestId);
      }
    } catch {
      // 只读响应头：忽略
    }
    return response;
  };
}
