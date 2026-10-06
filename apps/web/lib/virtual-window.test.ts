import { describe, expect, it } from "vitest";

import { computeVirtualWindow } from "./virtual-window";

const rowHeight = 76;

describe("computeVirtualWindow", () => {
  it("空列表返回全零窗口", () => {
    expect(
      computeVirtualWindow({ scrollTop: 0, viewportHeight: 600, rowHeight, total: 0 }),
    ).toEqual({ start: 0, end: 0, offsetY: 0, totalHeight: 0, visibleCount: 0 });
    expect(
      computeVirtualWindow({ scrollTop: 0, viewportHeight: 600, rowHeight: 0, total: 100 }),
    ).toEqual({ start: 0, end: 0, offsetY: 0, totalHeight: 0, visibleCount: 0 });
  });

  it("顶部：start=0，窗口覆盖视口 + overscan", () => {
    const window = computeVirtualWindow({
      scrollTop: 0,
      viewportHeight: 600,
      rowHeight,
      total: 1000,
    });
    expect(window.start).toBe(0);
    expect(window.end).toBe(21); // ceil(600/76)=8 + 6*2 overscan + 1
    expect(window.offsetY).toBe(0);
    expect(window.totalHeight).toBe(76000);
    expect(window.visibleCount).toBe(21);
  });

  it("中部：以上下 overscan 包裹可视区", () => {
    const window = computeVirtualWindow({
      scrollTop: 100 * rowHeight,
      viewportHeight: 600,
      rowHeight,
      total: 1000,
    });
    expect(window.start).toBe(94);
    expect(window.end).toBe(115);
    expect(window.offsetY).toBe(94 * rowHeight);
  });

  it("底部：end 夹到 total，scrollTop 不超过可滚动上限", () => {
    const window = computeVirtualWindow({
      scrollTop: 76000,
      viewportHeight: 600,
      rowHeight,
      total: 1000,
    });
    expect(window.end).toBe(1000);
    expect(window.start).toBe(986);
    expect(window.offsetY).toBe(986 * rowHeight);
  });

  it("overscan 可调，视口为 0 时仍渲染兜底行", () => {
    const noOverscan = computeVirtualWindow({
      scrollTop: 100 * rowHeight,
      viewportHeight: 600,
      rowHeight,
      total: 1000,
      overscan: 0,
    });
    expect(noOverscan.start).toBe(100);
    expect(noOverscan.end).toBe(109);

    const noViewport = computeVirtualWindow({
      scrollTop: 0,
      viewportHeight: 0,
      rowHeight,
      total: 50,
    });
    expect(noViewport.start).toBe(0);
    expect(noViewport.end).toBe(13);
  });
});
