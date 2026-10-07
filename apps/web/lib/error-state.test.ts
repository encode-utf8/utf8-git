import { describe, expect, it } from "vitest";

import {
  classifyGithubError,
  describeApiFailure,
  describeFetchRejection,
  describeGithubError,
  formatResetAt,
  isRetryableKind,
  retryDelayMs,
} from "./error-state";
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

describe("classifyGithubError", () => {
  it("按错误类映射到在线状态类别", () => {
    expect(classifyGithubError(new GitHubUnauthorizedError())).toBe("unauthorized");
    expect(classifyGithubError(new GitHubForbiddenError())).toBe("forbidden");
    expect(classifyGithubError(new GitHubNotFoundError())).toBe("not_found");
    expect(classifyGithubError(new GitHubRateLimitError("x", new Date(0)))).toBe("rate_limited");
    expect(classifyGithubError(new GitHubTimeoutError())).toBe("timeout");
    expect(classifyGithubError(new GitHubNetworkError())).toBe("network");
    expect(classifyGithubError(new GitHubGraphQLError("x"))).toBe("server_error");
    expect(classifyGithubError(new Error("boom"))).toBe("server_error");
  });

  it("未细分的 5xx 按状态归类", () => {
    expect(classifyGithubError(new GitHubApiError("x", 503))).toBe("network");
    expect(classifyGithubError(new GitHubApiError("x", 504))).toBe("timeout");
    expect(classifyGithubError(new GitHubApiError("x", 502))).toBe("server_error");
  });
});

describe("describeGithubError", () => {
  it("限流带出恢复时间与文案", () => {
    const info = describeGithubError(
      new GitHubRateLimitError("x", new Date("2026-10-07T02:00:00Z")),
    );
    expect(info.kind).toBe("rate_limited");
    expect(info.retryable).toBe(false);
    expect(info.resetAt).toBe("2026-10-07T02:00:00.000Z");
    expect(info.message).toContain("2026-10-07 02:00（UTC）");
  });

  it("网络 / 超时均为可重试，且有明确标题", () => {
    expect(describeGithubError(new GitHubNetworkError()).retryable).toBe(true);
    expect(describeGithubError(new GitHubNetworkError()).title).toBe("无法连接 GitHub");
    expect(describeGithubError(new GitHubTimeoutError()).title).toBe("请求超时");
    expect(describeGithubError(new GitHubUnauthorizedError()).retryable).toBe(false);
    expect(isRetryableKind("offline")).toBe(true);
  });
});

describe("describeApiFailure", () => {
  it("按业务错误码优先归类", () => {
    expect(describeApiFailure(503, { error: "github_unreachable" }).kind).toBe("network");
    expect(describeApiFailure(504, { error: "github_timeout" }).kind).toBe("timeout");
    expect(describeApiFailure(500, { error: "github_error" }).kind).toBe("server_error");
  });

  it("无错误码时按 HTTP 状态兜底", () => {
    expect(describeApiFailure(401, null).kind).toBe("unauthorized");
    expect(describeApiFailure(403, null).kind).toBe("forbidden");
    expect(describeApiFailure(404, null).kind).toBe("not_found");
    expect(describeApiFailure(409, null).kind).toBe("cursor_expired");
    expect(describeApiFailure(429, null).kind).toBe("rate_limited");
    expect(describeApiFailure(502, null).kind).toBe("server_error");
  });

  it("限流恢复时间进入文案", () => {
    const info = describeApiFailure(429, {
      error: "rate_limited",
      resetAt: "2026-10-07T02:00:00.000Z",
    });
    expect(info.message).toContain("2026-10-07 02:00（UTC）");
  });
});

describe("describeFetchRejection", () => {
  it("离线优先于其它判断", () => {
    expect(describeFetchRejection(new TypeError("fetch failed"), false).kind).toBe("offline");
  });

  it("中止类 → 超时；其余 → 网络", () => {
    expect(describeFetchRejection({ name: "AbortError" }, true).kind).toBe("timeout");
    expect(describeFetchRejection(new TypeError("fetch failed"), true).kind).toBe("network");
  });
});

describe("retryDelayMs / formatResetAt", () => {
  it("指数退避并封顶", () => {
    expect(retryDelayMs(0, 100)).toBe(100);
    expect(retryDelayMs(1, 100)).toBe(200);
    expect(retryDelayMs(2, 100)).toBe(400);
    expect(retryDelayMs(9, 100, 1000)).toBe(1000);
  });

  it("非法时间返回 null", () => {
    expect(formatResetAt(null)).toBeNull();
    expect(formatResetAt("not-a-date")).toBeNull();
    expect(formatResetAt("2026-10-07T02:00:00.000Z")).toBe("2026-10-07 02:00（UTC）");
  });
});
