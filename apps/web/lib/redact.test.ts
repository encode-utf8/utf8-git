import { describe, expect, it } from "vitest";

import { isSensitiveKey, redactConnectionInfo, redactFields, redactText } from "./redact";

const GITHUB_TOKEN = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

describe("redactText", () => {
  it("抹掉连接串与 GitHub 令牌", () => {
    const result = redactText(
      `connect postgresql://u:p@db.example:5432/neondb failed (${GITHUB_TOKEN})`,
    );
    expect(result).not.toContain("u:p@db.example");
    expect(result).not.toContain("ghp_ABCDEF");
    expect(result).toContain("[redacted-url]");
    expect(result).toContain("[redacted]");
  });

  it("普通文本原样保留", () => {
    expect(redactText("hello world")).toBe("hello world");
  });
});

describe("redactConnectionInfo", () => {
  it("连接串替换为固定标记，压成单行并截断", () => {
    const result = redactConnectionInfo("a\npostgres://u:secret@h/db b");
    expect(result).not.toContain("secret");
    expect(result).toContain("postgresql://***");
    expect(result).not.toContain("\n");
  });
});

describe("isSensitiveKey", () => {
  it("识别敏感键，且不误伤业务键", () => {
    expect(isSensitiveKey("AUTH_TOKEN_ENC_KEY")).toBe(true);
    expect(isSensitiveKey("clientSecret")).toBe(true);
    expect(isSensitiveKey("authorization")).toBe(true);
    expect(isSensitiveKey("idempotencyKey")).toBe(false);
    expect(isSensitiveKey("recordedAt")).toBe(false);
  });
});

describe("redactFields", () => {
  it("敏感键整值替换，其余按值特征抹除", () => {
    const fields = redactFields({
      token: GITHUB_TOKEN,
      repo: "owner/name",
      nested: { databaseUrl: "postgresql://u:p@h/db", note: "ok" },
      list: ["bearer abcdefghijklmnop"],
    });
    expect(fields.token).toBe("[redacted]");
    expect(fields.repo).toBe("owner/name");
    expect(fields.nested).toEqual({ databaseUrl: "[redacted-url]", note: "ok" });
    expect(fields.list).toEqual(["[redacted]"]);
  });

  it("过深结构做截断且不抛错", () => {
    let deep: Record<string, unknown> = { value: "postgresql://u:p@h/db" };
    for (let index = 0; index < 8; index += 1) {
      deep = { nested: deep };
    }
    expect(() => redactFields(deep)).not.toThrow();
  });
});
