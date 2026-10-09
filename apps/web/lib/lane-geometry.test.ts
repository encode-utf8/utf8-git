import { describe, expect, it } from "vitest";

import { computeLaneMetrics } from "./lane-geometry";

describe("computeLaneMetrics", () => {
  it("无泳道时不占位", () => {
    expect(computeLaneMetrics(0)).toEqual({ laneWidth: 8, graphWidth: 0, gutterWidth: 0 });
  });

  it("非法或负值按 0 处理", () => {
    expect(computeLaneMetrics(Number.NaN).gutterWidth).toBe(0);
    expect(computeLaneMetrics(-3).gutterWidth).toBe(0);
    expect(computeLaneMetrics(2.9).graphWidth).toBe(36);
  });

  it("泳道少时取最大列宽", () => {
    const metrics = computeLaneMetrics(4);
    expect(metrics.laneWidth).toBe(18);
    expect(metrics.graphWidth).toBe(72);
    expect(metrics.gutterWidth).toBe(84);
  });

  it("泳道多时收紧到最小列宽，不会无限变窄", () => {
    const metrics = computeLaneMetrics(50);
    expect(metrics.laneWidth).toBe(8);
    expect(metrics.graphWidth).toBe(400);
    expect(metrics.gutterWidth).toBe(412);
  });

  it("列宽随泳道数单调不增", () => {
    const widths = [1, 4, 12, 30, 50].map((lanes) => computeLaneMetrics(lanes).laneWidth);
    for (let index = 1; index < widths.length; index += 1) {
      expect(widths[index]).toBeLessThanOrEqual(widths[index - 1]);
    }
  });
});
