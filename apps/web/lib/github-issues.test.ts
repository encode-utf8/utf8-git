import { describe, expect, it, vi } from "vitest";

import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubUnauthorizedError,
  GitHubValidationError,
} from "./github-errors";
import { createIssue, normalizeCreatedIssue } from "./github-issues";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const base = { token: "t", owner: "o", name: "n", title: "标题", body: "", labels: [] as string[] };

describe("normalizeCreatedIssue", () => {
  it("提取 number / title / state / url", () => {
    expect(
      normalizeCreatedIssue({ number: 7, title: "T", state: "open", html_url: "https://x/7" }),
    ).toEqual({ number: 7, title: "T", state: "open", url: "https://x/7" });
  });

  it("缺字段时回退默认值", () => {
    expect(normalizeCreatedIssue({})).toEqual({ number: 0, title: "", state: "open", url: null });
  });
});

describe("createIssue", () => {
  it("正文与标签为空时请求体只含标题", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ title: "标题" });
      return jsonResponse(201, { number: 1, title: "标题", state: "open", html_url: "u" });
    });
    const result = await createIssue({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.number).toBe(1);
  });

  it("带正文与标签时透传 body / labels", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        title: "标题",
        body: "正文",
        labels: ["bug"],
      });
      return jsonResponse(201, { number: 2, title: "标题", state: "open", html_url: "u" });
    });
    await createIssue({
      ...base,
      body: "正文",
      labels: ["bug"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  });

  it("422 / 410 → GitHubValidationError", async () => {
    const invalid = (async () => jsonResponse(422, {})) as unknown as typeof fetch;
    await expect(createIssue({ ...base, fetchImpl: invalid })).rejects.toBeInstanceOf(
      GitHubValidationError,
    );
    const gone = (async () => jsonResponse(410, {})) as unknown as typeof fetch;
    await expect(createIssue({ ...base, fetchImpl: gone })).rejects.toBeInstanceOf(
      GitHubValidationError,
    );
  });

  it("401 → GitHubUnauthorizedError；404 → GitHubNotFoundError", async () => {
    const unauthorized = (async () => jsonResponse(401, {})) as unknown as typeof fetch;
    await expect(createIssue({ ...base, fetchImpl: unauthorized })).rejects.toBeInstanceOf(
      GitHubUnauthorizedError,
    );
    const missing = (async () => jsonResponse(404, {})) as unknown as typeof fetch;
    await expect(createIssue({ ...base, fetchImpl: missing })).rejects.toBeInstanceOf(
      GitHubNotFoundError,
    );
  });

  it("403 配额用尽 → GitHubRateLimitError，否则 GitHubForbiddenError", async () => {
    const limited = (async () =>
      jsonResponse(403, {}, { "x-ratelimit-remaining": "0" })) as unknown as typeof fetch;
    await expect(createIssue({ ...base, fetchImpl: limited })).rejects.toBeInstanceOf(
      GitHubRateLimitError,
    );
    const forbidden = (async () => jsonResponse(403, {})) as unknown as typeof fetch;
    await expect(createIssue({ ...base, fetchImpl: forbidden })).rejects.toBeInstanceOf(
      GitHubForbiddenError,
    );
  });
});
