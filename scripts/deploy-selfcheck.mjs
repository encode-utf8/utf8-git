#!/usr/bin/env node
// 部署自检：对已部署实例做一遍外部可达性与关键配置核对，一条命令回答「能不能用、哪里配错」。
//
// 用法（PowerShell 示例）：
//   node scripts/deploy-selfcheck.mjs                                # 默认校验生产域名
//   node scripts/deploy-selfcheck.mjs --base=http://127.0.0.1:3100   # 校验本地实例
//
// 环境变量：
//   SELFCHECK_BASE_URL    目标地址（等价于 --base）
//   SELFCHECK_TIMEOUT_MS  单请求超时（默认 15000）
//   NODE_USE_ENV_PROXY + HTTPS_PROXY  本机访问 vercel.app 需代理时使用（见 docs/deployment.md §8）
//
// 覆盖范围与边界：
// - 只能验证「服务端实际发出的 redirect_uri 是否等于预期」，**无法**验证该地址是否已在 GitHub OAuth App 登记：
//   GitHub 仅在已登录状态才校验登记值，未登录一律 302 到登录页（M1-6 验收曾在此误判，见验收报告 §4）。
// - 运行期配置（如 STORE_BACKEND）在服务端，通过 /api/health 读取。

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);

const BASE_URL = (
  args.get("base") ??
  process.env.SELFCHECK_BASE_URL ??
  "https://utf8-git.vercel.app"
).replace(/\/+$/, "");
const TIMEOUT_MS = Number(args.get("timeout") ?? process.env.SELFCHECK_TIMEOUT_MS ?? 15000);
const EXPECTED_CALLBACK = `${BASE_URL}/api/auth/callback/github`;
const IS_HTTPS = BASE_URL.startsWith("https://");

let failures = 0;
let warningCount = 0;

function record(name, ok, detail = "") {
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "✔" : "✘"} ${name.padEnd(36)} ${detail}`);
}

async function request(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(BASE_URL + path, { redirect: "manual", signal: controller.signal, ...init });
  } finally {
    clearTimeout(timer);
  }
}

async function checkStatus(name, path, expected) {
  const startedAt = Date.now();
  try {
    const res = await request(path);
    record(
      name,
      res.status === expected,
      `HTTP ${res.status}（期望 ${expected}）· ${Date.now() - startedAt}ms`,
    );
    return res;
  } catch (error) {
    record(name, false, `请求失败：${error.message}`);
    return null;
  }
}

function cookieHeader(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function checkOAuth() {
  try {
    const csrfRes = await request("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    const cookies = cookieHeader(csrfRes);

    // 生产 HTTPS 下 Auth.js 必须下发 __Host- / __Secure- 前缀 Cookie
    const hostPrefixed = /__Host-authjs\.csrf-token/.test(cookies);
    record("csrf Cookie 前缀", IS_HTTPS ? hostPrefixed : true, cookies || "（未下发 Cookie）");

    const res = await request("/api/auth/signin/github", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies },
      body: new URLSearchParams({ csrfToken, callbackUrl: `${BASE_URL}/repos` }),
    });
    const location = res.headers.get("location") ?? "";

    if (res.status !== 302 || !location.includes("/login/oauth/authorize")) {
      record(
        "OAuth 跳转",
        false,
        `HTTP ${res.status} → ${location.slice(0, 100) || "（无 Location）"}`,
      );
      return;
    }

    const url = new URL(location);
    const redirectUri = url.searchParams.get("redirect_uri");
    record("OAuth 跳转", true, "302 → github.com/login/oauth/authorize");
    record(
      "redirect_uri 与部署域名一致",
      redirectUri === EXPECTED_CALLBACK,
      redirectUri ?? "（缺失）",
    );
    record(
      "OAuth scope 覆盖 repo",
      (url.searchParams.get("scope") ?? "").includes("repo"),
      url.searchParams.get("scope") ?? "（缺失）",
    );
  } catch (error) {
    record("OAuth 跳转", false, `请求失败：${error.message}`);
  }
}

async function checkHealth() {
  try {
    const res = await request("/api/health");
    if (res.status === 404) {
      record(
        "部署自检 /api/health",
        false,
        "HTTP 404：该版本尚未包含自检端点，请先部署含 /api/health 的版本",
      );
      return;
    }
    const report = await res.json().catch(() => null);
    record(
      "部署自检 /api/health",
      res.status === 200,
      report ? `storeBackend=${report.storeBackend}` : `HTTP ${res.status}`,
    );
    for (const check of report?.checks ?? []) {
      record(`  ↳ ${check.name}`, check.ok, check.detail ?? "");
    }
    if (report?.functionRegion) {
      console.log(`  · 函数运行区 VERCEL_REGION=${report.functionRegion}`);
    }
    // 告警不是故障：可用但配置不理想（例如函数与数据库跨区），单独提示
    for (const warning of report?.warnings ?? []) {
      warningCount += 1;
      console.log(`  ⚠ ${warning}`);
    }
  } catch (error) {
    record("部署自检 /api/health", false, `请求失败：${error.message}`);
  }
}

async function main() {
  console.log(`部署自检目标：${BASE_URL}\n`);

  console.log("— 外部可达性与鉴权边界 —");
  await checkStatus("GET /", "/", 200);
  await checkStatus("GET /login", "/login", 200);
  await checkStatus("GET /api/repos（未登录）", "/api/repos", 401);
  await checkStatus(
    "GET /api/repos/*/timeline（未登录）",
    "/api/repos/encode-utf8/utf8-git/timeline?page=1",
    401,
  );
  await checkStatus("GET /api/auth/session", "/api/auth/session", 200);

  const providersRes = await checkStatus("GET /api/auth/providers", "/api/auth/providers", 200);
  if (providersRes) {
    const providers = await providersRes.json().catch(() => null);
    const callback = providers?.github?.callbackUrl ?? "";
    record(
      "providers 回调地址与部署域名一致",
      callback === EXPECTED_CALLBACK,
      callback || "（缺失）",
    );
  }

  console.log("\n— OAuth 跳转 —");
  await checkOAuth();

  console.log("\n— 运行期配置与数据库 —");
  await checkHealth();

  console.log("\n— 需人工确认（脚本无法验证）—");
  console.log(
    `  · GitHub OAuth App 的 Authorization callback URL 是否登记为：${EXPECTED_CALLBACK}`,
  );
  console.log("    （GitHub 仅在已登录状态校验登记值，未登录一律 302 到登录页，故脚本无法判定）");
  console.log("  · 浏览器完整登录一次（写会话 + 令牌加密入库 + 拉取仓库列表）");

  const summary = failures === 0 ? "结果：全部通过" : `结果：${failures} 项未通过`;
  console.log(`\n${warningCount > 0 ? `${summary}（另有 ${warningCount} 条告警）` : summary}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("自检异常终止：", error);
  process.exit(2);
});
