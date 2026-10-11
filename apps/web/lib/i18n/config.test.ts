import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, isLocale, LOCALES, resolveLocale } from "./config";

describe("resolveLocale", () => {
  it("语言偏好优先于 Accept-Language", () => {
    expect(resolveLocale("en", "zh-CN,zh;q=0.9")).toBe("en");
    expect(resolveLocale("zh-CN", "en-US,en;q=0.9")).toBe("zh-CN");
  });

  it("偏好缺失或不支持时按 Accept-Language 的 q 值选择", () => {
    expect(resolveLocale(undefined, "en-US,en;q=0.9")).toBe("en");
    expect(resolveLocale(null, "en;q=0.5,zh-CN;q=0.9")).toBe("zh-CN");
    expect(resolveLocale("fr", "en;q=0.5,zh;q=0.9")).toBe("zh-CN");
  });

  it("忽略 q=0（显式拒绝）与占位语言", () => {
    expect(resolveLocale(undefined, "en;q=0,zh-CN;q=0.8")).toBe("zh-CN");
    expect(resolveLocale(undefined, "*")).toBe(DEFAULT_LOCALE);
  });

  it("容忍地区与脚本子标签", () => {
    expect(resolveLocale("zh-Hans-CN", undefined)).toBe("zh-CN");
    expect(resolveLocale(undefined, "en-GB,en;q=0.9")).toBe("en");
  });

  it("无法判定时回退到默认语言", () => {
    expect(resolveLocale(undefined, undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("", "")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined, "de-DE,fr;q=0.8")).toBe(DEFAULT_LOCALE);
  });
});

describe("isLocale", () => {
  it("只接受受支持的语言标签", () => {
    expect(LOCALES.every((locale) => isLocale(locale))).toBe(true);
    expect(isLocale("en-US")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(1)).toBe(false);
  });
});
