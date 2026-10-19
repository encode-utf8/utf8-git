import { describe, expect, it } from "vitest";

import { EDGE_SCROLL_BAND, EDGE_SCROLL_MAX_STEP, edgeScrollStep } from "./edge-scroll";

describe("edgeScrollStep", () => {
  // 容器 [100, 900]，带 56，最大步长 16
  const start = 100;
  const end = 900;

  it("指针在中间时返回 0", () => {
    expect(edgeScrollStep(500, start, end)).toBe(0);
    expect(edgeScrollStep(start + EDGE_SCROLL_BAND, start, end)).toBe(0);
    expect(edgeScrollStep(end - EDGE_SCROLL_BAND, start, end)).toBe(0);
  });

  it("靠近起点返回负值，越靠边越快", () => {
    const nearEdge = edgeScrollStep(start + 4, start, end);
    const nearBand = edgeScrollStep(start + EDGE_SCROLL_BAND - 2, start, end);
    expect(nearEdge).toBeLessThan(0);
    expect(nearBand).toBeLessThan(0);
    expect(Math.abs(nearEdge)).toBeGreaterThan(Math.abs(nearBand));
  });

  it("靠近终点返回正值，越靠边越快", () => {
    const nearEdge = edgeScrollStep(end - 4, start, end);
    const nearBand = edgeScrollStep(end - EDGE_SCROLL_BAND + 2, start, end);
    expect(nearEdge).toBeGreaterThan(0);
    expect(nearBand).toBeGreaterThan(0);
    expect(nearEdge).toBeGreaterThan(nearBand);
  });

  it("指针越过容器边界时按最大步长钳制", () => {
    expect(edgeScrollStep(start - 200, start, end)).toBe(-EDGE_SCROLL_MAX_STEP);
    expect(edgeScrollStep(end + 200, start, end)).toBe(EDGE_SCROLL_MAX_STEP);
  });

  it("容器比两条边带还窄时不滚动（避免方向抖动）", () => {
    expect(edgeScrollStep(150, 100, 200)).toBe(0);
    expect(edgeScrollStep(150, 100, 212)).toBe(0); // 112 < 56 * 2
  });

  it("带内最慢也有 2px，保证能真正滚起来", () => {
    expect(
      Math.abs(edgeScrollStep(start + EDGE_SCROLL_BAND - 1, start, end)),
    ).toBeGreaterThanOrEqual(2);
    expect(Math.abs(edgeScrollStep(end - EDGE_SCROLL_BAND + 1, start, end))).toBeGreaterThanOrEqual(
      2,
    );
  });
});
