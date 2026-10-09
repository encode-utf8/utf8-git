// E2E 专用：本地 GitHub 上游 mock（零外部依赖）。
// Playwright 通过 GITHUB_API_BASE_URL / GITHUB_GRAPHQL_ENDPOINT / GITHUB_TOKEN_ENDPOINT
// 把服务端请求指向本进程，让 page / route 在不访问真实 GitHub 的前提下拿到确定性数据。
//
// 覆盖：GET /healthz（就绪探针）、GET /user/repos（REST，含 x-ratelimit-* 头）、
//       POST /graphql（时间线，两页）、GET /repos/{owner}/{name}/commits/{sha}（提交详情）。

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
      committedDate: "2026-10-07T10:00:00Z",
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
                },
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

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
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
          nodes: [
            { name: "main", target: { oid: head.oid, committedDate: head.committedDate } },
            { name: "feature/e2e", target: { oid: head.oid, committedDate: head.committedDate } },
          ],
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
