import { describe, expect, it } from "vitest";

import { decryptToken, encryptToken } from "./crypto";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("encryptToken / decryptToken", () => {
  it("加密后可解密回原文", () => {
    const encrypted = encryptToken("gho_测试token", KEY);
    expect(encrypted).not.toBeNull();
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("gho_");
    expect(decryptToken(encrypted, KEY)).toBe("gho_测试token");
  });

  it("每次加密使用随机 IV，相同明文得到不同密文", () => {
    expect(encryptToken("same-plaintext", KEY)).not.toBe(encryptToken("same-plaintext", KEY));
  });

  it("null / undefined / 空串透传为 null", () => {
    expect(encryptToken(null, KEY)).toBeNull();
    expect(encryptToken(undefined, KEY)).toBeNull();
    expect(encryptToken("", KEY)).toBeNull();
    expect(decryptToken(null, KEY)).toBeNull();
    expect(decryptToken(undefined, KEY)).toBeNull();
  });

  it("密文被篡改时解密失败", () => {
    const encrypted = encryptToken("secret-value", KEY);
    expect(encrypted).not.toBeNull();
    const [version, iv, authTag, ciphertext] = encrypted!.split(".");
    const bytes = Buffer.from(ciphertext, "base64");
    bytes[0] = bytes[0] ^ 0xff;
    const tampered = [version, iv, authTag, bytes.toString("base64")].join(".");
    expect(() => decryptToken(tampered, KEY)).toThrow();
  });

  it("使用错误密钥解密失败", () => {
    const encrypted = encryptToken("secret-value", KEY);
    expect(() => decryptToken(encrypted, OTHER_KEY)).toThrow();
  });

  it("拒绝格式错误的密文", () => {
    expect(() => decryptToken("not-a-valid-payload", KEY)).toThrow("令牌密文格式不正确");
    expect(() => decryptToken("v2.a.b.c", KEY)).toThrow("令牌密文格式不正确");
  });

  it("拒绝长度不合法的密钥", () => {
    expect(() => encryptToken("secret-value", Buffer.alloc(16).toString("base64"))).toThrow(
      /AUTH_TOKEN_ENC_KEY/,
    );
    expect(() => encryptToken("secret-value", "")).toThrow(/AUTH_TOKEN_ENC_KEY/);
  });
});
