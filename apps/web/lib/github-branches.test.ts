import { describe, expect, it, vi } from "vitest";

import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubUnauthorizedError,
  GitHubValidationError,
} from "./github-errors";
import { createBranchRef, deleteBranchRef, normalizeCreatedRef } from "./github-branches";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const SHA = "a".repeat(40);
const base = { token: "t", owner: "o", name: "n", branch: "feature/x", fromSha: SHA };

describe("normalizeCreatedRef", () => {
  it("从 refs/heads/... 提取分支名", () => {
    const result = normalizeCreatedRef(
      { ref: "refs/heads/feature/demo", object: { sha: "abc" }, url: "https://x" },
      "fallback",
    );
    expect(result).toEqual({
      ref: "refs/heads/feature/demo",
      branch: "feature/demo",
      sha: "abc",
      url: "https://x",
    });
  });

  it("缺字段时回退到请求分支名", () => {
    const result = normalizeCreatedRef({}, "feature/x");
    expect(result.ref).toBe("refs/heads/feature/x");
    expect(result.branch).toBe("feature/x");
    expect(result.sha).toBe("");
    expect(result.url).toBeNull();
  });
});

describe("createBranchRef", () => {
  it("成功后返回归一化引用，并发送正确的请求体", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        ref: "refs/heads/feature/x",
        sha: SHA,
      });
      return jsonResponse(201, {
        ref: "refs/heads/feature/x",
        object: { sha: SHA },
        url: "https://api.github.com/repos/o/n/git/refs/heads/feature%2Fx",
      });
    });
    const result = await createBranchRef({
      ...base,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.branch).toBe("feature/x");
    expect(result.sha).toBe(SHA);
  });

  it("422 → GitHubValidationError（分支名非法或已存在）", async () => {
    const fetchImpl = (async () =>
      jsonResponse(422, { message: "Reference already exists" })) as unknown as typeof fetch;
    await expect(createBranchRef({ ...base, fetchImpl })).rejects.toBeInstanceOf(
      GitHubValidationError,
    );
  });

  it("401 → GitHubUnauthorizedError", async () => {
    const fetchImpl = (async () => jsonResponse(401, {})) as unknown as typeof fetch;
    await expect(createBranchRef({ ...base, fetchImpl })).rejects.toBeInstanceOf(
      GitHubUnauthorizedError,
    );
  });

  it("403 配额用尽 → GitHubRateLimitError，否则 GitHubForbiddenError", async () => {
    const limited = (async () =>
      jsonResponse(403, {}, { "x-ratelimit-remaining": "0" })) as unknown as typeof fetch;
    await expect(createBranchRef({ ...base, fetchImpl: limited })).rejects.toBeInstanceOf(
      GitHubRateLimitError,
    );
    const forbidden = (async () => jsonResponse(403, {})) as unknown as typeof fetch;
    await expect(createBranchRef({ ...base, fetchImpl: forbidden })).rejects.toBeInstanceOf(
      GitHubForbiddenError,
    );
  });

  it("404 → GitHubNotFoundError", async () => {
    const fetchImpl = (async () => jsonResponse(404, {})) as unknown as typeof fetch;
    await expect(createBranchRef({ ...base, fetchImpl })).rejects.toBeInstanceOf(
      GitHubNotFoundError,
    );
  });
});

describe("deleteBranchRef", () => {
  it("成功后返回被删除的分支名，且以 DELETE 调用 git refs（含斜杠分支路径）", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.github.com/repos/o/n/git/refs/heads/feature/x");
      expect(init?.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    const result = await deleteBranchRef({
      token: "t",
      owner: "o",
      name: "n",
      branch: "feature/x",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ branch: "feature/x", deleted: true });
  });

  it("404 → GitHubNotFoundError（分支不存在 / 无权）", async () => {
    const fetchImpl = (async () => jsonResponse(404, {})) as unknown as typeof fetch;
    await expect(
      deleteBranchRef({ token: "t", owner: "o", name: "n", branch: "gone", fetchImpl }),
    ).rejects.toBeInstanceOf(GitHubNotFoundError);
  });

  it("422 → GitHubValidationError（受保护分支 / 引用非法）", async () => {
    const fetchImpl = (async () =>
      jsonResponse(422, { message: "Protected branch" })) as unknown as typeof fetch;
    await expect(
      deleteBranchRef({ token: "t", owner: "o", name: "n", branch: "main", fetchImpl }),
    ).rejects.toBeInstanceOf(GitHubValidationError);
  });

  it("401 → GitHubUnauthorizedError", async () => {
    const fetchImpl = (async () => jsonResponse(401, {})) as unknown as typeof fetch;
    await expect(
      deleteBranchRef({ token: "t", owner: "o", name: "n", branch: "x", fetchImpl }),
    ).rejects.toBeInstanceOf(GitHubUnauthorizedError);
  });

  it("403 配额用尽 → GitHubRateLimitError，否则 GitHubForbiddenError", async () => {
    const limited = (async () =>
      jsonResponse(403, {}, { "x-ratelimit-remaining": "0" })) as unknown as typeof fetch;
    await expect(
      deleteBranchRef({ token: "t", owner: "o", name: "n", branch: "x", fetchImpl: limited }),
    ).rejects.toBeInstanceOf(GitHubRateLimitError);
    const forbidden = (async () => jsonResponse(403, {})) as unknown as typeof fetch;
    await expect(
      deleteBranchRef({ token: "t", owner: "o", name: "n", branch: "x", fetchImpl: forbidden }),
    ).rejects.toBeInstanceOf(GitHubForbiddenError);
  });
});
