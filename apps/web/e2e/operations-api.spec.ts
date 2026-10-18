import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

// M3 写操作 API 契约层 E2E：timeline.spec.ts 已从 UI 覆盖六个写操作的
// 成功 / 冲突全流程，这里补齐 UI 覆盖不到的服务端契约——
// 认证、入参校验、幂等重放、上游冲突映射。全部走 mock GitHub，断言完全确定。
const API = "/api/repos/encode-utf8/utf8-git/operations/create-branch";
// mock 第 60 号提交（main 尖端）的 oid：oid(n) = n.toString(16).padStart(40, "0")
const FROM_SHA = (100060).toString(16).padStart(40, "0");
// 本文件专用分支名前缀：与 timeline.spec.ts 的 feature/* 等命名互不撞车
// （mock 的已存在引用集合在同一轮 E2E 内跨用例共享）
const BRANCH_PREFIX = "api-contract";
// 每次运行唯一：本地复用 webServer（reuseExistingServer）时，避免上一轮创建的
// 分支 / 幂等记录让本轮首写变成 422 或 200 重放（mock 与内存审计跨轮次存活）
const RUN_NONCE = Date.now().toString(36);

type CreateBranchOutcome = {
  status: string;
  branch: string;
  ref: string;
  sha: string;
  url: string;
};

// 直接打写接口（data 为对象时 Playwright 自动按 JSON 序列化）
function createBranch(api: APIRequestContext, body: unknown, path = API): Promise<APIResponse> {
  return api.post(path, { data: body });
}

test("未登录调用写接口 → 401 unauthorized（先于入参校验）", async ({ request }) => {
  // request 夹具与浏览器上下文隔离，不带 storageState 的会话 Cookie
  const response = await createBranch(request, {
    branch: `${BRANCH_PREFIX}/anon`,
    from: FROM_SHA,
    confirmed: true,
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthorized" });
});

test("入参校验在触达上游前完成 → 400（确认位 / SHA / 分支名 / 仓库名 / 请求体）", async ({
  page,
}) => {
  // 缺 confirmed → confirmation_required（写操作必须显式确认，防误触）
  const unconfirmed = await createBranch(page.request, {
    branch: `${BRANCH_PREFIX}/x`,
    from: FROM_SHA,
  });
  expect(unconfirmed.status()).toBe(400);
  expect(await unconfirmed.json()).toMatchObject({ error: "confirmation_required" });

  // from 不是合法 SHA → invalid_from
  const badSha = await createBranch(page.request, {
    branch: `${BRANCH_PREFIX}/x`,
    from: "not-a-sha",
    confirmed: true,
  });
  expect(badSha.status()).toBe(400);
  expect(await badSha.json()).toMatchObject({ error: "invalid_from" });

  // 分支名含空格 → invalid_branch（validateBranchName 拒绝）
  const badName = await createBranch(page.request, {
    branch: "api contract/x",
    from: FROM_SHA,
    confirmed: true,
  });
  expect(badName.status()).toBe(400);
  const nameBody = (await badName.json()) as { error: string; message?: string };
  expect(nameBody.error).toBe("invalid_branch");
  expect(nameBody.message).toBeTruthy();

  // owner 含非法字符 → invalid_repo（路由段校验）
  const badRepo = await createBranch(
    page.request,
    { branch: `${BRANCH_PREFIX}/x`, from: FROM_SHA, confirmed: true },
    "/api/repos/-bad-/utf8-git/operations/create-branch",
  );
  expect(badRepo.status()).toBe(400);
  expect(await badRepo.json()).toMatchObject({ error: "invalid_repo" });

  // 请求体不是 JSON → invalid_body
  const badBody = await page.request.post(API, { data: "not-json" });
  expect(badBody.status()).toBe(400);
  expect(await badBody.json()).toMatchObject({ error: "invalid_body" });
});

test("成功写操作 → 201；同负载重放 → 200 replayed 且不重复执行；异名 → 新键另一次执行", async ({
  page,
}) => {
  // 分支名带运行 nonce 与重试序号：本地复用服务与 CI 重试都不会撞上已存在引用
  // 或已用过的幂等键，保证首写一定是真实执行（201 而非 200 重放）
  const branch = `${BRANCH_PREFIX}/${RUN_NONCE}-${test.info().retry}`;
  const payload = { branch, from: FROM_SHA, confirmed: true };

  const created = await createBranch(page.request, payload);
  expect(created.status()).toBe(201);
  expect(created.headers()["cache-control"]).toBe("no-store");
  const first = (await created.json()) as CreateBranchOutcome;
  expect(first.status).toBe("succeeded");
  expect(first.branch).toBe(branch);
  expect(first.ref).toBe(`refs/heads/${branch}`);
  expect(first.sha).toBe(FROM_SHA);
  expect(first.url).toMatch(/\/git\/refs\/heads\/api-contract\/[\w-]+$/);

  // 幂等重放：键 = (actor, kind, repo, 排序后负载)。同一负载重放不再次执行——
  // 若真的重跑，mock 会以 422 "Reference already exists" 拒绝，
  // 因此 200 + replayed 本身就是「未重复执行」的证明，且返回值逐字段一致。
  const replayed = await createBranch(page.request, payload);
  expect(replayed.status()).toBe(200);
  const again = (await replayed.json()) as CreateBranchOutcome;
  expect(again.status).toBe("replayed");
  expect({ ...again, status: first.status }).toEqual(first);

  // 键区分度：分支名不同 → 幂等键不同 → 各自走一次真实执行（201 而非重放）
  const other = await createBranch(page.request, {
    branch: `${branch}-other`,
    from: FROM_SHA,
    confirmed: true,
  });
  expect(other.status()).toBe(201);
  const second = (await other.json()) as CreateBranchOutcome;
  expect(second.status).toBe("succeeded");
  expect(second.branch).toBe(`${branch}-other`);
  expect(second.sha).toBe(FROM_SHA);
});

test("上游冲突 → 422 branch_conflict（feature/e2e 为 mock 预置分支）", async ({ page }) => {
  const response = await createBranch(page.request, {
    branch: "feature/e2e",
    from: FROM_SHA,
    confirmed: true,
  });
  expect(response.status()).toBe(422);
  expect(await response.json()).toEqual({ error: "branch_conflict" });
});
