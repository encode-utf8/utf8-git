import { NextResponse } from "next/server";

import { getGitHubAccessToken } from "@/lib/access-token";
import { auth } from "@/lib/auth";
import {
  GitHubApiError,
  GitHubForbiddenError,
  GitHubNetworkError,
  GitHubRateLimitError,
  GitHubTimeoutError,
  GitHubUnauthorizedError,
} from "@/lib/github-repos";
import { loadReposPage } from "@/lib/repos-data";

// 仓库列表分页接口：/api/repos?page=N（服务端持有令牌，响应中不含令牌）
export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await getGitHubAccessToken(userId);
  if (!token) {
    return NextResponse.json({ error: "no_token" }, { status: 401 });
  }

  const pageParam = Number(new URL(request.url).searchParams.get("page") ?? "1");
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  try {
    const result = await loadReposPage({ userId, token, page });
    return NextResponse.json({ ...result.page, meta: result.meta });
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
