#!/usr/bin/env node
// M1-7 性能验证：用「小 / 中 / 大」三个真实仓库量测时间线与仓库列表的关键指标。
//
// 用法（PowerShell 示例）：
//   $env:PERF_COOKIE="authjs.session-token=<令牌>"
//   node scripts/perf-validate.mjs
//
// 环境变量：
//   PERF_BASE_URL   目标实例地址（默认 http://127.0.0.1:3103）
//   PERF_COOKIE     必填；登录态 Cookie（Auth.js 会话令牌），不带则全部返回 401
//   PERF_REPOS      逗号分隔的 `owner/name[:标签]`（默认小 / 中 / 大各一个）
//   PERF_PAGES      每个仓库连续翻页数（默认 3，用于验证跨页无重复与单页请求数）
//   PERF_TIMEOUT_MS 单请求超时（默认 60000）
//   PERF_JSON       原始结果落盘的 JSON 路径（默认 docs/reports/tech-analysis/M1-7-raw.json）
//
// 说明：
// - 时间线接口每页对应 1 次 GitHub GraphQL 请求；本脚本按「页」计数，用于核对「单页 1 次请求」。
// - 首屏可交互时间无法在无浏览器的环境下直接测得，这里用仓库页 HTML 的 TTFB + 传输耗时做近似，
//   真实 Lighthouse 需部署到公网后实测（见 docs/reports/tech-analysis/M1-7-perf-validation.md）。

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

const BASE_URL = process.env.PERF_BASE_URL ?? "http://127.0.0.1:3103";
const COOKIE = process.env.PERF_COOKIE ?? "";
const TIMEOUT_MS = Number(process.env.PERF_TIMEOUT_MS ?? 60000);
const PAGES = Number(process.env.PERF_PAGES ?? 3);
const JSON_OUT = process.env.PERF_JSON ?? "docs/reports/tech-analysis/M1-7-raw.json";

const DEFAULT_REPOS = [
  "encode-utf8/utf8-git:小仓库",
  "encode-utf8/stock-analysis:中仓库",
  "torvalds/linux:大仓库",
];

const repoSpecs = (process.env.PERF_REPOS ?? DEFAULT_REPOS.join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => {
    const [slug, label] = item.split(":");
    const [owner, name] = slug.split("/");
    return { owner, name, label: label ?? slug, slug };
  });

if (!COOKIE) {
  console.error("缺少 PERF_COOKIE：请传入登录态 Cookie（authjs.session-token=...）。");
  process.exit(2);
}

