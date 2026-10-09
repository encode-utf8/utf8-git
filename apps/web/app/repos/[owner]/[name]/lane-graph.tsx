import type { LaneSlice } from "@utf8-git/git-graph";

/** 泳道图形（SVG，纯展示）：绘制当前渲染窗口内的连线段与提交节点。 */
type LaneGraphProps = {
  /** 当前渲染窗口的布局切片，行号为整体下标的绝对行。 */
  slice: LaneSlice;
  /** 固定行高（px），与虚拟滚动一致。 */
  rowHeight: number;
  /** 单条泳道列宽（px）。 */
  laneWidth: number;
  /** SVG 高度（px），通常为窗口行数 × 行高。 */
  height: number;
  /** 定位用类名（例如绝对定位到窗口内容左上角）。 */
  className?: string;
};

export function LaneGraph({ slice, rowHeight, laneWidth, height, className }: LaneGraphProps) {
  const width = Math.max(1, slice.laneCount * laneWidth);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={["text-white dark:text-zinc-950", className].filter(Boolean).join(" ")}
      // 末行悬挂线段要越出窗口底部，不能被 SVG 视口裁掉
      style={{ overflow: "visible" }}
    >
      {slice.segments.map((segment) => {
        const relativeRow = segment.row - slice.start;
        const x1 = (segment.fromLane + 0.5) * laneWidth;
        const x2 = (segment.toLane + 0.5) * laneWidth;
        const y1 = (relativeRow + 0.5) * rowHeight;
        const y2 = (relativeRow + 1.5) * rowHeight;
        return (
          <path
            key={`${segment.oid}:${segment.row}:${segment.fromLane}:${segment.toLane}`}
            d={`M ${x1} ${y1} L ${x2} ${y2}`}
            stroke={segment.color}
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
            opacity={segment.truncated ? 0.55 : 1}
          />
        );
      })}
      {slice.nodes.map((node, index) => (
        <circle
          key={node.oid}
          cx={(node.lane + 0.5) * laneWidth}
          cy={(index + 0.5) * rowHeight}
          r={Math.max(2, Math.min(4.5, laneWidth / 2 - 1))}
          fill={node.color}
          stroke="currentColor"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}
