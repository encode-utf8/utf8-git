import { NextResponse } from "next/server";

import { purgeAccountData } from "@/lib/account-data";
import { createPurgeAccountDataDescriptor } from "@/lib/account-ops";
import { getGitHubAccessToken } from "@/lib/access-token";
import { auth } from "@/lib/auth";
import { getDataStores } from "@/lib/data-stores";
import { revokeGitHubAuthorization } from "@/lib/github-app-authorization";
import { enforceWriteRateLimit, mapOperationFailure } from "@/lib/operation-http";
import { createIdempotencyKey, runOperation } from "@/lib/operations";

// 清除本应用内的账号数据（GDPR 友好）：POST /api/account/purge
// body: { confirmed: true }
// 先尽力撤销 GitHub 授权（失败不阻塞），再删除审计 / 缓存 / 账号 / 会话 / 用户记录。
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

  const audit = getDataStores().operationAudit;
  const clientId = process.env.AUTH_GITHUB_ID ?? null;
  const clientSecret = process.env.AUTH_GITHUB_SECRET ?? null;
  const token = await getGitHubAccessToken(userId);
  // 影响预览里要说明删掉多少条审计记录，因此先数一次（只读）
  const auditRecords = await audit.count({ actor: userId });
  const descriptor = createPurgeAccountDataDescriptor({ auditRecords });

  try {
    const outcome = await runOperation({
      descriptor,
      actor: userId,
      idempotencyKey: createIdempotencyKey(descriptor, userId),
      confirmed: true,
      audit,
      // 账号级破坏性操作每次都真正执行（本身幂等），不做幂等回放
      replayWindowMs: 0,
      execute: async () => {
        let upstreamRevoked = false;
        if (token && clientId && clientSecret) {
          try {
            const result = await revokeGitHubAuthorization({
              clientId,
              clientSecret,
              accessToken: token,
            });
            upstreamRevoked = result.revoked || result.alreadyInvalid;
          } catch {
            // 上游撤销失败不应阻塞本地清除：令牌会随账号记录一起被删掉
            upstreamRevoked = false;
          }
        }
        const summary = await purgeAccountData(userId);
        return { auditRecords: summary.auditRecords, upstreamRevoked };
      },
    });
    // 清除数据要「零残留」：上面这次调用自身写入的 started / succeeded 审计记录也一并删掉
    await audit.deleteByActor(userId);
    return NextResponse.json(
      { status: outcome.status, ...outcome.value },
      {
        status: outcome.status === "succeeded" ? 201 : 200,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return mapOperationFailure(error, "purge_failed");
  }
}
