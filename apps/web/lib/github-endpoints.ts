// GitHub 端点解析：默认一律指向真实 GitHub。
//
// 仅当 E2E_MODE=1 时才允许用环境变量覆写，目的是让 Playwright E2E 能把
// 授权 / 令牌 / REST / GraphQL 都指向本地 mock（见 e2e/mock-github.mjs）。
// 这样生产环境即使误留同名变量也不会被改道——把令牌请求导向其它主机是严重的配置风险。

const REAL_API_BASE = "https://api.github.com";
const REAL_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const REAL_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

type Env = Record<string, string | undefined>;

function overrideE2e(env: Env, name: string, fallback: string): string {
  if (env.E2E_MODE !== "1") {
    return fallback;
  }
  const value = env[name]?.trim();
  return value ? value.replace(/\/+$/, "") : fallback;
}

export function resolveGithubApiBase(env: Env = process.env): string {
  return overrideE2e(env, "GITHUB_API_BASE_URL", REAL_API_BASE);
}

export function resolveGithubGraphqlEndpoint(env: Env = process.env): string {
  return `${resolveGithubApiBase(env)}/graphql`;
}

export function resolveGithubTokenEndpoint(env: Env = process.env): string {
  return overrideE2e(env, "GITHUB_TOKEN_URL", REAL_TOKEN_ENDPOINT);
}

export function resolveGithubAuthorizeUrl(env: Env = process.env): string {
  return overrideE2e(env, "GITHUB_AUTHORIZE_URL", REAL_AUTHORIZE_URL);
}
