// 泳道几何（纯函数，便于单测）：把整体泳道数映射为 SVG 列宽与行内容左侧留白。
// 列宽只依赖整体 laneCount，窗口化滚动时保持不变，避免滚动中列宽抖动。

/** 单条泳道的最小 / 最大列宽（px）。 */
const MIN_LANE_WIDTH = 8;
const MAX_LANE_WIDTH = 18;
/** 期望的泳道槽总宽（px）：泳道少时单槽更宽，泳道多时受最小列宽约束。 */
const TARGET_GUTTER_WIDTH = 196;
/** 泳道槽与提交内容之间的间距（px）。 */
const GUTTER_PADDING = 12;

export type LaneMetrics = {
  /** 单条泳道列宽（px）。 */
  laneWidth: number;
  /** 泳道槽（SVG）宽度（px），等于 laneWidth × laneCount。 */
  graphWidth: number;
  /** 行内容左侧留白（px）：泳道槽宽 + 间距；无泳道时为 0，不占位。 */
  gutterWidth: number;
};

/**
 * 计算泳道几何：`laneWidth` 在 [MIN, MAX] 间随泳道数反向收敛，
 * 保证少量泳道时足够粗、大量泳道（如 50 分支）时不至于过窄。
 */
export function computeLaneMetrics(laneCount: number): LaneMetrics {
  const lanes = Number.isFinite(laneCount) ? Math.max(0, Math.trunc(laneCount)) : 0;
  if (lanes === 0) {
    return { laneWidth: MIN_LANE_WIDTH, graphWidth: 0, gutterWidth: 0 };
  }
  const laneWidth = Math.min(
    MAX_LANE_WIDTH,
    Math.max(MIN_LANE_WIDTH, Math.floor(TARGET_GUTTER_WIDTH / lanes)),
  );
  const graphWidth = laneWidth * lanes;
  return { laneWidth, graphWidth, gutterWidth: graphWidth + GUTTER_PADDING };
}
