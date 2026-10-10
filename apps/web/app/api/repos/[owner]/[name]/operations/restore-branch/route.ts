import { NextResponse } from "next/server";

import { getGitHubAccessToken } from "@/lib/access-token";
import { auth } from "@/lib/auth";
import {
  RESTORE_WINDOW_MS,
  createRestoreBranchDescriptor,
  evaluateBranchRestore,
  restoreDeadline,
} from "@/lib/branch-restore-ops";
import { getDataStores, invalidateTimelineCache } from "@/lib/data-stores";
import { createBranchRef } from "@/lib/github-branches";
import { enforceWriteRateLimit, mapOperationFailure } from "@/lib/operation-http";
import {
  createIdempotencyKey,
  getReplayWindowMs,
  repositorySlug,
  runOperation,
} from "@/lib/operations";

// 输入约束：只允许安全字符（异常参数不进入上游请求）
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-_.]{0,98})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const CANDIDATE_LIMIT = 50;

const NO_STORE = { "cache-control": "no-store" } as const;

// 删除分支审计记录的 payload：{ branch, sha? }
function readDeletePayload(payload: Record<string, string>): {
  branch: string | null;
  sha: string | null;
} {
  const branch = typeof payload.branch === "string" && payload.branch ? payload.branch : null;
  const sha = typeof payload.sha === "string" && payload.sha ? payload.sha : null;
  return { branch, sha };
}

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

// 可恢复列表：GET /api/repos/{owner}/{name}/operations/restore-branch
// 数据来自本应用自己的写操作审计（仅当前用户、成功的删除分支、且仍在 24h 窗口内），
// 不访问上游，因此不写审计。
export async function GET(
  _request: Request,
  context: { params: Promise<{ owner: string; name: string }> },
) {
  const authorized = await authorize(context);
  if ("error" in authorized) {
    return authorized.error;
  }
  const { userId, owner, name } = authorized;
  const now = Date.now();

  const records = await getDataStores().operationAudit.list({
    repo: repositorySlug({ owner, name }),
    actor: userId,
    kind: "deleteBranch",
    status: "succeeded",
    limit: CANDIDATE_LIMIT,
  });

  const candidates = records.flatMap((record) => {
    const { branch, sha } = readDeletePayload(record.payload);
    const deletedAt = new Date(record.recordedAt).getTime();
    if (!branch || !sha || !Number.isFinite(deletedAt) || now - deletedAt > RESTORE_WINDOW_MS) {
      return [];
    }
    return [
      {
        idempotencyKey: record.idempotencyKey,
        branch,
        sha,
        recordedAt: record.recordedAt,
        expiresAt: restoreDeadline(record.recordedAt).toISOString(),
      },
    ];
  });

  return NextResponse.json({ candidates }, { headers: NO_STORE });
}

// 恢复分支：POST /api/repos/{owner}/{name}/operations/restore-branch
// body: { idempotencyKey: string; confirmed: true }
// 以删除记录的幂等键为凭据（服务端校验归属 / 类型 / 状态 / 时间窗），不让客户端直接传 SHA。
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
  const input = (body ?? {}) as { idempotencyKey?: unknown; confirmed?: unknown };
  if (input.confirmed !== true) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }
  const key = typeof input.idempotencyKey === "string" ? input.idempotencyKey : "";
  if (!key) {
    return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  }

  const limited = await enforceWriteRateLimit(userId);
  if (limited) {
    return limited;
  }
  const audit = getDataStores().operationAudit;
  const source = await audit.find(key);
  if (
    !source ||
    source.actor !== userId ||
    source.repo !== repositorySlug({ owner, name }) ||
    source.kind !== "deleteBranch" ||
    source.status !== "succeeded"
  ) {
    return NextResponse.json(
      { error: "restore_not_found", message: "找不到可恢复的删除记录，请刷新后重试。" },
      { status: 404 },
    );
  }

  const { branch, sha } = readDeletePayload(source.payload);
  const verdict = evaluateBranchRestore({
    branch: branch ?? "",
    sha,
    recordedAt: source.recordedAt,
  });
  if (!branch || !sha || !verdict.canRestore) {
    return NextResponse.json(
      { error: "restore_unavailable", message: verdict.reason ?? "该删除记录无法恢复。" },
      { status: 409 },
    );
  }

  const descriptor = createRestoreBranchDescriptor({
    owner,
    name,
    branch,
    sha,
    source: source.idempotencyKey,
  });

  try {
    const outcome = await runOperation({
      descriptor,
      actor: userId,
      idempotencyKey: createIdempotencyKey(descriptor, userId),
      confirmed: true,
      audit,
      replayWindowMs: getReplayWindowMs(),
      execute: () => createBranchRef({ token, owner, name, branch, fromSha: sha }),
    });
    // 写操作已生效：失效该仓库的时间线缓存，让 router.refresh() 立即拿到新数据
    await invalidateTimelineCache({ userId, owner, name });
    return NextResponse.json(
      { status: outcome.status, branch: outcome.value.branch, sha: outcome.value.sha },
      {
        status: outcome.status === "succeeded" ? 201 : 200,
        headers: NO_STORE,
      },
    );
  } catch (error) {
    return mapOperationFailure(error, "branch_conflict");
  }
}
