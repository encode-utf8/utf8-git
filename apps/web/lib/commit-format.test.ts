import { describe, expect, it } from "vitest";

import { formatRelativeTime, formatUtcDateTime, shortSha } from "./commit-format";

describe("shortSha", () => {
  it("取前 7 位；短 SHA 原样返回", () => {
    expect(shortSha("abcdef1234567890")).toBe("abcdef1");
    expect(shortSha("abc")).toBe("abc");
  });
});

describe("formatRelativeTime", () => {
  const base = Date.parse("2026-10-06T00:00:00Z");

  it("刚刚 / 分钟 / 小时 / 天 / 日期回退", () => {
    expect(formatRelativeTime(base, base + 30_000)).toBe("刚刚");
    expect(formatRelativeTime(base, base + 5 * 60_000)).toBe("5 分钟前");
    expect(formatRelativeTime(base, base + 3 * 3_600_000)).toBe("3 小时前");
    expect(formatRelativeTime(base, base + 2 * 86_400_000)).toBe("2 天前");
    // 超过 30 天回退为提交自身日期
    const oldCommit = Date.parse("2026-09-01T08:00:00Z");
    const now = Date.parse("2026-11-15T12:00:00Z");
    expect(formatRelativeTime(oldCommit, now)).toBe("2026-09-01");
  });

  it("未来时间按 0 处理（刚刚）", () => {
    expect(formatRelativeTime(base, base - 60_000)).toBe("刚刚");
  });
});

describe("formatUtcDateTime", () => {
  it("输出 UTC 的 YYYY-MM-DD HH:mm", () => {
    expect(formatUtcDateTime("2026-10-06T14:30:00Z")).toBe("2026-10-06 14:30");
  });

  it("空值与非法值回退为占位符", () => {
    expect(formatUtcDateTime(null)).toBe("—");
    expect(formatUtcDateTime("not-a-date")).toBe("—");
  });
});
