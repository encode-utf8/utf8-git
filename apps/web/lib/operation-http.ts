// 写操作失败的 HTTP 映射（M3-2 / M3-3 共用的服务端胶水）。
// runOperation 会把执行阶段的原始错误包成 OperationError，这里透传其 originalError，
// 把 GitHub 错误分类映射为准确的状态码；conflictCode 由具体操作提供。

import { NextResponse } from "next/server";

import { getDataStores } from "./data-stores";
import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubNetworkError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubTimeoutError,
  GitHubUnauthorizedError,
  GitHubValidationError,
} from "./github-errors";
import type { OperationAuditStoreLike } from "./operation-audit";
import { OperationError } from "./operations";
import type { EnvLike } from "./shared-store";
import {
  decideWriteRateLimit,
  getWriteRateLimitConfig,
  rateLimitWindowStart,
} from "./write-rate-limit";

export function mapOperationFailure(error: unknown, conflictCode: string): NextResponse {
  const cause = error instanceof OperationError ? error.originalError : error;
  if (cause instanceof GitHubUnauthorizedError) {
    return NextResponse.json({ error: "token_invalid" }, { status: 401 });
  }
  if (cause instanceof GitHubRateLimitError) {
    return NextResponse.json(
      { error: "rate_limited", resetAt: cause.resetAt?.toISOString() ?? null },
      { status: 429 },
    );
  }
  if (cause instanceof GitHubValidationError) {
    return NextResponse.json({ error: conflictCode }, { status: 422 });
  }
  if (cause instanceof GitHubNotFoundError) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (cause instanceof GitHubForbiddenError) {
    return NextResponse.json({ error: "forbidden", ssoUrl: cause.ssoUrl }, { status: 403 });
  }
  if (cause instanceof GitHubNetworkError) {
    return NextResponse.json({ error: "github_unreachable" }, { status: 503 });
  }
  if (cause instanceof GitHubTimeoutError) {
    return NextResponse.json({ error: "github_timeout" }, { status: 504 });
  }
  if (cause instanceof GitHubApiError) {
    return NextResponse.json({ error: "github_error" }, { status: 502 });
  }
  if (error instanceof OperationError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}

/**
 * 写操作频率限制守卫（M3-8 / TODO-231）：超限返回 429（含 Retry-After），放行返回 null。
 * 计数来自写操作审计（窗口内的 started 记录），因此不引入新表，且与审计同源、多实例一致。
 */
export async function enforceWriteRateLimit(
  actor: string,
  options: { audit?: OperationAuditStoreLike; env?: EnvLike; now?: Date } = {},
): Promise<NextResponse | null> {
  const config = getWriteRateLimitConfig(options.env);
  const now = options.now ?? new Date();
  const audit = options.audit ?? getDataStores().operationAudit;
  const recent = await audit.count({
    actor,
    status: "started",
    since: rateLimitWindowStart(now, config.windowMs).toISOString(),
  });
  const decision = decideWriteRateLimit({ recent, limit: config.limit, windowMs: config.windowMs });
  if (decision.allowed) {
    return null;
  }
  return NextResponse.json(
    { error: "too_many_requests", limit: decision.limit, retryAfterMs: decision.retryAfterMs },
    {
      status: 429,
      headers: {
        "retry-after": String(Math.ceil(decision.retryAfterMs / 1000)),
        "cache-control": "no-store",
      },
    },
  );
}
