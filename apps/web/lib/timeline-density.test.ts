import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMELINE_DENSITY,
  isTimelineDensity,
  parseTimelineDensity,
  timelineRowHeight,
} from "./timeline-density";

describe("timeline-density", () => {
  it("默认密度是紧凑，两档行高固定为 36 / 52", () => {
    expect(DEFAULT_TIMELINE_DENSITY).toBe("compact");
    expect(timelineRowHeight("compact")).toBe(36);
    expect(timelineRowHeight("comfy")).toBe(52);
  });

  it("识别合法值，其余一律判为非密度", () => {
    expect(isTimelineDensity("compact")).toBe(true);
    expect(isTimelineDensity("comfy")).toBe(true);
    expect(isTimelineDensity("compact ")).toBe(false);
    expect(isTimelineDensity("")).toBe(false);
    expect(isTimelineDensity(null)).toBe(false);
    expect(isTimelineDensity(36)).toBe(false);
  });

  it("解析存储值：非法 / 缺失回落到默认，不抛错", () => {
    expect(parseTimelineDensity("comfy")).toBe("comfy");
    expect(parseTimelineDensity("compact")).toBe("compact");
    expect(parseTimelineDensity(null)).toBe(DEFAULT_TIMELINE_DENSITY);
    expect(parseTimelineDensity(undefined)).toBe(DEFAULT_TIMELINE_DENSITY);
    expect(parseTimelineDensity("dense")).toBe(DEFAULT_TIMELINE_DENSITY);
  });
});
