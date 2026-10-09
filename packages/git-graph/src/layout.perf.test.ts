// M2-2 性能护栏：50 个功能分支 / 5051 提交下的窗口化行为。
//
// 这里断言两件事：
// 1. 结构 —— 窗口切片的元素量只与窗口大小相关，与总提交数无关（虚拟滚动每帧成本恒定）；
// 2. 耗时 —— 切片必须落在 60fps 帧预算内，全量布局落在「切换分支不卡手」的预算内。
// 阈值给足余量（本地实测切片 ≈ 0.4ms / 布局 ≈ 11ms），避免 CI 抖动误报。

import { describe, expect, it } from "vitest";

import { computeLaneLayout, sliceLaneLayout } from "./layout";
import { makeBranchyHistory } from "./synthetic-history";

/** 60fps 帧预算（ms）；窗口切片每帧都会调用 */
const FRAME_BUDGET_MS = 16.7;
/** 全量布局预算（ms）；只在切换分支 / 加载更多时发生 */
const LAYOUT_BUDGET_MS = 500;
/** 视口 600px / 行高 76px + 上下 overscan（与 apps/web/lib/virtual-window.ts 一致） */
const WINDOW_SIZE = 21;

/** 预热后取均值（ms）。 */
function measureMs(run: () => unknown, rounds = 20): number {
  for (let index = 0; index < 3; index += 1) run();
  const startedAt = Date.now();
  for (let index = 0; index < rounds; index += 1) run();
  return (Date.now() - startedAt) / rounds;
}

describe("窗口化性能护栏", () => {
  it("默认并发：切片元素量与耗时都只与窗口大小相关", () => {
    const history = makeBranchyHistory({ branches: 50, commitsPerBranch: 100 });
    const layout = computeLaneLayout(history);
    const middle = Math.floor(history.length / 2);
    const slice = sliceLaneLayout(layout, middle, middle + WINDOW_SIZE);

    expect(layout.nodes).toHaveLength(5051);
    expect(slice.nodes).toHaveLength(WINDOW_SIZE);
    // 每帧只画窗口内的行带：切片线段数应是全量的极小零头
    expect(slice.segments.length).toBeLessThan(layout.segments.length / 100);
    expect(measureMs(() => sliceLaneLayout(layout, middle, middle + WINDOW_SIZE))).toBeLessThan(
      FRAME_BUDGET_MS,
    );
  });

  it("合并风暴（50 条并发泳道）下依然窗口有界", () => {
    const history = makeBranchyHistory({ branches: 50, commitsPerBranch: 100, concurrent: 50 });
    const layout = computeLaneLayout(history);
    expect(layout.laneCount).toBe(51);

    const slice = sliceLaneLayout(layout, 0, WINDOW_SIZE);
    expect(slice.nodes).toHaveLength(WINDOW_SIZE);
    expect(slice.segments.length).toBeLessThan(layout.segments.length / 100);
    expect(measureMs(() => sliceLaneLayout(layout, 0, WINDOW_SIZE))).toBeLessThan(FRAME_BUDGET_MS);
  });

  it("全量布局落在可接受预算内", () => {
    const history = makeBranchyHistory({ branches: 50, commitsPerBranch: 100 });
    expect(measureMs(() => computeLaneLayout(history), 10)).toBeLessThan(LAYOUT_BUDGET_MS);
  });
});
