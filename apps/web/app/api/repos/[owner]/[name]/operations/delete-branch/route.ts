import { NextResponse } from "next/server";

import { getGitHubAccessToken } from "@/lib/access-token";
import { auth } from "@/lib/auth";
import { validateBranchName } from "@/lib/branch-ops";
import { createDeleteBranchDescriptor, evaluateBranchDeletion } from "@/lib/branch-delete-ops";
import { getDataStores, invalidateTimelineCache } from "@/lib/data-stores";
import { fetchBranchDeletionContext } from "@/lib/github-branch-settings";
import { deleteBranchRef } from "@/lib/github-branches";
import { mapOperationFailure } from "@/lib/operation-http";
import { createIdempotencyKey, runOperation } from "@/lib/operations";

// 输入约束：只允许安全字符（异常参数不进入上游请求）
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-_.]{0,98})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

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

// 可删除性预检：GET /api/repos/{owner}/{name}/operations/delete-branch?branch=x&current=main
// 只读上游状态（默认分支 + 保护规则），不改动任何数据，因此不写审计。
export async function GET(
  request: Request,
  context: { params: Promise<{ owner: string; name: string }> },
) {
  const authorized = await authorize(context);
  if ("error" in authorized) {
    return authorized.error;
  }
  const { owner, name, token } = authorized;

  const search = new URL(request.url).searchParams;
  const branch = (search.get("branch") ?? "").trim();
  const currentRaw = (search.get("current") ?? "").trim();
  const nameError = validateBranchName(branch);
  if (nameError) {
    return NextResponse.json({ error: "invalid_branch", message: nameError }, { status: 400 });
  }

  try {
    const settings = await fetchBranchDeletionContext({ token, owner, name, branch });
    if (!settings.exists) {
      return NextResponse.json(
        {
          branch,
          defaultBranch: settings.defaultBranch,
          protected: false,
          canDelete: false,
          reason: "分支不存在或无权访问。",
        },
        { headers: NO_STORE },
      );
    }
    const verdict = evaluateBranchDeletion({
      branch,
      defaultBranch: settings.defaultBranch,
      protectedBranch: settings.protectedBranch,
      currentBranch: currentRaw || null,
    });
    return NextResponse.json(
      {
        branch,
        defaultBranch: settings.defaultBranch,
        protected: settings.protectedBranch,
        canDelete: verdict.canDelete,
        reason: verdict.reason,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return mapOperationFailure(error, "branch_conflict");
  }
}

// 删除分支：POST /api/repos/{owner}/{name}/operations/delete-branch
// body: { branch: string; current?: string; sha?: string; confirmed: true }
// 服务端复查默认分支 / 保护规则（不可删除 → 409，不进入写管线），再走统一写管线。
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
  const input = (body ?? {}) as {
    branch?: unknown;
    current?: unknown;
    sha?: unknown;
    confirmed?: unknown;
  };
  if (input.confirmed !== true) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }
  const branch = typeof input.branch === "string" ? input.branch.trim() : "";
  const nameError = validateBranchName(branch);
  if (nameError) {
    return NextResponse.json({ error: "invalid_branch", message: nameError }, { status: 400 });
  }
  const current =
    typeof input.current === "string" && input.current.trim() ? input.current.trim() : null;
  const headSha = typeof input.sha === "string" && SHA_PATTERN.test(input.sha) ? input.sha : null;

  let settings;
  try {
    settings = await fetchBranchDeletionContext({ token, owner, name, branch });
  } catch (error) {
    return mapOperationFailure(error, "branch_conflict");
  }
  if (!settings.exists) {
    return NextResponse.json(
      { error: "branch_not_deletable", message: "分支不存在或无权访问。" },
      { status: 409 },
    );
  }
  const verdict = evaluateBranchDeletion({
    branch,
    defaultBranch: settings.defaultBranch,
    protectedBranch: settings.protectedBranch,
    currentBranch: current,
  });
  if (!verdict.canDelete) {
    return NextResponse.json(
      { error: "branch_not_deletable", message: verdict.reason },
      { status: 409 },
    );
  }

  const descriptor = createDeleteBranchDescriptor({ owner, name, branch, headSha });

  try {
    const outcome = await runOperation({
      descriptor,
      actor: userId,
      idempotencyKey: createIdempotencyKey(descriptor, userId),
      confirmed: true,
      audit: getDataStores().operationAudit,
      execute: () => deleteBranchRef({ token, owner, name, branch }),
    });
    // 写操作已生效：失效该仓库的时间线缓存，让 router.refresh() 立即拿到新数据
    await invalidateTimelineCache({ userId, owner, name });
    return NextResponse.json(
      { status: outcome.status, branch: outcome.value.branch },
      {
        status: outcome.status === "succeeded" ? 201 : 200,
        headers: NO_STORE,
      },
    );
  } catch (error) {
    return mapOperationFailure(error, "branch_conflict");
  }
}
