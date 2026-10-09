/**
 * 提交图的输入节点：对应 GitHub GraphQL `Commit` 的最小字段集。
 */
export interface CommitLike {
  oid: string;
  parents: string[];
}

/**
 * 泳道布局结果：每个提交的列号与颜色。
 * 完整布局算法（merge / root / 多父 / rebase 等边界）见技术分析 §7，于 M2-1 落地。
 */
export interface LaneAssignment {
  oid: string;
  lane: number;
  color: string;
}

/**
 * 相邻两行之间的连线段：连接输入中的第 `row` 行与第 `row + 1` 行。
 * `fromLane` 与 `toLane` 不同即为跨泳道斜线（分叉或合并汇入）。
 * 前端可直接据此绘制 SVG `<line>`；颜色与所属泳道线一致。
 */
export interface LaneSegment {
  /** 线段上端所在行（提交在输入数组中的下标）。 */
  row: number;
  /** 起点泳道（第 row 行处的列号）。 */
  fromLane: number;
  /** 终点泳道（第 row + 1 行处的列号）。 */
  toLane: number;
  /** 该线段正在等待解析的父提交 oid（决定颜色与归属）。 */
  oid: string;
  /** 线段颜色（与其所属泳道线一致）。 */
  color: string;
  /** 直线（同列）或斜线（跨列）。 */
  kind: "straight" | "diagonal";
  /** 该线段指向的父提交不在输入中（分页截断 / 被遗弃），连线继续向下延伸。 */
  truncated: boolean;
}

/**
 * 提交到父提交的语义连线（一个提交的每个父提交各一条）。
 * `toRow` / `toLane` 为父提交坐标；父提交不在输入中时为 null（见 `truncated`）。
 */
export interface LaneEdge {
  fromOid: string;
  toOid: string;
  fromRow: number;
  fromLane: number;
  toRow: number | null;
  toLane: number | null;
  /** 第一父提交（主线延续）或分叉父提交（merge / octopus 的其他父）。 */
  kind: "first-parent" | "merge";
  color: string;
  truncated: boolean;
}

/**
 * 泳道布局的完整结果，可直接驱动 SVG 分层渲染。
 */
export interface LaneLayout {
  /** 按输入顺序排列的提交节点，下标即行号。 */
  nodes: LaneAssignment[];
  /** 相邻行之间的连线段（含跨泳道斜线）。 */
  segments: LaneSegment[];
  /** 提交到父提交的语义连线。 */
  edges: LaneEdge[];
  /** 使用到的泳道总数（最大列号 + 1；空输入为 0）。 */
  laneCount: number;
}
