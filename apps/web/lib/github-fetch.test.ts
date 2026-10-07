import { describe, expect, it } from "vitest";

import { GitHubNetworkError, GitHubTimeoutError } from "./github-errors";
import { githubFetch, isAbortError, isNetworkFailure } from "./github-fetch";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

describe("githubFetch", () => {
  it("成功时透传响应，并把 signal 交给注入的 fetch", async () => {
    let capturedSignal: AbortSignal | null | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const response = await githubFetch("https://api.github.com/user/repos", {}, { fetchImpl });

    expect(response.status).toBe(200);
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  it("超时中止 → GitHubTimeoutError", async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")));
      })) as typeof fetch;

    await expect(
      githubFetch("https://api.github.com/x", {}, { fetchImpl, timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(GitHubTimeoutError);
  });

  it("网络不可达（TypeError）→ GitHubNetworkError（503）", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const error = await githubFetch("https://api.github.com/x", {}, { fetchImpl }).catch(
      (value: unknown) => value,
    );

    expect(error).toBeInstanceOf(GitHubNetworkError);
    expect((error as GitHubNetworkError).status).toBe(503);
  });

  it("undici 错误码（cause 链）也归类为网络错误", async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND api.github.com"), {
      code: "ENOTFOUND",
    });
    const fetchImpl = (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause });
    }) as typeof fetch;

    await expect(githubFetch("https://api.github.com/x", {}, { fetchImpl })).rejects.toBeInstanceOf(
      GitHubNetworkError,
    );
  });

  it("外部 signal 已中止时不误判为超时（原样抛出）", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        throw new Error("aborted by caller");
      }
      return jsonResponse({});
    }) as typeof fetch;

    const error = await githubFetch(
      "https://api.github.com/x",
      { signal: controller.signal },
      { fetchImpl },
    ).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GitHubTimeoutError);
    expect(error).not.toBeInstanceOf(GitHubNetworkError);
  });

  // 真实 socket 失败（本机 9 端口无监听 → 连接被拒绝），验证分类不依赖 mock 形态
  it("真实连接失败归类为 GitHubNetworkError", async () => {
    const error = await githubFetch("http://127.0.0.1:9/", {}, { timeoutMs: 3000 }).catch(
      (value: unknown) => value,
    );

    expect(error).toBeInstanceOf(GitHubNetworkError);
  });
});

describe("isAbortError / isNetworkFailure", () => {
  it("识别中止类错误", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError({ name: "TimeoutError" })).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it("识别网络类错误（TypeError / 错误码 / 消息）", () => {
    expect(isNetworkFailure(new TypeError("fetch failed"))).toBe(true);
    expect(isNetworkFailure(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isNetworkFailure(new Error("socket hang up"))).toBe(true);
    expect(isNetworkFailure(new Error("boom"))).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });
});
