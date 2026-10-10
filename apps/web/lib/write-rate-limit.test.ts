import { describe, expect, it } from "vitest";

import {
  DEFAULT_WRITE_LIMIT,
  DEFAULT_WRITE_WINDOW_MS,
  decideWriteRateLimit,
  getWriteRateLimitConfig,
  rateLimitWindowStart,
} from "./write-rate-limit";

describe("频率限制配置", () => {
  it("默认 20 次 / 分钟，环境变量可覆盖", () => {
    expect(getWriteRateLimitConfig({})).toEqual({
      limit: DEFAULT_WRITE_LIMIT,
      windowMs: DEFAULT_WRITE_WINDOW_MS,
    });
    expect(
      getWriteRateLimitConfig({ WRITE_OPERATION_LIMIT: "5", WRITE_OPERATION_WINDOW_MS: "1000" }),
    ).toEqual({ limit: 5, windowMs: 1000 });
  });

  it("非法或非正数回退默认值", () => {
    expect(getWriteRateLimitConfig({ WRITE_OPERATION_LIMIT: "0" })).toEqual({
      limit: DEFAULT_WRITE_LIMIT,
      windowMs: DEFAULT_WRITE_WINDOW_MS,
    });
    expect(
      getWriteRateLimitConfig({ WRITE_OPERATION_LIMIT: "abc", WRITE_OPERATION_WINDOW_MS: "-5" }),
    ).toEqual({ limit: DEFAULT_WRITE_LIMIT, windowMs: DEFAULT_WRITE_WINDOW_MS });
  });

  it("窗口起点 = 当前时间 - 窗口长度", () => {
    expect(rateLimitWindowStart(new Date("2026-10-10T00:01:00.000Z"), 60_000).toISOString()).toBe(
      "2026-10-10T00:00:00.000Z",
    );
  });
});

describe("放行判定", () => {
  it("未达上限放行并给出剩余额度", () => {
    expect(decideWriteRateLimit({ recent: 3, limit: 5, windowMs: 60_000 })).toEqual({
      allowed: true,
      limit: 5,
      remaining: 2,
      windowMs: 60_000,
      retryAfterMs: 0,
    });
  });

  it("达到上限即拒绝，并给出等待时间", () => {
    const decision = decideWriteRateLimit({ recent: 5, limit: 5, windowMs: 60_000 });
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    expect(decision.retryAfterMs).toBe(60_000);
  });

  it("超额时剩余额度不会为负", () => {
    const decision = decideWriteRateLimit({ recent: 9, limit: 5, windowMs: 60_000 });
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });
});
