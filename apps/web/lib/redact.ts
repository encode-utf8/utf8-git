// 敏感信息抹除（M4-1 可观测性）：日志、部署自检与错误上报共用同一套规则。
// 目标只有一个——任何写进日志或返回给运维的文本都不出现连接串 / 令牌明文。

export const REDACTED = "[redacted]";

// 连接串 / 带凭据的 URL
const CONNECTION_STRING =
  /\b(?:postgres(?:ql)?|redis|rediss|mongodb(?:\+srv)?|amqp|mysql):\/\/\S+/gi;
// GitHub 各类令牌（ghp_ / gho_ / ghu_ / ghs_ / ghr_ / github_pat_）
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
// Authorization 头 / `token xxx` 形式
const BEARER_TOKEN = /\b(?:bearer|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi;
// 敏感字段名：去掉分隔符再比较，避免误伤 idempotencyKey 这类业务键
const SENSITIVE_KEY =
  /(?:password|passwd|pwd|secret|token|credential|cookie|authorization|apikey|privatekey|enckey|connectionstring)$/;

const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;

/** 按值特征抹除明文（保留原有空白，供日志正文使用）。 */
export function redactText(text: string): string {
  return text
    .replace(CONNECTION_STRING, "[redacted-url]")
    .replace(GITHUB_TOKEN, REDACTED)
    .replace(BEARER_TOKEN, REDACTED);
}

/**
 * 连接串抹除 + 压成单行 + 截断（部署自检 / 健康检查输出用）。
 * 与 `redactText` 分开：这里保留稳定的 `postgresql://***` 标记，并限制在 300 字符内。
 */
export function redactConnectionInfo(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***")
    .replace(GITHUB_TOKEN, REDACTED)
    .replace(BEARER_TOKEN, REDACTED)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** 字段是否按敏感处理（键名归一化后做后缀匹配）。 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/** 递归抹除日志字段：敏感键整值替换，其余字符串按值特征抹除，深度 / 数组长度设上限。 */
export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redactValue(value, 0);
  }
  return output;
}

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return redactText(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message) };
  }
  if (depth >= MAX_DEPTH) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactValue(item, depth + 1));
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redactValue(item, depth + 1);
  }
  return output;
}
