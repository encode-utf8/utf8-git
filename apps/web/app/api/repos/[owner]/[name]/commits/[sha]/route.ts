import { NextResponse } from "next/server";

import { getGitHubAccessToken } from "@/lib/access-token";
import { auth } from "@/lib/auth";
import { loadCommitDetail } from "@/lib/commit-data";
import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubNetworkError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubTimeoutError,
  GitHubUnauthorizedError,
} from "@/lib/github-errors";

// 输入约束：只允许安全字符（异常参数不进入上游请求）
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-_.]{0,98})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

// 提交详情接口：/api/repos/{owner}/{name}/commits/{sha}
// 服务端持有令牌；响应为归一化提交详情（含缓存 / 降级标记），不含令牌。
export async function GET(
  _request: Request,
  context: { params: Promise<{ owner: string; name: string; sha: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { owner, name, sha } = await context.params;
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(name)) {
    return NextResponse.json({ error: "invalid_repo" }, { status: 400 });
  }
  if (!SHA_PATTERN.test(sha)) {
    return NextResponse.json({ error: "invalid_sha" }, { status: 400 });
  }

  const token = await getGitHubAccessToken(userId);
  if (!token) {
    return NextResponse.json({ error: "no_token" }, { status: 401 });
  }

  try {
    const result = await loadCommitDetail({ userId, token, owner, name, sha });
    return NextResponse.json(
      { ...result.commit, meta: result.meta },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof GitHubUnauthorizedError) {
      return NextResponse.json({ error: "token_invalid" }, { status: 401 });
    }
    if (error instanceof GitHubRateLimitError) {
      return NextResponse.json(
        { error: "rate_limited", resetAt: error.resetAt?.toISOString() ?? null },
        { status: 429 },
      );
    }
    if (error instanceof GitHubNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (error instanceof GitHubForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (error instanceof GitHubNetworkError) {
      return NextResponse.json({ error: "github_unreachable" }, { status: 503 });
    }
    if (error instanceof GitHubTimeoutError) {
      return NextResponse.json({ error: "github_timeout" }, { status: 504 });
    }
    if (error instanceof GitHubApiError) {
      return NextResponse.json({ error: "github_error" }, { status: 502 });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