// 单次请求计时：ttfb = 响应头到达耗时，total = 读完响应体耗时
async function timedFetch(path, accept) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { cookie: COOKIE, accept },
      redirect: "manual",
      signal: controller.signal,
    });
    const ttfbMs = performance.now() - started;
    const text = await response.text();
    const totalMs = performance.now() - started;
    return {
      status: response.status,
      ttfbMs: round(ttfbMs),
      totalMs: round(totalMs),
      bytes: Buffer.byteLength(text),
      text,
    };
  } catch (error) {
    return {
      status: 0,
      ttfbMs: round(performance.now() - started),
      totalMs: round(performance.now() - started),
      bytes: 0,
      text: "",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function measureReposList() {
  const first = await timedFetch("/api/repos?page=1", "application/json");
  const second = await timedFetch("/api/repos?page=1", "application/json");
  const firstBody = safeJson(first.text);
  const secondBody = safeJson(second.text);
  return {
    miss: {
      status: first.status,
      totalMs: first.totalMs,
      cached: firstBody?.meta?.cached ?? null,
      count: firstBody?.repos?.length ?? 0,
    },
    hit: {
      status: second.status,
      totalMs: second.totalMs,
      cached: secondBody?.meta?.cached ?? null,
      count: secondBody?.repos?.length ?? 0,
    },
  };
}

async function measureRepo(spec) {
  const result = {
    ...spec,
    pages: [],
    html: null,
    duplicates: 0,
    uniqueCommits: 0,
    apiRequests: 0,
  };

  const html = await timedFetch(`/repos/${spec.owner}/${spec.name}`, "text/html");
  result.html = {
    status: html.status,
    ttfbMs: html.ttfbMs,
    totalMs: html.totalMs,
    bytes: html.bytes,
  };

  const seen = new Set();
  let duplicates = 0;
  for (let page = 1; page <= PAGES; page += 1) {
    const response = await timedFetch(
      `/api/repos/${spec.owner}/${spec.name}/timeline?page=${page}`,
      "application/json",
    );
    const body = safeJson(response.text);
    const commits = Array.isArray(body?.commits) ? body.commits : [];
    for (const commit of commits) {
      const sha = commit?.sha ?? commit?.oid ?? JSON.stringify(commit);
      if (seen.has(sha)) duplicates += 1;
      seen.add(sha);
    }
    // 时间线接口每页 = 1 次上游请求（page>1 复用服务端 cursor 链）
    if (response.status === 200) result.apiRequests += 1;
    result.pages.push({
      page,
      status: response.status,
      ttfbMs: response.ttfbMs,
      totalMs: response.totalMs,
      commits: commits.length,
      cached: body?.meta?.cached ?? null,
      error: body?.error ?? null,
    });
  }
  result.duplicates = duplicates;
  result.uniqueCommits = seen.size;
  const pageTtfb = result.pages.filter((p) => p.status === 200).map((p) => p.ttfbMs);
  result.pageTtfbAvg = round(pageTtfb.reduce((sum, v) => sum + v, 0) / (pageTtfb.length || 1));
  result.pageTtfbP95 = percentile(pageTtfb, 95);
  return result;
}

function toMarkdown(repoResults, reposList) {
  const lines = [];
  lines.push(`# M1-7 性能验证原始结果`);
  lines.push("");
  lines.push(`- 目标实例：\`${BASE_URL}\``);
  lines.push(`- 采样时间：${new Date().toISOString()}`);
  lines.push(`- 每仓库翻页数：${PAGES}`);
  lines.push("");
  lines.push("## 仓库列表接口（/api/repos?page=1）");
  lines.push("");
  lines.push("| 场景 | HTTP | cached | 仓库数 | 耗时(ms) |");
  lines.push("| --- | --- | --- | --- | --- |");
  lines.push(
    `| 首次（回源） | ${reposList.miss.status} | ${reposList.miss.cached} | ${reposList.miss.count} | ${reposList.miss.totalMs} |`,
  );
  lines.push(
    `| 再次（缓存） | ${reposList.hit.status} | ${reposList.hit.cached} | ${reposList.hit.count} | ${reposList.hit.totalMs} |`,
  );
  lines.push("");
  lines.push("## 单仓库时间线");
  lines.push("");
  lines.push(
    "| 仓库 | 规模 | 页面HTML TTFB(ms) | 页面HTML 总耗时(ms) | 翻页数 | 接口请求数 | 提交数(去重) | 跨页重复 | 平均页TTFB(ms) | P95页TTFB(ms) |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const repo of repoResults) {
    lines.push(
      `| ${repo.slug} | ${repo.label} | ${repo.html.ttfbMs} | ${repo.html.totalMs} | ${repo.pages.length} | ${repo.apiRequests} | ${repo.uniqueCommits} | ${repo.duplicates} | ${repo.pageTtfbAvg} | ${repo.pageTtfbP95} |`,
    );
  }
  lines.push("");
  lines.push("### 逐页明细");
  lines.push("");
  lines.push("| 仓库 | 页码 | HTTP | commits | cached | TTFB(ms) | 总耗时(ms) |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const repo of repoResults) {
    for (const page of repo.pages) {
      lines.push(
        `| ${repo.slug} | ${page.page} | ${page.status}${page.error ? ` (${page.error})` : ""} | ${page.commits} | ${page.cached} | ${page.ttfbMs} | ${page.totalMs} |`,
      );
    }
  }
  return lines.join("\n");
}

const reposList = await measureReposList();
const repoResults = [];
for (const spec of repoSpecs) {
  process.stdout.write(`测量中：${spec.slug}（${spec.label}）…\n`);
  repoResults.push(await measureRepo(spec));
}

const report = {
  baseUrl: BASE_URL,
  measuredAt: new Date().toISOString(),
  pages: PAGES,
  reposList,
  repos: repoResults,
};
mkdirSync(dirname(JSON_OUT), { recursive: true });
writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log("");
console.log(toMarkdown(repoResults, reposList));
console.log("");
console.log(`原始结果已写入：${JSON_OUT}`);
