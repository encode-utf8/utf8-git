import { describe, expect, it } from "vitest";

import { fetchJsonWithRetry, fetchWithRetry } from "./client-fetch";
import { OnlineRequestError } from "./error-state";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const noSleep = async () => {};

describe("fetchWithRetry", () => {
  it("成功时直接返回，不发额外请求", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const response = await fetchWithRetry("/api/repos", {
      fetchImpl,
      sleep: noSleep,
      isOnline: () => true,
    });

    expect(response.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("网络失败按指数退避重试，成功即返回", async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetchImpl = (async () => {
      calls += 1;
      if (calls < 3) {
        throw new TypeError("fetch failed");
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const response = await fetchWithRetry("/api/repos", {
      fetchImpl,
      baseDelayMs: 100,
      isOnline: () => true,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(response.status).toBe(200);
    expect(calls).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  it("离线短路：不发起请求，归类为 offline", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({});
    }) as typeof fetch;

    const error = await fetchWithRetry("/api/repos", {
      fetchImpl,
      isOnline: () => false,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(OnlineRequestError);
    expect((error as OnlineRequestError).kind).toBe("offline");
    expect(calls).toBe(0);
  });

  it("5xx 重试耗尽 → server_error", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({ error: "github_error" }, { status: 502 });
    }) as typeof fetch;

    const error = await fetchWithRetry("/api/repos", {
      fetchImpl,
      retries: 2,
      sleep: noSleep,
      isOnline: () => true,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(OnlineRequestError);
    expect((error as OnlineRequestError).kind).toBe("server_error");
    expect(calls).toBe(3);
  });

  it("429 不自动重试，并带出恢复时间", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse(
        { error: "rate_limited", resetAt: "2026-10-07T02:00:00.000Z" },
        { status: 429 },
      );
    }) as typeof fetch;

    const error = await fetchWithRetry("/api/repos", {
      fetchImpl,
      sleep: noSleep,
      isOnline: () => true,
    }).catch((value: unknown) => value);

    expect((error as OnlineRequestError).kind).toBe("rate_limited");
    expect((error as OnlineRequestError).resetAt).toBe("2026-10-07T02:00:00.000Z");
    expect(calls).toBe(1);
  });

  it("401 不重试，归类为授权失效", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({ error: "token_invalid" }, { status: 401 });
    }) as typeof fetch;

    const error = await fetchWithRetry("/api/x", {
      fetchImpl,
      sleep: noSleep,
      isOnline: () => true,
    }).catch((value: unknown) => value);

    expect((error as OnlineRequestError).kind).toBe("unauthorized");
    expect(calls).toBe(1);
  });

  it("503 github_unreachable 归类为网络错误并重试", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({ error: "github_unreachable" }, { status: 503 });
    }) as typeof fetch;

    const error = await fetchWithRetry("/api/x", {
      fetchImpl,
      retries: 1,
      sleep: noSleep,
      isOnline: () => true,
    }).catch((value: unknown) => value);

    expect((error as OnlineRequestError).kind).toBe("network");
    expect(calls).toBe(2);
  });

  it("外部 signal 已中止 → 抛超时类错误且不请求", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({});
    }) as typeof fetch;

    const error = await fetchWithRetry("/api/x", {
      fetchImpl,
      signal: controller.signal,
      isOnline: () => true,
    }).catch((value: unknown) => value);

    expect((error as OnlineRequestError).kind).toBe("timeout");
    expect(calls).toBe(0);
  });
});

describe("fetchJsonWithRetry", () => {
  it("网络失败重试后成功，POST 方法与请求体保持不变", async () => {
    let calls = 0;
    const seen: Array<{ method?: string; body?: unknown }> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls += 1;
      seen.push({ method: init.method, body: init.body });
      if (calls < 2) {
        throw new TypeError("fetch failed");
      }
      return jsonResponse({ status: "succeeded" });
    }) as unknown as typeof fetch;

    const response = await fetchJsonWithRetry("/api/x", {
      body: JSON.stringify({ confirmed: true }),
      fetchImpl,
      sleep: noSleep,
      isOnline: () => true,
    });

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    expect(seen[0]).toEqual({ method: "POST", body: '{"confirmed":true}' });
    expect(seen[1]).toEqual(seen[0]);
  });

  it("4xx / 5xx 响应原样返回给调用方，不自动重试", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({ error: "too_many_requests" }, { status: 429 });
    }) as unknown as typeof fetch;

    const response = await fetchJsonWithRetry("/api/x", {
      fetchImpl,
      sleep: noSleep,
      isOnline: () => true,
    });

    expect(response.status).toBe(429);
    expect(calls).toBe(1);
  });

  it("网络失败重试耗尽 → OnlineRequestError", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const error = await fetchJsonWithRetry("/api/x", {
      fetchImpl,
      retries: 1,
      sleep: noSleep,
      isOnline: () => true,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(OnlineRequestError);
    expect(calls).toBe(2);
  });

  it("离线短路：不发请求", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({});
    }) as unknown as typeof fetch;

    const error = await fetchJsonWithRetry("/api/x", {
      fetchImpl,
      isOnline: () => false,
    }).catch((value: unknown) => value);

    expect((error as OnlineRequestError).kind).toBe("offline");
    expect(calls).toBe(0);
  });
});
