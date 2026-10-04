import { describe, expect, it } from "vitest";
import { hasScope, parseScopes } from "./scope";

describe("parseScopes", () => {
  it("解析空格分隔的 scope", () => {
    expect(parseScopes("read:user repo")).toEqual(["read:user", "repo"]);
  });

  it("解析逗号分隔并处理多余空白", () => {
    expect(parseScopes("read:user, repo , user:email")).toEqual([
      "read:user",
      "repo",
      "user:email",
    ]);
  });

  it("对空值返回空数组", () => {
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes("")).toEqual([]);
  });

  it("相同 scope 只保留一次", () => {
    expect(parseScopes("repo repo")).toEqual(["repo"]);
  });
});

describe("hasScope", () => {
  it("识别已授权的 repo scope", () => {
    expect(hasScope("read:user repo", "repo")).toBe(true);
  });

  it("未授权时返回 false", () => {
    expect(hasScope("read:user", "repo")).toBe(false);
    expect(hasScope(null, "repo")).toBe(false);
  });
});
