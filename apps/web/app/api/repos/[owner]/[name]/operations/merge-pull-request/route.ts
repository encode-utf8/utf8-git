import { NextResponse } from "next/server";

import { getGitHubAccessToken } from "@/lib/access-token";
import { auth } from "@/lib/auth";
import { getDataStores, invalidateTimelineCache } from "@/lib/data-stores";
import { fetchPullRequest, mergePullRequest } from "@/lib/github-pulls";
import { enforceWriteRateLimit, mapOperationFailure } from "@/lib/operation-http";
import { createIdempotencyKey, getReplayWindowMs, runOperation } from "@/lib/operations";
import {
  createMergePullRequestDescriptor,
  evaluateMergeability,
  isMergeMethod,
  parsePullNumber,
  type MergeMethod,
} from "@/lib/pull-ops";

// 输入约束：只允许安全字符（异常参数不进入上游请求）
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-_.]{0,98})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

const NO_STORE = { "cache-control": "no-store" } as const;

async function authorize(context: { params: Promise<{ owner: string; name: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const { owner, name } = await context.params;
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(name)) {
    return { error: NextResponse.json({ error: "invalid_repo" }, { status: 400 }) };
  }
  const token = await getGitHubAccessToken(userId);
  if (!token) {
    return { error: NextResponse.json({ error: "no_token" }, { status: 401 }) };
  }
  return { userId, owner, name, token };
}

// 可合并性检查：GET /api/repos/{owner}/{name}/operations/merge-pull-request?number=61
// 只读上游状态，不改动任何数据，因此不写审计。
export async function GET(
  request: Request,
  context: { params: Promise<{ owner: string; name: string }> },
) {
  const authorized = await authorize(context);
  if ("error" in authorized) {
    return authorized.error;
  }
  const { owner, name, token } = authorized;

  const number = parsePullNumber(new URL(request.url).searchParams.get("number"));
  if (number === null) {
    return NextResponse.json({ error: "invalid_number" }, { status: 400 });
  }

  try {
    const pull = await fetchPullRequest({ token, owner, name, number });
    const mergeability = evaluateMergeability({
      state: pull.state,
      merged: pull.merged,
      draft: pull.draft,
      mergeable: pull.mergeable,
      mergeableState: pull.mergeableState,
    });
    return NextResponse.json(
      {
        number: pull.number,
        title: pull.title,
        state: pull.state,
        merged: pull.merged,
        draft: pull.draft,
        mergeable: pull.mergeable,
        mergeableState: pull.mergeableState,
        headRef: pull.headRef,
        baseRef: pull.baseRef,
        url: pull.url,
        canMerge: mergeability.canMerge,
        reason: mergeability.reason,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return mapOperationFailure(error, "pull_not_mergeable");
  }
}

// 合并 PR：POST /api/repos/{owner}/{name}/operations/merge-pull-request
// body: { number: number; method?: "merge" | "squash" | "rebase"; confirmed: true }
// 合并前先做一次可合并性检查（冲突 / 草稿 / 已合并直接 409，不进入写管线）。
export async function POST(
  request: Request,
  context: { params: Promise<{ owner: string; name: string }> },
) {
  const authorized = await authorize(context);
  if ("error" in authorized) {
    return authorized.error;
  }
  const { userId, owner, name, token } = authorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const input = (body ?? {}) as { number?: unknown; method?: unknown; confirmed?: unknown };
  if (input.confirmed !== true) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }
  const number = parsePullNumber(input.number);
  if (number === null) {
    return NextResponse.json({ error: "invalid_number" }, { status: 400 });
  }
  if (input.method !== undefined && !isMergeMethod(input.method)) {
    return NextResponse.json({ error: "invalid_method" }, { status: 400 });
  }
  const method: MergeMethod = isMergeMethod(input.method) ? input.method : "merge";

  const limited = await enforceWriteRateLimit(userId);
  if (limited) {
    return limited;
  }

  let pull;
  try {
    pull = await fetchPullRequest({ token, owner, name, number });
  } catch (error) {
    return mapOperationFailure(error, "pull_not_mergeable");
  }
  const mergeability = evaluateMergeability({
    state: pull.state,
    merged: pull.merged,
    draft: pull.draft,
    mergeable: pull.mergeable,
    mergeableState: pull.mergeableState,
  });
  if (!mergeability.canMerge) {
    return NextResponse.json(
      { error: "pull_not_mergeable", message: mergeability.reason },
      { status: 409 },
    );
  }

  const descriptor = createMergePullRequestDescriptor({
    owner,
    name,
    number,
    title: pull.title,
    baseBranch: pull.baseRef ?? "默认分支",
    headBranch: pull.headRef ?? "head 分支",
    method,
  });

  try {
    const outcome = await runOperation({
      descriptor,
      actor: userId,
      idempotencyKey: createIdempotencyKey(descriptor, userId),
      confirmed: true,
      audit: getDataStores().operationAudit,
      replayWindowMs: getReplayWindowMs(),
      execute: () => mergePullRequest({ token, owner, name, number, method }),
    });
    // GitHub 正常合并返回 2xx；merged=false 属语义失败，按不可合并处理
    if (!outcome.value.merged) {
      return NextResponse.json(
        { error: "pull_not_mergeable", message: outcome.value.message ?? "GitHub 未能完成合并。" },
        { status: 409 },
      );
    }
    // 写操作已生效：失效该仓库的时间线缓存，让 router.refresh() 立即拿到新数据
    await invalidateTimelineCache({ userId, owner, name });
    return NextResponse.json(
      {
        status: outcome.status,
        number,
        merged: true,
        sha: outcome.value.sha,
        message: outcome.value.message,
        url: pull.url,
      },
      {
        status: outcome.status === "succeeded" ? 201 : 200,
        headers: NO_STORE,
      },
    );
  } catch (error) {
    return mapOperationFailure(error, "pull_not_mergeable");
  }
}
