import { describe, expect, it, vi } from "vitest";

import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubUnauthorizedError,
  GitHubValidationError,
} from "./github-errors";
import {
  createPullRequest,
  fetchPullRequest,
  mergePullRequest,
  normalizeCreatedPullRequest,
  normalizeMergeResult,
  normalizePullRequest,
} from "./github-pulls";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const base = { token: "t", owner: "o", name: "n", number: 61 };

describe("normalizePullRequest", () => {
  it("提取可合并性相关字段", () => {
    const result = normalizePullRequest(
      {
        number: 61,
        title: "feat: 待合并",
        state: "open",
        merged: false,
        draft: false,
        mergeable: false,
        mergeable_state: "dirty",
        head: { ref: "feature/x" },
        base: { ref: "main" },
        html_url: "https://github.com/o/n/pull/61",
      },
      61,
    );
    expect(result).toEqual({
      number: 61,
      title: "feat: 待合并",
      state: "open",
      merged: false,
      draft: false,
      mergeable: false,
      mergeableState: "dirty",
      headRef: "feature/x",
      baseRef: "main",
      url: "https://github.com/o/n/pull/61",
    });
  });

  it("mergeable 缺失或非布尔 → null（视为计算中）", () => {
    expect(normalizePullRequest({}, 61).mergeable).toBeNull();
    expect(normalizePullRequest({ mergeable: "unknown" }, 61).mergeable).toBeNull();
    expect(normalizePullRequest({}, 61).number).toBe(61);
    expect(normalizePullRequest({}, 61).state).toBe("open");
  });
});

describe("normalizeMergeResult", () => {
  it("只认显式 merged: true", () => {
    expect(normalizeMergeResult({ merged: true, sha: "abc", message: "ok" })).toEqual({
      merged: true,
      sha: "abc",
      message: "ok",
    });
    expect(normalizeMergeResult({ merged: false }).merged).toBe(false);
    expect(normalizeMergeResult({}).sha).toBeNull();
  });
});

describe("fetchPullRequest", () => {
  it("成功后返回归一化 PR（含限额头）", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/repos/o/n/pulls/61");
      expect(init?.method).toBe("GET");
      return jsonResponse(
        200,
        { number: 61, mergeable: true, mergeable_state: "clean" },
        {
          "x-ratelimit-remaining": "4994",
        },
      );
    });
    const result = await fetchPullRequest({
      ...base,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.mergeable).toBe(true);
    expect(result.rateLimit?.remaining).toBe(4994);
  });

  it("404 / 401 / 403 分别映射到对应错误类", async () => {
    const notFound = (async () => jsonResponse(404, {})) as unknown as typeof fetch;
    await expect(fetchPullRequest({ ...base, fetchImpl: notFound })).rejects.toBeInstanceOf(
      GitHubNotFoundError,
    );
    const unauthorized = (async () => jsonResponse(401, {})) as unknown as typeof fetch;
    await expect(fetchPullRequest({ ...base, fetchImpl: unauthorized })).rejects.toBeInstanceOf(
      GitHubUnauthorizedError,
    );
    const limited = (async () =>
      jsonResponse(403, {}, { "x-ratelimit-remaining": "0" })) as unknown as typeof fetch;
    await expect(fetchPullRequest({ ...base, fetchImpl: limited })).rejects.toBeInstanceOf(
      GitHubRateLimitError,
    );
  });
});

describe("mergePullRequest", () => {
  it("成功后返回合并结果，并发送 merge_method", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/repos/o/n/pulls/61/merge");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({ merge_method: "squash" });
      return jsonResponse(200, {
        merged: true,
        sha: "b".repeat(40),
        message: "Pull Request successfully merged",
      });
    });
    const result = await mergePullRequest({
      ...base,
      method: "squash",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.merged).toBe(true);
    expect(result.sha).toBe("b".repeat(40));
  });

  it("405 / 409 / 422 → GitHubValidationError（不可合并）", async () => {
    for (const status of [405, 409, 422]) {
      const fetchImpl = (async () =>
        jsonResponse(status, { message: "no" })) as unknown as typeof fetch;
      await expect(
        mergePullRequest({ ...base, method: "merge", fetchImpl }),
      ).rejects.toBeInstanceOf(GitHubValidationError);
    }
  });

  it("403 非限流 → GitHubForbiddenError，500 → GitHubApiError", async () => {
    const forbidden = (async () => jsonResponse(403, {})) as unknown as typeof fetch;
    await expect(
      mergePullRequest({ ...base, method: "merge", fetchImpl: forbidden }),
    ).rejects.toBeInstanceOf(GitHubForbiddenError);
    const serverError = (async () => jsonResponse(500, {})) as unknown as typeof fetch;
    await expect(
      mergePullRequest({ ...base, method: "merge", fetchImpl: serverError }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });
});
describe("normalizeCreatedPullRequest", () => {
  it("提取编号 / 分支方向与草稿标记", () => {
    const result = normalizeCreatedPullRequest({
      number: 101,
      title: "feat: 合并时间线",
      state: "open",
      draft: true,
      head: { ref: "feature/e2e" },
      base: { ref: "main" },
      html_url: "https://github.com/o/n/pull/101",
    });
    expect(result).toEqual({
      number: 101,
      title: "feat: 合并时间线",
      state: "open",
      draft: true,
      headRef: "feature/e2e",
      baseRef: "main",
      url: "https://github.com/o/n/pull/101",
    });
  });

  it("缺字段时给出安全默认值", () => {
    const result = normalizeCreatedPullRequest({});
    expect(result.number).toBe(0);
    expect(result.state).toBe("open");
    expect(result.draft).toBe(false);
    expect(result.headRef).toBeNull();
    expect(result.url).toBeNull();
  });
});

describe("createPullRequest", () => {
  const createBase = {
    token: "t",
    owner: "o",
    name: "n",
    head: "feature/x",
    base: "main",
    title: "feat: x",
    draft: false,
  };

  it("成功后返回归一化 PR；空正文不发送 body 字段", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/repos/o/n/pulls");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        title: "feat: x",
        head: "feature/x",
        base: "main",
        draft: false,
      });
      return jsonResponse(201, {
        number: 101,
        title: "feat: x",
        state: "open",
        head: { ref: "feature/x" },
        base: { ref: "main" },
      });
    });
    const result = await createPullRequest({
      ...createBase,
      body: "",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.number).toBe(101);
    expect(result.headRef).toBe("feature/x");
  });

  it("有正文与草稿标记时一并发送", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        title: "feat: x",
        head: "feature/x",
        base: "main",
        draft: true,
        body: "## 背景",
      });
      return jsonResponse(201, { number: 102, title: "feat: x" });
    });
    await createPullRequest({
      ...createBase,
      body: "## 背景",
      draft: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  });

  it("422 → GitHubValidationError（PR 已存在或无差异）", async () => {
    const fetchImpl = (async () =>
      jsonResponse(422, { message: "A pull request already exists" })) as unknown as typeof fetch;
    await expect(createPullRequest({ ...createBase, body: "", fetchImpl })).rejects.toBeInstanceOf(
      GitHubValidationError,
    );
  });
});
