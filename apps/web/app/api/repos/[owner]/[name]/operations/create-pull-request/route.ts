import { NextResponse } from "next/server";

import { getGitHubAccessToken } from "@/lib/access-token";
import { auth } from "@/lib/auth";
import { getDataStores, invalidateTimelineCache } from "@/lib/data-stores";
import { createPullRequest } from "@/lib/github-pulls";
import { enforceWriteRateLimit, mapOperationFailure } from "@/lib/operation-http";
import { createIdempotencyKey, runOperation } from "@/lib/operations";
import {
  createPullRequestDescriptor,
  validatePullBody,
  validatePullBranches,
  validatePullTitle,
} from "@/lib/pull-ops";

// 输入约束：只允许安全字符（异常参数不进入上游请求）
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-_.]{0,98})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

// 创建 PR：POST /api/repos/{owner}/{name}/operations/create-pull-request
// body: { head: string; base: string; title: string; body?: string; draft?: boolean; confirmed: true }
export async function POST(
  request: Request,
  context: { params: Promise<{ owner: string; name: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { owner, name } = await context.params;
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(name)) {
    return NextResponse.json({ error: "invalid_repo" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const input = (body ?? {}) as {
    head?: unknown;
    base?: unknown;
    title?: unknown;
    body?: unknown;
    draft?: unknown;
    confirmed?: unknown;
  };
  if (input.confirmed !== true) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }

  const head = typeof input.head === "string" ? input.head : "";
  const base = typeof input.base === "string" ? input.base : "";
  const title = typeof input.title === "string" ? input.title : "";
  const pullBody = typeof input.body === "string" ? input.body : "";
  const draft = input.draft === true;

  const titleError = validatePullTitle(title);
  if (titleError) {
    return NextResponse.json({ error: "invalid_pull", message: titleError }, { status: 400 });
  }
  const branchError = validatePullBranches({ head, base });
  if (branchError) {
    return NextResponse.json({ error: "invalid_pull", message: branchError }, { status: 400 });
  }
  const bodyError = validatePullBody(pullBody);
  if (bodyError) {
    return NextResponse.json({ error: "invalid_pull", message: bodyError }, { status: 400 });
  }

  const limited = await enforceWriteRateLimit(userId);
  if (limited) {
    return limited;
  }
  const token = await getGitHubAccessToken(userId);
  if (!token) {
    return NextResponse.json({ error: "no_token" }, { status: 401 });
  }

  const descriptor = createPullRequestDescriptor({
    owner,
    name,
    head,
    base,
    title,
    body: pullBody,
    draft,
  });

  try {
    const outcome = await runOperation({
      descriptor,
      actor: userId,
      idempotencyKey: createIdempotencyKey(descriptor, userId),
      confirmed: true,
      audit: getDataStores().operationAudit,
      execute: () =>
        createPullRequest({
          token,
          owner,
          name,
          head: descriptor.payload.head,
          base: descriptor.payload.base,
          title: descriptor.payload.title,
          body: pullBody,
          draft,
        }),
    });
    // 写操作已生效：失效该仓库的时间线缓存，让 router.refresh() 立即拿到新数据
    await invalidateTimelineCache({ userId, owner, name });
    return NextResponse.json(
      {
        status: outcome.status,
        number: outcome.value.number,
        title: outcome.value.title,
        state: outcome.value.state,
        draft: outcome.value.draft,
        url: outcome.value.url,
      },
      {
        status: outcome.status === "succeeded" ? 201 : 200,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return mapOperationFailure(error, "pull_invalid");
  }
}
