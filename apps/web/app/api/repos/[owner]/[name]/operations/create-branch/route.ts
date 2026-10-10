import { NextResponse } from "next/server";

import { getGitHubAccessToken } from "@/lib/access-token";
import { auth } from "@/lib/auth";
import { createBranchDescriptor, validateBranchName } from "@/lib/branch-ops";
import { shortSha } from "@/lib/commit-format";
import { getDataStores, invalidateTimelineCache } from "@/lib/data-stores";
import { createBranchRef } from "@/lib/github-branches";
import { createIdempotencyKey, runOperation } from "@/lib/operations";
import { mapOperationFailure } from "@/lib/operation-http";

// 输入约束：只允许安全字符（异常参数不进入上游请求）
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-_.]{0,98})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

// 创建分支：POST /api/repos/{owner}/{name}/operations/create-branch
// body: { branch: string; from: string(sha); confirmed: true }
// 服务端统一走 runOperation（确认 + 幂等 + 审计），幂等键由 (actor, 描述) 派生。
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
  const input = (body ?? {}) as { branch?: unknown; from?: unknown; confirmed?: unknown };
  const branch = typeof input.branch === "string" ? input.branch : "";
  const from = typeof input.from === "string" ? input.from : "";
  if (input.confirmed !== true) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }
  if (!SHA_PATTERN.test(from)) {
    return NextResponse.json({ error: "invalid_from" }, { status: 400 });
  }
  const nameError = validateBranchName(branch);
  if (nameError) {
    return NextResponse.json({ error: "invalid_branch", message: nameError }, { status: 400 });
  }

  const token = await getGitHubAccessToken(userId);
  if (!token) {
    return NextResponse.json({ error: "no_token" }, { status: 401 });
  }

  const descriptor = createBranchDescriptor({
    owner,
    name,
    branch,
    fromSha: from,
    fromLabel: `提交 ${shortSha(from)}`,
  });

  try {
    const outcome = await runOperation({
      descriptor,
      actor: userId,
      idempotencyKey: createIdempotencyKey(descriptor, userId),
      confirmed: true,
      audit: getDataStores().operationAudit,
      execute: () => createBranchRef({ token, owner, name, branch, fromSha: from }),
    });
    // 写操作已生效：失效该仓库的时间线缓存，让 router.refresh() 立即拿到新数据
    await invalidateTimelineCache({ userId, owner, name });
    return NextResponse.json(
      {
        status: outcome.status,
        branch: outcome.value.branch,
        ref: outcome.value.ref,
        sha: outcome.value.sha,
        url: outcome.value.url,
      },
      {
        status: outcome.status === "succeeded" ? 201 : 200,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return mapOperationFailure(error, "branch_conflict");
  }
}
