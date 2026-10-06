import { describe, expect, it } from "vitest";

import {
  GitHubApiError,
  GitHubGraphQLError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubTimeoutError,
  GitHubUnauthorizedError,
} from "./github-errors";
import { githubGraphQL } from "./github-graphql";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

const okPayload = {
  data: {
    rateLimit: { limit: 5000, cost: 1, remaining: 4999, resetAt: "2026-10-05T01:00:00Z" },
    viewer: { login: "encode-utf8" },
  },
};

const noSleep = async () => {};

describe("githubGraphQL", () => {
  it("成功返回数据与归一化后的 rateLimit", async () => {
    const fetchImpl = (async () => jsonResponse(okPayload)) as typeof fetch;
    const result = await githubGraphQL<{ viewer: { login: string } }>({
      token: "t",
      query: "query {}",
      fetchImpl,
      sleepImpl: noSleep,
    });

    expect(result.data.viewer.login).toBe("encode-utf8");
    expect(result.rateLimit).toEqual({
      limit: 5000,
      cost: 1,
      remaining: 4999,
      resetAt: new Date("2026-10-05T01:00:00Z"),
    });
    expect(result.warnings).toEqual([]);
  });

  it("请求头携带令牌且响应不进入 fetch 缓存", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return jsonResponse(okPayload);
    }) as typeof fetch;

    await githubGraphQL({ token: "secret-token", query: "q", fetchImpl, sleepImpl: noSleep });

    const headers = captured?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");
    expect(captured?.cache).toBe("no-store");
    expect(captured?.method).toBe("POST");
  });

  it("401 直接抛 GitHubUnauthorizedError（不重试）", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({}, { status: 401 });
    }) as typeof fetch;

    const error = await githubGraphQL({
      token: "t",
      query: "q",
      fetchImpl,
      maxRetries: 2,
      sleepImpl: noSleep,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GitHubUnauthorizedError);
    expect(calls).toBe(1);
  });

  it("403 且配额为 0 → GitHubRateLimitError（含恢复时间）", async () => {
    const reset = Math.floor(Date.now() / 1000) + 1800;
    const fetchImpl = (async () =>
      jsonResponse(
        {},
        {
          status: 403,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
        },
      )) as typeof fetch;

    const error = await githubGraphQL({
      token: "t",
      query: "q",
      fetchImpl,
      sleepImpl: noSleep,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect((error as GitHubRateLimitError).resetAt?.getTime()).toBe(reset * 1000);
  });

  it("200 但 errors 含 RATE_LIMITED → 抛限流错误", async () => {
    const payload = {
      data: null,
      errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }],
    };
    const fetchImpl = (async () => jsonResponse(payload)) as typeof fetch;

    const error = await githubGraphQL({
      token: "t",
      query: "q",
      fetchImpl,
      sleepImpl: noSleep,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect((error as GitHubRateLimitError).resetAt).toBeNull();
  });

  it("errors 含 NOT_FOUND → GitHubNotFoundError", async () => {
    const payload = {
      data: null,
      errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }],
    };
    const fetchImpl = (async () => jsonResponse(payload)) as typeof fetch;

    await expect(
      githubGraphQL({ token: "t", query: "q", fetchImpl, sleepImpl: noSleep }),
    ).rejects.toBeInstanceOf(GitHubNotFoundError);
  });

  it("data + errors（部分失败）→ 返回数据并带 warnings", async () => {
    const payload = {
      data: { viewer: { login: "encode-utf8" } },
      errors: [{ message: "部分字段失败" }],
    };
    const fetchImpl = (async () => jsonResponse(payload)) as typeof fetch;

    const result = await githubGraphQL<{ viewer: { login: string } }>({
      token: "t",
      query: "q",
      fetchImpl,
      sleepImpl: noSleep,
    });

    expect(result.data.viewer.login).toBe("encode-utf8");
    expect(result.warnings).toEqual(["部分字段失败"]);
  });

  it("data 为空且无可用错误类型 → GitHubGraphQLError（带 details）", async () => {
    const payload = { data: null, errors: [{ message: "第一处错误" }, { message: "第二处错误" }] };
    const fetchImpl = (async () => jsonResponse(payload)) as typeof fetch;

    const error = await githubGraphQL({
      token: "t",
      query: "q",
      fetchImpl,
      sleepImpl: noSleep,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GitHubGraphQLError);
    expect((error as GitHubGraphQLError).details).toEqual(["第一处错误", "第二处错误"]);
  });

  it("5xx 重试后成功（请求次数 = 失败数 + 1）", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls < 3 ? jsonResponse({}, { status: 502 }) : jsonResponse(okPayload);
    }) as typeof fetch;

    const result = await githubGraphQL<{ viewer: { login: string } }>({
      token: "t",
      query: "q",
      fetchImpl,
      maxRetries: 2,
      sleepImpl: noSleep,
    });

    expect(calls).toBe(3);
    expect(result.data.viewer.login).toBe("encode-utf8");
  });

  it("5xx 超过重试上限 → GitHubApiError", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({}, { status: 500 });
    }) as typeof fetch;

    const error = await githubGraphQL({
      token: "t",
      query: "q",
      fetchImpl,
      maxRetries: 2,
      sleepImpl: noSleep,
    }).catch((value: unknown) => value);

    expect(calls).toBe(3);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).status).toBe(500);
  });

  it("网络错误重试后包装为 502", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const error = await githubGraphQL({
      token: "t",
      query: "q",
      fetchImpl,
      maxRetries: 1,
      sleepImpl: noSleep,
    }).catch((value: unknown) => value);

    expect(calls).toBe(2);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).status).toBe(502);
  });

  it("超时中止 → GitHubTimeoutError", async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")));
      });
    }) as typeof fetch;

    await expect(
      githubGraphQL({
        token: "t",
        query: "q",
        fetchImpl,
        timeoutMs: 20,
        maxRetries: 0,
        sleepImpl: noSleep,
      }),
    ).rejects.toBeInstanceOf(GitHubTimeoutError);
  });
});
