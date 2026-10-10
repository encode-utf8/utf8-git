import { NextResponse } from "next/server";

import { clearAuthorizationData } from "@/lib/account-data";
import { createRevokeAuthorizationDescriptor } from "@/lib/account-ops";
import { getGitHubAccessToken } from "@/lib/access-token";
import { auth } from "@/lib/auth";
import { getDataStores } from "@/lib/data-stores";
import { revokeGitHubAuthorization } from "@/lib/github-app-authorization";
import { enforceWriteRateLimit, mapOperationFailure } from "@/lib/operation-http";
import { createIdempotencyKey, runOperation } from "@/lib/operations";

// 撤销 GitHub 授权：POST /api/account/revoke
// body: { confirmed: true }
// 走统一写管线（确认 + 审计 + 频率限制）：先让 GitHub 撤销令牌，再清掉本地令牌 / 会话 / 缓存。
export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if ((body as { confirmed?: unknown } | null)?.confirmed !== true) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }

  const limited = await enforceWriteRateLimit(userId);
  if (limited) {
    return limited;
  }

  const clientId = process.env.AUTH_GITHUB_ID ?? null;
  const clientSecret = process.env.AUTH_GITHUB_SECRET ?? null;
  const token = await getGitHubAccessToken(userId);
  if (!token) {
    return NextResponse.json({ error: "no_token" }, { status: 401 });
  }
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "revoke_unavailable" }, { status: 503 });
  }

  const descriptor = createRevokeAuthorizationDescriptor();

  try {
    const outcome = await runOperation({
      descriptor,
      actor: userId,
      idempotencyKey: createIdempotencyKey(descriptor, userId),
      confirmed: true,
      audit: getDataStores().operationAudit,
      // 账号级破坏性操作每次都真正执行（本身幂等），不做幂等回放
      replayWindowMs: 0,
      execute: async () => {
        const revoked = await revokeGitHubAuthorization({
          clientId,
          clientSecret,
          accessToken: token,
        });
        await clearAuthorizationData(userId);
        return { revoked: revoked.revoked, alreadyInvalid: revoked.alreadyInvalid };
      },
    });
    return NextResponse.json(
      { status: outcome.status, ...outcome.value },
      {
        status: outcome.status === "succeeded" ? 201 : 200,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return mapOperationFailure(error, "revoke_failed");
  }
}
