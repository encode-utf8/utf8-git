import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// 令牌加密工具：AES-256-GCM
// 存储格式：v1.<iv base64>.<authTag base64>.<密文 base64>
// 密钥来源：环境变量 AUTH_TOKEN_ENC_KEY（32 字节的 base64，独立于数据库）

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

// 解析并校验密钥，避免误用长度不合法的密钥
function parseKey(keyBase64: string | undefined): Buffer {
  if (!keyBase64) {
    throw new Error("缺少 AUTH_TOKEN_ENC_KEY 环境变量，无法加解密令牌");
  }
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `AUTH_TOKEN_ENC_KEY 必须是 ${KEY_BYTES} 字节的 base64 字符串（当前 ${key.length} 字节）`,
    );
  }
  return key;
}

// 加密：null / undefined / 空串原样透传，避免产生无意义的密文
export function encryptToken(
  plaintext: string | null | undefined,
  keyBase64: string | undefined = process.env.AUTH_TOKEN_ENC_KEY,
): string | null {
  if (!plaintext) {
    return null;
  }
  const key = parseKey(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

// 解密：拒绝格式错误 / 版本不符 / 认证标签校验失败的输入
export function decryptToken(
  payload: string | null | undefined,
  keyBase64: string | undefined = process.env.AUTH_TOKEN_ENC_KEY,
): string | null {
  if (!payload) {
    return null;
  }
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("令牌密文格式不正确");
  }
  const [, ivBase64, authTagBase64, ciphertextBase64] = parts;
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("令牌密文格式不正确");
  }
  const decipher = createDecipheriv(ALGORITHM, parseKey(keyBase64), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
