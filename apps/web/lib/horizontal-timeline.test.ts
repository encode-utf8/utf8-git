import { describe, expect, it } from "vitest";

import { computeHorizontalTimeline, visibleCardRange } from "./horizontal-timeline";

const DAY = 24 * 60 * 60 * 1000;

function base(overrides: Partial<Parameters<typeof computeHorizontalTimeline>[0]> = {}) {
  return computeHorizontalTimeline({
    lanes: [0, 0],
    times: [0, 10 * DAY],
    laneCount: 1,
    cardWidth: 100,
    cardGap: 10,
    laneGap: 64,
    padLeft: 20,
    padRight: 20,
    padTop: 34,
    padBottom: 40,
    minWidth: 200,
    minPxPerDay: 0,
    ...overrides,
  });
}

describe("computeHorizontalTimeline", () => {
  it("空输入给出可用尺寸与空 order", () => {
    const layout = base({ lanes: [], times: [], laneCount: 1 });
    expect(layout.order).toEqual([]);
    expect(layout.x).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBe(34 + 64 + 40);
  });

  it("时间映射是线性的（等时间差 → 等像素差）", () => {
    const layout = base({
      lanes: [0, 0, 0],
      times: [0, 5 * DAY, 10 * DAY],
      minWidth: 200,
      minPxPerDay: 0,
    });
    const firstGap = layout.x[1] - layout.x[0];
    const secondGap = layout.x[2] - layout.x[1];
    expect(firstGap).toBeCloseTo(secondGap, 5);
    expect(layout.x[0]).toBe(20);
  });

  it("最密泳道决定宽度：平均间距不小于卡片宽 + 间隙", () => {
    const layout = base({ lanes: [0, 0, 0, 0], times: [0, DAY, 2 * DAY, 3 * DAY], minWidth: 200 });
    for (let index = 1; index < layout.x.length; index += 1) {
      expect(layout.x[index] - layout.x[index - 1]).toBeGreaterThanOrEqual(110);
    }
  });

  it("同泳道局部扎堆时向右推，保证不重叠", () => {
    // 5 条挤在 1 小时内，另有 1 条在 30 天后
    const times = [0, 0.1 * DAY, 0.2 * DAY, 0.3 * DAY, 0.4 * DAY, 30 * DAY];
    const layout = base({
      lanes: [0, 0, 0, 0, 0, 0],
      times,
      minWidth: 200,
      minPxPerDay: 0,
    });
    for (let index = 1; index < layout.x.length; index += 1) {
      expect(layout.x[index] - layout.x[index - 1]).toBeGreaterThanOrEqual(110);
    }
  });

  it("不同泳道同一时刻可以同位（不互相推）", () => {
    const layout = base({
      lanes: [0, 1, 2],
      times: [5 * DAY, 5 * DAY, 5 * DAY],
      laneCount: 3,
      minWidth: 200,
    });
    expect(layout.x[0]).toBe(layout.x[1]);
    expect(layout.x[1]).toBe(layout.x[2]);
    expect(layout.laneY).toHaveLength(3);
    expect(layout.laneY[1] - layout.laneY[0]).toBe(64);
  });

  it("无效时间不参与映射，也不会崩", () => {
    const layout = base({ lanes: [0, 0, 0], times: [null, 0, 10 * DAY], minWidth: 200 });
    expect(layout.x).toHaveLength(3);
    expect(layout.x.every((value) => Number.isFinite(value))).toBe(true);
    expect(layout.width).toBeGreaterThan(0);
  });

  it("刻度按月生成，且 x 递增", () => {
    const layout = base({
      lanes: [0, 0],
      times: [Date.UTC(2026, 0, 15), Date.UTC(2026, 3, 15)],
      minWidth: 400,
      minPxPerDay: 1,
    });
    expect(layout.ticks.length).toBeGreaterThanOrEqual(3);
    for (let index = 1; index < layout.ticks.length; index += 1) {
      expect(layout.ticks[index].x).toBeGreaterThan(layout.ticks[index - 1].x);
      expect(layout.ticks[index].time).toBeGreaterThan(layout.ticks[index - 1].time);
    }
  });

  it("order 按 x 升序（裁剪依赖这个不变式）", () => {
    const layout = base({ lanes: [0, 0, 1, 0], times: [0, DAY, 2 * DAY, 3 * DAY], laneCount: 2 });
    for (let index = 1; index < layout.order.length; index += 1) {
      expect(layout.x[layout.order[index]]).toBeGreaterThanOrEqual(
        layout.x[layout.order[index - 1]],
      );
    }
  });
});

describe("visibleCardRange", () => {
  const layout = computeHorizontalTimeline({
    lanes: Array.from({ length: 100 }, () => 0),
    times: Array.from({ length: 100 }, (_, index) => index * DAY),
    laneCount: 1,
    cardWidth: 100,
    cardGap: 10,
    laneGap: 64,
    padLeft: 20,
    padRight: 20,
    padTop: 34,
    padBottom: 40,
    minWidth: 200,
  });

  it("返回的区间覆盖窗口内所有卡片，且不做全量渲染", () => {
    const scrollLeft = 2000;
    const viewportWidth = 800;
    const range = visibleCardRange(layout, scrollLeft, viewportWidth, 100, 1);
    expect(range.end - range.start).toBeLessThan(30);

    const visible = layout.order.filter((index) => {
      const x = layout.x[index];
      return x + 100 >= scrollLeft && x <= scrollLeft + viewportWidth;
    });
    const returned = new Set(layout.order.slice(range.start, range.end));
    for (const index of visible) {
      expect(returned.has(index)).toBe(true);
    }
  });

  it("空布局返回空区间", () => {
    expect(visibleCardRange({ x: [], order: [] }, 0, 800, 100)).toEqual({ start: 0, end: 0 });
    expect(visibleCardRange(layout, 0, 0, 100)).toEqual({ start: 0, end: 0 });
  });

  it("滚到两端时区间不越界", () => {
    const head = visibleCardRange(layout, 0, 800, 100, 2);
    expect(head.start).toBe(0);
    const tail = visibleCardRange(layout, 1e9, 800, 100, 2);
    expect(tail.end).toBe(layout.order.length);
  });
});
