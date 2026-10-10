// E2E 专用：本地 GitHub 上游 mock（零外部依赖）。
// Playwright 通过 GITHUB_API_BASE_URL / GITHUB_GRAPHQL_ENDPOINT / GITHUB_TOKEN_ENDPOINT
// 把服务端请求指向本进程，让 page / route 在不访问真实 GitHub 的前提下拿到确定性数据。
//
// 覆盖：GET /healthz（就绪探针）、GET /user/repos（REST，含 x-ratelimit-* 头）、
//       POST /graphql（时间线，两页）、GET /repos/{owner}/{name}/commits/{sha}（提交详情）、
//       POST /repos/{owner}/{name}/git/refs（创建分支；已存在的分支返回 422）。
//       POST /repos/{owner}/{name}/issues（创建 Issue；标题含「已存在」返回 422）
//       POST /repos/{owner}/{name}/pulls（创建 PR；标题含「已存在」或 head=base 返回 422）
//       GET /repos/{owner}/{name}/pulls/{number}（PR 详情：可合并 / 冲突 / 已合并）、
//       PUT /repos/{owner}/{name}/pulls/{number}/merge（合并 PR；非法 merge_method 返回 422）。
//       GET /repos/{owner}/{name}（默认分支）、GET .../branches/{branch}（保护状态，main 视为受保护）、
//       DELETE .../git/refs/heads/{branch}（删除分支；main 返回 422，未知名返回 404）。

import { createServer } from "node:http";

const PORT = Number(process.env.E2E_MOCK_PORT ?? 3211);
const RESET_AT = Math.floor(Date.now() / 1000) + 3600;

// 40 位十六进制 oid（与真实 Git oid 同形，便于展示与断言）
function oid(n) {
  return n.toString(16).padStart(40, "0");
}

// 两个仓库：一公开一私有，覆盖列表渲染与可见性标识
const REPOS = [
  {
    id: 1001,
    name: "utf8-git",
    full_name: "encode-utf8/utf8-git",
    owner: { login: "encode-utf8" },
    description: "GitHub 可视化时间线",
    private: false,
    fork: false,
    archived: false,
    default_branch: "main",
    language: "TypeScript",
    stargazers_count: 12,
    updated_at: "2026-10-07T10:00:00Z",
    html_url: "https://github.com/encode-utf8/utf8-git",
  },
  {
    id: 1002,
    name: "secret-notes",
    full_name: "encode-utf8/secret-notes",
    owner: { login: "encode-utf8" },
    description: "私有笔记",
    private: true,
    fork: false,
    archived: false,
    default_branch: "main",
    language: null,
    stargazers_count: 0,
    updated_at: "2026-10-06T09:00:00Z",
    html_url: "https://github.com/encode-utf8/secret-notes",
  },
];

// 生成从 startNumber 递减、共 count 条的提交（最新在前）
function makeCommits(count, startNumber, headlinePrefix) {
  const commits = [];
  for (let index = 0; index < count; index += 1) {
    const number = startNumber - index;
    const parentNumber = number > 1 ? number - 1 : null;
    commits.push({
      oid: oid(100000 + number),
      messageHeadline: `${headlinePrefix} #${number}`,
      // 相对 now 递增的提交时间（每条相差 3 天，含 0.5 天偏移），避免踩到整周 / 整月边界导致时间范围测试抖动
      committedDate: new Date(Date.now() - ((60 - number) * 3 + 0.5) * 86400000).toISOString(),
      author: { name: "E2E Bot", user: { login: "e2e-bot", avatarUrl: null } },
      parents: { nodes: parentNumber === null ? [] : [{ oid: oid(100000 + parentNumber) }] },
      associatedPullRequests: {
        nodes:
          number % 10 === 0
            ? [
                {
                  number,
                  title: `PR #${number}`,
                  state: "MERGED",
                  mergedAt: "2026-10-07T11:00:00Z",
                  url: `https://github.com/encode-utf8/utf8-git/pull/${number}`,
                  closingIssuesReferences: {
                    nodes: [
                      {
                        number: number + 1000,
                        title: `Issue #${number + 1000}`,
                        state: "CLOSED",
                        url: `https://github.com/encode-utf8/utf8-git/issues/${number + 1000}`,
                      },
                    ],
                  },
                },
                ...(number === 60
                  ? [
                      {
                        number: 61,
                        title: "feat: 待合并的分支",
                        state: "OPEN",
                        mergedAt: null,
                        url: `https://github.com/encode-utf8/utf8-git/pull/61`,
                        closingIssuesReferences: { nodes: [] },
                      },
                      {
                        number: 62,
                        title: "feat: 有冲突的改动",
                        state: "OPEN",
                        mergedAt: null,
                        url: `https://github.com/encode-utf8/utf8-git/pull/62`,
                        closingIssuesReferences: { nodes: [] },
                      },
                    ]
                  : []),
              ]
            : [],
      },
    });
  }
  return commits;
}

// 第 1 页 50 条（#60..#11，hasNextPage=true），第 2 页 10 条（#10..#1，hasNextPage=false）
const PAGE_1 = makeCommits(50, 60, "feat: 时间线提交");
const PAGE_2 = makeCommits(10, 10, "feat: 历史提交");

