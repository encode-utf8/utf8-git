import { describe, expect, it, vi } from "vitest";

import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubUnauthorizedError,
} from "./github-errors";
import { fetchBranchDeletionContext } from "./github-branch-settings";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// 按 URL 分派：仓库元数据与分支详情各自返回一个确定性响应
function routedFetch(repo: () => Response, branch: () => Response): typeof fetch {
  return (async (url: string | URL) => {
    return String(url).includes("/branches/") ? branch() : repo();
  }) as unknown as typeof fetch;
}

const base = { token: "t", owner: "o", name: "n", branch: "feature/x" };

describe("fetchBranchDeletionContext", () => {
  it("分别读取默认分支与目标分支的保护状态", async () => {
    const fetchImpl = vi.fn(
      routedFetch(
        () => jsonResponse(200, { default_branch: "main" }),
        () =>
          jsonResponse(
            200,
            { name: "feature/x", protected: true },
            { "x-ratelimit-remaining": "4999" },
          ),
      ),
    ) as unknown as typeof fetch;
    const context = await fetchBranchDeletionContext({ ...base, fetchImpl });
    expect(context).toMatchObject({ exists: true, defaultBranch: "main", protectedBranch: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("protected 缺失时按未保护处理", async () => {
    const fetchImpl = routedFetch(
      () => jsonResponse(200, { default_branch: "main" }),
      () => jsonResponse(200, { name: "feature/x" }),
    );
    const context = await fetchBranchDeletionContext({ ...base, fetchImpl });
    expect(context.protectedBranch).toBe(false);
  });

  it("分支 404 → exists=false，但仍返回默认分支", async () => {
    const fetchImpl = routedFetch(
      () => jsonResponse(200, { default_branch: "main" }),
      () => jsonResponse(404, { message: "Branch not found" }),
    );
    const context = await fetchBranchDeletionContext({ ...base, branch: "gone", fetchImpl });
    expect(context).toMatchObject({ exists: false, defaultBranch: "main", protectedBranch: false });
  });

  it("仓库 404 → GitHubNotFoundError", async () => {
    const fetchImpl = routedFetch(
      () => jsonResponse(404, {}),
      () => jsonResponse(200, { protected: false }),
    );
    await expect(fetchBranchDeletionContext({ ...base, fetchImpl })).rejects.toBeInstanceOf(
      GitHubNotFoundError,
    );
  });

  it("401 → GitHubUnauthorizedError", async () => {
    const fetchImpl = routedFetch(
      () => jsonResponse(401, {}),
      () => jsonResponse(200, { protected: false }),
    );
    await expect(fetchBranchDeletionContext({ ...base, fetchImpl })).rejects.toBeInstanceOf(
      GitHubUnauthorizedError,
    );
  });

  it("403 配额用尽 → GitHubRateLimitError，否则 GitHubForbiddenError", async () => {
    const limited = routedFetch(
      () => jsonResponse(200, { default_branch: "main" }),
      () => jsonResponse(403, {}, { "x-ratelimit-remaining": "0" }),
    );
    await expect(
      fetchBranchDeletionContext({ ...base, fetchImpl: limited }),
    ).rejects.toBeInstanceOf(GitHubRateLimitError);
    const forbidden = routedFetch(
      () => jsonResponse(200, { default_branch: "main" }),
      () => jsonResponse(403, {}),
    );
    await expect(
      fetchBranchDeletionContext({ ...base, fetchImpl: forbidden }),
    ).rejects.toBeInstanceOf(GitHubForbiddenError);
  });
});
