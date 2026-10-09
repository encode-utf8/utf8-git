import { pickBranchColor } from "./color";
import type {
  CommitLike,
  LaneAssignment,
  LaneEdge,
  LaneLayout,
  LaneSegment,
  LaneSlice,
} from "./types";

/** 内部泳道状态：一条正在向下推进、等待某个提交出现的连线。 */
interface Lane {
  /** 该泳道当前等待解析的提交 oid。 */
  oid: string;
  /** 连线颜色：沿整条线继承，保证同一条泳道颜色稳定。 */
  color: string;
  /** 稳定标识：泳道列号发生位移时用它追踪同一条线。 */
  id: number;
}

/** 提交→父提交连线的中间数据（toRow / toLane 需遍历完整个输入后才能回填）。 */
interface EdgeDraft {
  fromOid: string;
  fromRow: number;
  fromLane: number;
  toOid: string;
  kind: "first-parent" | "merge";
  color: string;
}

/** 取第一个空泳道；若没有空洞则追加到最右侧。 */
function firstFreeLane(lanes: (Lane | null)[]): number {
  for (let index = 0; index < lanes.length; index += 1) {
    if (!lanes[index]) return index;
  }
  return lanes.length;
}

/**
 * 泳道布局算法内核（技术分析 §7「Lane Assignment」）。
 *
 * 输入：按拓扑序（等价 `git log --topo-order`）排列的提交，每个提交含 oid 与 parents。
 * 输出：commit→lane 映射（`nodes`）、相邻行之间的连线段（`segments`）、
 * 提交→父提交的语义边（`edges`），可直接驱动 SVG 渲染。
 *
 * 单遍贪心，关键决策：
 * 1. `lanes` 记录每条泳道「当前等待的提交 oid」；提交若已有多条泳道在等待，
 *    落到最左侧那条，其余在相邻行带内斜向汇入（表现为 merge 的收束点）。
 * 2. 第一父提交继承当前泳道（主线向下延伸）；其余父提交（merge / octopus）
 *    在当前泳道右侧依次新开泳道，形成分叉斜线。
 * 3. 颜色按「泳道线的起点提交 oid」哈希（复用 `pickBranchColor`），沿整条线继承，
 *    因此分叉出去的新线、合并汇入的线都能与其源头颜色一致。
 * 4. 每步只裁剪行尾空泳道，中间空洞保留给后续新分支复用——避免已有连线被迫横向抖动。
 * 5. 若某个父提交不在输入中（分页截断 / rebase 后被遗弃），其在等待泳道上表现为
 *    一条 `truncated` 的悬挂线段，越过可视区底部继续向下。
 *
 * 纯函数、无副作用，不依赖 DOM / Node API；不修改输入数组。
 */
