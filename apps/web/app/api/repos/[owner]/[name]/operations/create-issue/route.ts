import { NextResponse } from "next/server";

import { getGitHubAccessToken } from "@/lib/access-token";
import { auth } from "@/lib/auth";
import { getDataStores } from "@/lib/data-stores";
import { createIssue } from "@/lib/github-issues";
import {
  createIssueDescriptor,
  parseIssueLabels,
  validateIssueLabels,
  validateIssueTitle,
} from "@/lib/issue-ops";
import { mapOperationFailure } from "@/lib/operation-http";
import { createIdempotencyKey, runOperation } from "@/lib/operations";

// 输入约束：只允许安全字符（异常参数不进入上游请求）
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-_.]{0,98})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const ISSUE_BODY_MAX_LENGTH = 65536;

// 创建 Issue：POST /api/repos/{owner}/{name}/operations/create-issue
// body: { title: string; body?: string; labels?: string; confirmed: true }
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
    title?: unknown;
    body?: unknown;
    labels?: unknown;
    confirmed?: unknown;
  };
  const title = typeof input.title === "string" ? input.title : "";
  const issueBody = typeof input.body === "string" ? input.body : "";
  const rawLabels = typeof input.labels === "string" ? input.labels : "";
  if (input.confirmed !== true) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }

  const titleError = validateIssueTitle(title);
  if (titleError) {
    return NextResponse.json({ error: "invalid_issue", message: titleError }, { status: 400 });
  }
  if (issueBody.length > ISSUE_BODY_MAX_LENGTH) {
    return NextResponse.json({ error: "invalid_issue", message: "正文过长。" }, { status: 400 });
  }
  const labels = parseIssueLabels(rawLabels);
  const labelsError = validateIssueLabels(labels);
  if (labelsError) {
    return NextResponse.json({ error: "invalid_issue", message: labelsError }, { status: 400 });
  }

  const token = await getGitHubAccessToken(userId);
  if (!token) {
    return NextResponse.json({ error: "no_token" }, { status: 401 });
  }

  const descriptor = createIssueDescriptor({
    owner,
    name,
    title,
    body: issueBody,
    labels,
  });

  try {
    const outcome = await runOperation({
      descriptor,
      actor: userId,
      idempotencyKey: createIdempotencyKey(descriptor, userId),
      confirmed: true,
      audit: getDataStores().operationAudit,
      execute: () =>
        createIssue({
          token,
          owner,
          name,
          title: descriptor.payload.title,
          body: issueBody,
          labels,
        }),
    });
    return NextResponse.json(
      {
        status: outcome.status,
        number: outcome.value.number,
        title: outcome.value.title,
        state: outcome.value.state,
        url: outcome.value.url,
      },
      {
        status: outcome.status === "succeeded" ? 201 : 200,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return mapOperationFailure(error, "issue_invalid");
  }
}
