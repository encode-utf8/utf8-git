import { describe, expect, it } from "vitest";

import {
  resolveGithubApiBase,
  resolveGithubAuthorizeUrl,
  resolveGithubGraphqlEndpoint,
  resolveGithubTokenEndpoint,
} from "./github-endpoints";

describe("github 端点解析", () => {
  it("未开启 E2E 模式时一律指向真实 GitHub，即使存在同名环境变量", () => {
    const env = {
      GITHUB_API_BASE_URL: "http://127.0.0.1:9999",
      GITHUB_TOKEN_URL: "http://127.0.0.1:9999/token",
      GITHUB_AUTHORIZE_URL: "http://127.0.0.1:9999/authorize",
    };
    expect(resolveGithubApiBase(env)).toBe("https://api.github.com");
    expect(resolveGithubTokenEndpoint(env)).toBe("https://github.com/login/oauth/access_token");
    expect(resolveGithubAuthorizeUrl(env)).toBe("https://github.com/login/oauth/authorize");
    expect(resolveGithubGraphqlEndpoint(env)).toBe("https://api.github.com/graphql");
  });

  it("E2E 模式下按环境变量改道，GraphQL 端点跟随 API 基址", () => {
    const env = {
      E2E_MODE: "1",
      GITHUB_API_BASE_URL: "http://127.0.0.1:8787/",
      GITHUB_TOKEN_URL: "http://127.0.0.1:8787/login/oauth/access_token",
      GITHUB_AUTHORIZE_URL: "http://127.0.0.1:8787/login/oauth/authorize",
    };
    expect(resolveGithubApiBase(env)).toBe("http://127.0.0.1:8787");
    expect(resolveGithubGraphqlEndpoint(env)).toBe("http://127.0.0.1:8787/graphql");
    expect(resolveGithubTokenEndpoint(env)).toBe("http://127.0.0.1:8787/login/oauth/access_token");
    expect(resolveGithubAuthorizeUrl(env)).toBe("http://127.0.0.1:8787/login/oauth/authorize");
  });

  it("E2E 模式下缺省变量仍回退真实 GitHub", () => {
    expect(resolveGithubApiBase({ E2E_MODE: "1" })).toBe("https://api.github.com");
  });
});