export function computeLaneLayout(commits: CommitLike[]): LaneLayout {
  const inputOids = new Set<string>();
  for (const commit of commits) inputOids.add(commit.oid);

  const nodes: LaneAssignment[] = [];
  const segments: LaneSegment[] = [];
  const edges: LaneEdge[] = [];
  const edgeDrafts: EdgeDraft[] = [];

  const lanes: (Lane | null)[] = [];
  /** 上一步记录的「泳道 id → 该行所在列号」，作为下一行线段的起点。 */
  let previousColumns = new Map<number, number>();
  let nextLineId = 0;

  const rowByOid = new Map<string, number>();
  const laneByOid = new Map<string, number>();

  for (const [row, commit] of commits.entries()) {
    // 记录本行各泳道的列号（在改动 lanes 之前），供两端连线定位。
    const columnsAtRow = new Map<number, number>();
    for (let index = 0; index < lanes.length; index += 1) {
      const line = lanes[index];
      if (line) columnsAtRow.set(line.id, index);
    }

    // 1) 定位：寻找已在等待本提交的泳道；多条等待时取最左侧，其余合并汇入。
    const waiting: number[] = [];
    for (let index = 0; index < lanes.length; index += 1) {
      const line = lanes[index];
      if (line && line.oid === commit.oid) waiting.push(index);
    }
    const lane = waiting.length > 0 ? waiting[0]! : firstFreeLane(lanes);
    const mergedColumns = new Set(waiting.filter((index) => index !== lane));

    // 2) 输出「上一行 → 本行」的连线段（含被合并泳道斜向汇入的斜线）。
    if (row > 0) {
      for (let index = 0; index < lanes.length; index += 1) {
        const line = lanes[index];
        if (!line) continue;
        const fromLane = previousColumns.get(line.id);
        if (fromLane === undefined) continue;
        const toLane = mergedColumns.has(index) ? lane : index;
        segments.push({
          row: row - 1,
          fromLane,
          toLane,
          oid: line.oid,
          color: line.color,
          kind: fromLane === toLane ? "straight" : "diagonal",
          truncated: !inputOids.has(line.oid),
        });
      }
    }

    // 3) 分配节点：命中等待泳道则继承其颜色，否则视为新分支头 / 独立根并取新色。
    const ownLine = lanes[lane];
    let lineId: number;
    let color: string;
    if (ownLine) {
      lineId = ownLine.id;
      color = ownLine.color;
    } else {
      lineId = nextLineId;
      nextLineId += 1;
      color = pickBranchColor(commit.oid);
    }
    nodes.push({ oid: commit.oid, lane, color });
    rowByOid.set(commit.oid, row);
    laneByOid.set(commit.oid, lane);

    // 4) 释放所有等待本提交的泳道（含被合并的重复泳道）。
    for (const index of waiting) lanes[index] = null;

    // 5) 第一父提交继承当前泳道；其余父提交分叉开新泳道。
    const firstParent = commit.parents.length > 0 ? commit.parents[0] : undefined;
    if (firstParent) {
      lanes[lane] = { oid: firstParent, color, id: lineId };
      edgeDrafts.push({
        fromOid: commit.oid,
        fromRow: row,
        fromLane: lane,
        toOid: firstParent,
        kind: "first-parent",
        color,
      });
    } else {
      lanes[lane] = null; // root：主线到此结束
    }

    if (commit.parents.length > 1) {
      let insertAt = lane + 1;
      for (let index = 1; index < commit.parents.length; index += 1) {
        const parent = commit.parents[index];
        if (!parent) continue;
        // 若已有泳道在等待该父提交，则直接汇入，不新开泳道。
        let existing: Lane | null = null;
        for (const candidate of lanes) {
          if (candidate && candidate.oid === parent) {
            existing = candidate;
            break;
          }
        }
        if (existing) {
          edgeDrafts.push({
            fromOid: commit.oid,
            fromRow: row,
            fromLane: lane,
            toOid: parent,
            kind: "merge",
            color: existing.color,
          });
          continue;
        }
        const newLine: Lane = { oid: parent, color: pickBranchColor(parent), id: nextLineId };
        nextLineId += 1;
        lanes.splice(insertAt, 0, newLine);
        insertAt += 1;
        edgeDrafts.push({
          fromOid: commit.oid,
          fromRow: row,
          fromLane: lane,
          toOid: parent,
          kind: "merge",
          color: newLine.color,
        });
      }
    }

    // 6) 记录各泳道在本行的列号，作为下一行线段的起点。
    const nextColumns = new Map<number, number>();
    for (let index = 0; index < lanes.length; index += 1) {
      const line = lanes[index];
      if (!line) continue;
      if (line.id === lineId && firstParent) {
        nextColumns.set(line.id, lane); // 第一父连线从当前提交所在泳道出发
      } else {
        const column = columnsAtRow.get(line.id);
        nextColumns.set(line.id, column === undefined ? lane : column); // 新分叉从当前泳道出发
      }
    }
    previousColumns = nextColumns;

    // 7) 仅裁剪行尾空泳道，避免右侧无限增长；中间空洞留给后续分支复用。
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
  }

  // 8) 底部悬挂线段：父提交不在输入中（分页截断 / 被遗弃）时连线越过底部继续向下。
  for (let index = 0; index < lanes.length; index += 1) {
    const line = lanes[index];
    if (!line) continue;
    const fromLane = previousColumns.get(line.id);
    const start = fromLane === undefined ? index : fromLane;
    segments.push({
      row: commits.length - 1,
      fromLane: start,
      toLane: index,
      oid: line.oid,
      color: line.color,
      kind: start === index ? "straight" : "diagonal",
      truncated: !inputOids.has(line.oid),
    });
  }

  // 9) 回填父提交坐标，生成最终语义边。
  for (const draft of edgeDrafts) {
    const toRow = rowByOid.get(draft.toOid);
    const toLane = laneByOid.get(draft.toOid);
    if (toRow !== undefined && toLane !== undefined) {
      edges.push({
        fromOid: draft.fromOid,
        toOid: draft.toOid,
        fromRow: draft.fromRow,
        fromLane: draft.fromLane,
        toRow,
        toLane,
        kind: draft.kind,
        color: draft.color,
        truncated: false,
      });
    } else {
      edges.push({
        fromOid: draft.fromOid,
        toOid: draft.toOid,
        fromRow: draft.fromRow,
        fromLane: draft.fromLane,
        toRow: null,
        toLane: null,
        kind: draft.kind,
        color: draft.color,
        truncated: true,
      });
    }
  }

  // 10) 计算泳道总数（覆盖所有节点与线段使用到的列）。
  let maxColumn = 0;
  for (const node of nodes) maxColumn = Math.max(maxColumn, node.lane);
  for (const segment of segments) maxColumn = Math.max(maxColumn, segment.fromLane, segment.toLane);
  const laneCount = nodes.length > 0 ? maxColumn + 1 : 0;

  return { nodes, segments, edges, laneCount };
}
/** 把行号钳制到 [0, total]；非有限输入按 0 处理，小数截断。 */
function clampRow(value: number, total: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), total));
}

/**
 * 从完整布局切出渲染窗口 `[start, end)`（虚拟滚动 / 窗口化）。
 *
 * - `nodes` 为行 `start`..`end - 1`；
 * - `segments` 只保留起点行在窗口内、且终点行也在窗口内（或本身是越底悬挂段）的连线段：
 *   窗口末行之外的行带落在视口外（`computeVirtualWindow` 已含 overscan），无需创建 SVG 元素；
 * - `laneCount` 取整体值，保证滚动时列宽稳定。
 *
 * 纯函数、无副作用，不修改入参。
 */
export function sliceLaneLayout(layout: LaneLayout, start: number, end: number): LaneSlice {
  const total = layout.nodes.length;
  const from = clampRow(start, total);
  const to = Math.max(from, clampRow(end, total));

  return {
    start: from,
    end: to,
    laneCount: layout.laneCount,
    nodes: layout.nodes.slice(from, to),
    segments: layout.segments.filter(
      (segment) =>
        segment.row >= from && segment.row < to && (segment.row + 1 < to || segment.truncated),
    ),
  };
}