// 写操作 mock：已存在的分支引用，重复创建返回 422；删除分支会从中移除
const EXISTING_REFS = new Set([
  "refs/heads/main",
  "refs/heads/feature/e2e",
  "refs/heads/junk/delete-me",
]);

// 分支列表（时间线选择器）：直接由 EXISTING_REFS 派生，创建 / 删除 / 恢复分支后刷新页面即同步
function branchNames() {
  return [...EXISTING_REFS].map((ref) => ref.replace(/^refs\/heads\//, ""));
}

// 创建 Issue 的递增编号（成功创建时自增，保证每次返回不同编号）
let issueNumber = 100;

// 创建 PR 的递增编号（成功创建时自增，保证每次返回不同编号）
let createdPullNumber = 100;

function createRefResult(owner, name, body) {
  const ref = typeof body.ref === "string" ? body.ref : "";
  const sha = typeof body.sha === "string" ? body.sha : "";
  if (!ref.startsWith("refs/heads/") || !sha) {
    return { status: 422, body: { message: "Invalid request" } };
  }
  if (EXISTING_REFS.has(ref)) {
    return { status: 422, body: { message: "Reference already exists" } };
  }
  EXISTING_REFS.add(ref);
  return {
    status: 201,
    body: { ref, object: { sha }, url: `https://api.github.com/repos/${owner}/${name}/git/${ref}` },
  };
}

// 写操作 mock：创建 Issue（标题含「已存在」时返回 422，作为 E2E 错误分支的确定性触发条件）
function createIssueResult(owner, name, body) {
  const title = typeof body.title === "string" ? body.title : "";
  if (title.trim() === "" || title.includes("已存在")) {
    return { status: 422, body: { message: "Validation Failed" } };
  }
  issueNumber += 1;
  return {
    status: 201,
    body: {
      number: issueNumber,
      title,
      state: "open",
      html_url: `https://github.com/${owner}/${name}/issues/${issueNumber}`,
    },
  };
}

// 写操作 mock：创建 PR（标题含「已存在」或 head=base 时返回 422）
function createPullRequestResult(owner, name, body) {
  const title = typeof body.title === "string" ? body.title : "";
  const head = typeof body.head === "string" ? body.head : "";
  const base = typeof body.base === "string" ? body.base : "";
  if (
    title.trim() === "" ||
    head === "" ||
    base === "" ||
    head === base ||
    title.includes("已存在")
  ) {
    return { status: 422, body: { message: "Validation Failed" } };
  }
  createdPullNumber += 1;
  return {
    status: 201,
    body: {
      number: createdPullNumber,
      title,
      state: "open",
      draft: body.draft === true,
      html_url: `https://github.com/${owner}/${name}/pull/${createdPullNumber}`,
      head: { ref: head },
      base: { ref: base },
    },
  };
}

// PR 详情：61 可合并、62 有冲突、其余视为已合并（用于合并前的可合并性检查）
function pullRequestResult(owner, name, number) {
  if (number === 61) {
    return {
      number: 61,
      title: "feat: 待合并的分支",
      state: "open",
      merged: false,
      draft: false,
      mergeable: true,
      mergeable_state: "clean",
      head: { ref: "feature/e2e-created" },
      base: { ref: "main" },
      html_url: `https://github.com/${owner}/${name}/pull/61`,
    };
  }
  if (number === 62) {
    return {
      number: 62,
      title: "feat: 有冲突的改动",
      state: "open",
      merged: false,
      draft: false,
      mergeable: false,
      mergeable_state: "dirty",
      head: { ref: "feature/e2e-created" },
      base: { ref: "main" },
      html_url: `https://github.com/${owner}/${name}/pull/62`,
    };
  }
  return {
    number,
    title: "已合并的改动",
    state: "closed",
    merged: true,
    draft: false,
    mergeable: false,
    mergeable_state: "unknown",
    head: { ref: "feature/done" },
    base: { ref: "main" },
    html_url: `https://github.com/${owner}/${name}/pull/${number}`,
  };
}

// 合并 PR：merge_method 非法（非 merge/squash/rebase）返回 422，否则确定性成功
function mergePullRequestResult(number, body) {
  const method = body.merge_method;
  if (method !== undefined && !["merge", "squash", "rebase"].includes(method)) {
    return { status: 422, body: { message: "Validation Failed" } };
  }
  return {
    status: 200,
    body: {
      merged: true,
      message: "Pull Request successfully merged",
      sha: oid(200000 + number),
    },
  };
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(response, status) {
  response.writeHead(status, {});
  response.end();
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function timelinePayload(variables, secondPage) {
  const commits = secondPage ? PAGE_2 : PAGE_1;
  const head = commits[0];
  return {
    data: {
      repository: {
        nameWithOwner: `${variables.owner}/${variables.name}`,
        description: "E2E mock 仓库",
        isPrivate: false,
        defaultBranchRef: { name: "main" },
        refs: {
          nodes: branchNames().map((name) => ({
            name,
            target: { oid: head.oid, committedDate: head.committedDate },
          })),
        },
        object: {
          history: {
            pageInfo: { hasNextPage: !secondPage, endCursor: secondPage ? null : "cursor-page-1" },
            nodes: commits,
          },
        },
      },
      rateLimit: {
        limit: 5000,
        cost: 1,
        remaining: secondPage ? 4997 : 4998,
        resetAt: new Date(RESET_AT * 1000).toISOString(),
      },
    },
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/healthz") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/user/repos") {
    sendJson(response, 200, REPOS, {
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": String(RESET_AT),
    });
    return;
  }

  if (url.pathname === "/graphql" && request.method === "POST") {
    const body = await readJsonBody(request);
    const variables = body.variables ?? {};
    sendJson(response, 200, timelinePayload(variables, Boolean(variables.cursor)));
    return;
  }

  const issueMatch = /^\/repos\/([^/]+)\/([^/]+)\/issues$/.exec(url.pathname);
  if (issueMatch && request.method === "POST") {
    const [, owner, name] = issueMatch;
    const body = await readJsonBody(request);
    const result = createIssueResult(owner, name, body);
    sendJson(response, result.status, result.body, { "x-ratelimit-remaining": "4995" });
    return;
  }

  const createPullMatch = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/.exec(url.pathname);
  if (createPullMatch && request.method === "POST") {
    const [, owner, name] = createPullMatch;
    const body = await readJsonBody(request);
    const result = createPullRequestResult(owner, name, body);
    sendJson(response, result.status, result.body, { "x-ratelimit-remaining": "4992" });
    return;
  }

  const refMatch = /^\/repos\/([^/]+)\/([^/]+)\/git\/refs$/.exec(url.pathname);
  if (refMatch && request.method === "POST") {
    const [, owner, name] = refMatch;
    const body = await readJsonBody(request);
    const result = createRefResult(owner, name, body);
    sendJson(response, result.status, result.body, { "x-ratelimit-remaining": "4996" });
    return;
  }

  const mergeMatch = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge$/.exec(url.pathname);
  if (mergeMatch && request.method === "PUT") {
    const body = await readJsonBody(request);
    const result = mergePullRequestResult(Number(mergeMatch[3]), body);
    sendJson(response, result.status, result.body, { "x-ratelimit-remaining": "4993" });
    return;
  }

  const pullMatch = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/.exec(url.pathname);
  if (pullMatch && request.method === "GET") {
    const [, owner, name, number] = pullMatch;
    sendJson(response, 200, pullRequestResult(owner, name, Number(number)), {
      "x-ratelimit-remaining": "4994",
    });
    return;
  }

  const deleteRefMatch = /^\/repos\/([^/]+)\/([^/]+)\/git\/refs\/heads\/(.+)$/.exec(url.pathname);
  if (deleteRefMatch && request.method === "DELETE") {
    const branch = decodeURIComponent(deleteRefMatch[3]);
    const ref = `refs/heads/${branch}`;
    if (!EXISTING_REFS.has(ref)) {
      sendJson(response, 404, { message: "Reference does not exist" });
      return;
    }
    if (branch === "main") {
      sendJson(response, 422, { message: "Protected branch cannot be deleted" });
      return;
    }
    EXISTING_REFS.delete(ref);
    sendEmpty(response, 204);
    return;
  }

  const branchMatch = /^\/repos\/([^/]+)\/([^/]+)\/branches\/(.+)$/.exec(url.pathname);
  if (branchMatch && request.method === "GET") {
    const branch = decodeURIComponent(branchMatch[3]);
    if (!EXISTING_REFS.has(`refs/heads/${branch}`)) {
      sendJson(response, 404, { message: "Branch not found" });
      return;
    }
    sendJson(
      response,
      200,
      { name: branch, protected: branch === "main", commit: { sha: oid(100060) } },
      { "x-ratelimit-remaining": "4991" },
    );
    return;
  }

  const repoMatch = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (repoMatch && request.method === "GET") {
    const [, owner, name] = repoMatch;
    sendJson(
      response,
      200,
      { name, full_name: `${owner}/${name}`, default_branch: "main", private: false },
      { "x-ratelimit-remaining": "4990" },
    );
    return;
  }

  const commitMatch = /^\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)$/.exec(url.pathname);
  if (commitMatch) {
    const [, owner, name, sha] = commitMatch;
    sendJson(
      response,
      200,
      {
        sha,
        commit: {
          message: "feat: E2E 提交详情\n\n正文内容",
          author: { name: "E2E Bot", date: "2026-10-07T10:00:00Z" },
          committer: { date: "2026-10-07T10:00:00Z" },
        },
        author: { login: "e2e-bot", avatar_url: null },
        stats: { additions: 3, deletions: 1, total: 4 },
        files: [
          { filename: "src/index.ts", status: "modified", additions: 3, deletions: 1, changes: 4 },
        ],
        parents: [{ sha: oid(1) }],
        html_url: `https://github.com/${owner}/${name}/commit/${sha}`,
      },
      { "x-ratelimit-remaining": "4997" },
    );
    return;
  }

  sendJson(response, 404, { message: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[e2e-mock-github] listening on http://127.0.0.1:${PORT}`);
});
