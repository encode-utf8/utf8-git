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
  /** 产生顺序（跨分段回填后按它恢复与全量计算一致的 edges 次序）。 */
  seq: number;
}

/** 取第一个空泳道；若没有空洞则追加到最右侧。 */
function firstFreeLane(lanes: (Lane | null)[]): number {
  for (let index = 0; index < lanes.length; index += 1) {
    if (!lanes[index]) return index;
  }
  return lanes.length;
}

/**
 * 增量泳道布局计算器（TODO-246）。
 *
 * 与 {@link computeLaneLayout} 同一套算法内核，但把内部状态（泳道队列 / 行号索引 /
 * 颜色 id 计数）暴露为可分段喂入的对象：
 *
 * - `push(commits)`：按拓扑序**接续**喂入一段提交，只处理新增部分；
 * - `snapshot()`：产出「截至当前已喂入部分」的布局。含**临时**底部悬挂线段
 *   （喂入更多提交后自动消失或转为正式线段）；语义边只含已可解析的部分；
 * - `finish()`：结束喂入并产出与 {@link computeLaneLayout} 完全一致的最终布局。
 *
 * 分段喂入与一次性全量的等价性由不变式保证：第 `row` 行的泳道状态只由第 `0..row-1`
 * 行决定（因果性），因此「已有节点的列号与颜色」在追加更旧的提交时保持不变，
 * 只有新行、以及原先悬挂（父提交尚未出现）的线段 / 边会被推进或解除。
 *
 * 适用场景：时间线深分页（每次「加载更多」只 push 新页，避免万级提交全量重算）、
 * 服务端按内容指纹缓存布局（先查缓存，未命中再逐段喂入）。
 *
 * 约束：
 * - 每段提交必须按拓扑序接续前段（等价 `git log --topo-order` 的整体顺序）；
 * - oid 不得重复喂入（已处理过的 oid 会被跳过，保证幂等）；
 * - `finish()` 之后不可再 `push`。
 */
export class LaneComputation {
  private readonly inputOids = new Set<string>();
  private readonly nodes: LaneAssignment[] = [];
  private readonly segments: LaneSegment[] = [];
  private readonly rowByOid = new Map<string, number>();
  private readonly laneByOid = new Map<string, number>();

  /** 尚未定位到目标的语义边草稿（父提交可能在更晚的分段中出现）。 */
  private pendingDrafts: EdgeDraft[] = [];
  /** 已定位到目标的语义边（与 computeLaneLayout 的 edges 次序一致）。 */
  private readonly resolvedEdges: LaneEdge[] = [];
  /** resolvedEdges 各项对应的草稿产生序号（finish 时据此排序恢复全量次序）。 */
  private readonly resolvedSeq: number[] = [];
  /** 草稿产生计数。 */
  private draftSeq = 0;

  /** 已标记 truncated 的线段：其等待的 oid 可能在后续分段中出现，需在快照时复核。 */
  private pendingTruncated: LaneSegment[] = [];

  private lanes: (Lane | null)[] = [];
  /** 上一步记录的「泳道 id → 该行所在列号」，作为下一行线段的起点。 */
  private previousColumns = new Map<number, number>();
  private nextLineId = 0;
  /** 已出现的最大列号（节点与线段），供增量维护 laneCount。 */
  private maxColumn = 0;

  private finished = false;
  private dirty = false;
  private cache: LaneLayout | null = null;

  /** 已喂入的提交数（行数）。 */
  get size(): number {
    return this.nodes.length;
  }

  /** 喂入是否已结束。 */
  get isFinished(): boolean {
    return this.finished;
  }

  /**
   * 按拓扑序接续喂入一段提交。幂等：已处理过的 oid 直接跳过。
   * 不修改入参数组。
   */
  push(commits: CommitLike[]): this {
    if (this.finished) {
      throw new Error("LaneComputation 已 finish，不能再 push");
    }
    for (const commit of commits) {
      if (this.inputOids.has(commit.oid)) {
        continue;
      }
      this.inputOids.add(commit.oid);
      this.processCommit(commit, this.nodes.length);
    }
    this.dirty = true;
    return this;
  }

  /** 处理单行提交（算法步骤 1–7，与 computeLaneLayout 的内核一致）。 */
  private processCommit(commit: CommitLike, row: number): void {
    const columnsAtRow = new Map<number, number>();
    for (let index = 0; index < this.lanes.length; index += 1) {
      const line = this.lanes[index];
      if (line) columnsAtRow.set(line.id, index);
    }

    // 1) 定位：寻找已在等待本提交的泳道；多条等待时取最左侧，其余合并汇入。
    const waiting: number[] = [];
    for (let index = 0; index < this.lanes.length; index += 1) {
      const line = this.lanes[index];
      if (line && line.oid === commit.oid) waiting.push(index);
    }
    const lane = waiting.length > 0 ? waiting[0]! : firstFreeLane(this.lanes);
    const mergedColumns = new Set(waiting.filter((index) => index !== lane));

    // 2) 输出「上一行 → 本行」的连线段（含被合并泳道斜向汇入的斜线）。
    if (row > 0) {
      for (let index = 0; index < this.lanes.length; index += 1) {
        const line = this.lanes[index];
        if (!line) continue;
        const fromLane = this.previousColumns.get(line.id);
        if (fromLane === undefined) continue;
        const toLane = mergedColumns.has(index) ? lane : index;
        const truncated = !this.inputOids.has(line.oid);
        const segment: LaneSegment = {
          row: row - 1,
          fromLane,
          toLane,
          oid: line.oid,
          color: line.color,
          kind: fromLane === toLane ? "straight" : "diagonal",
          truncated,
        };
        this.segments.push(segment);
        if (truncated) {
          this.pendingTruncated.push(segment);
        }
        this.maxColumn = Math.max(this.maxColumn, fromLane, toLane);
      }
    }

    // 3) 分配节点：命中等待泳道则继承其颜色，否则视为新分支头 / 独立根并取新色。
    const ownLine = this.lanes[lane];
    let lineId: number;
    let color: string;
    if (ownLine) {
      lineId = ownLine.id;
      color = ownLine.color;
    } else {
      lineId = this.nextLineId;
      this.nextLineId += 1;
      color = pickBranchColor(commit.oid);
    }
    this.nodes.push({ oid: commit.oid, lane, color });
    this.maxColumn = Math.max(this.maxColumn, lane);
    this.rowByOid.set(commit.oid, row);
    this.laneByOid.set(commit.oid, lane);

    // 4) 释放所有等待本提交的泳道（含被合并的重复泳道）。
    for (const index of waiting) this.lanes[index] = null;

    // 5) 第一父提交继承当前泳道；其余父提交分叉开新泳道。
    const firstParent = commit.parents.length > 0 ? commit.parents[0] : undefined;
    if (firstParent) {
      this.lanes[lane] = { oid: firstParent, color, id: lineId };
      this.pendingDrafts.push({
        fromOid: commit.oid,
        fromRow: row,
        fromLane: lane,
        toOid: firstParent,
        kind: "first-parent",
        color,
        seq: this.draftSeq++,
      });
    } else {
      this.lanes[lane] = null; // root：主线到此结束
    }

    if (commit.parents.length > 1) {
      let insertAt = lane + 1;
      for (let index = 1; index < commit.parents.length; index += 1) {
        const parent = commit.parents[index];
        if (!parent) continue;
        // 若已有泳道在等待该父提交，则直接汇入，不新开泳道。
        let existing: Lane | null = null;
        for (const candidate of this.lanes) {
          if (candidate && candidate.oid === parent) {
            existing = candidate;
            break;
          }
        }
        if (existing) {
          this.pendingDrafts.push({
            fromOid: commit.oid,
            fromRow: row,
            fromLane: lane,
            toOid: parent,
            kind: "merge",
            color: existing.color,
            seq: this.draftSeq++,
          });
          continue;
        }
        const newLine: Lane = { oid: parent, color: pickBranchColor(parent), id: this.nextLineId };
        this.nextLineId += 1;
        this.lanes.splice(insertAt, 0, newLine);
        insertAt += 1;
        this.pendingDrafts.push({
          fromOid: commit.oid,
          fromRow: row,
          fromLane: lane,
          toOid: parent,
          kind: "merge",
          color: newLine.color,
          seq: this.draftSeq++,
        });
      }
    }

    // 6) 记录各泳道在本行的列号，作为下一行线段的起点。
    const nextColumns = new Map<number, number>();
    for (let index = 0; index < this.lanes.length; index += 1) {
      const line = this.lanes[index];
      if (!line) continue;
      if (line.id === lineId && firstParent) {
        nextColumns.set(line.id, lane); // 第一父连线从当前提交所在泳道出发
      } else {
        const column = columnsAtRow.get(line.id);
        nextColumns.set(line.id, column === undefined ? lane : column); // 新分叉从当前泳道出发
      }
    }
    this.previousColumns = nextColumns;

    // 7) 仅裁剪行尾空泳道，避免右侧无限增长；中间空洞留给后续分支复用。
    while (this.lanes.length > 0 && this.lanes[this.lanes.length - 1] === null) this.lanes.pop();
  }

  /**
   * 语义边回填：把「目标已出现」的草稿转成最终边。
   * 单次调用内按草稿产生顺序输出；跨分段时整体次序在 finish 时按 seq 恢复。
   */
  private resolveDrafts(): void {
    if (this.pendingDrafts.length === 0) {
      return;
    }
    const still: EdgeDraft[] = [];
    for (const draft of this.pendingDrafts) {
      const toRow = this.rowByOid.get(draft.toOid);
      const toLane = this.laneByOid.get(draft.toOid);
      if (toRow !== undefined && toLane !== undefined) {
        this.resolvedEdges.push({
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
        this.resolvedSeq.push(draft.seq);
      } else {
        still.push(draft);
      }
    }
    this.pendingDrafts = still;
  }

  /**
   * 复核 truncated 线段：等待的 oid 在后续分段中出现后，线段不再是悬挂段。
   * 只遍历仍标记为 truncated 的线段（数量有界），摊还线性。
   */
  private resolveTruncatedSegments(): void {
    if (this.pendingTruncated.length === 0) {
      return;
    }
    this.pendingTruncated = this.pendingTruncated.filter((segment) => {
      if (this.inputOids.has(segment.oid)) {
        segment.truncated = false;
        return false;
      }
      return true;
    });
  }

  /**
   * 产出截至当前的布局快照（未 finish 也可用）。
   * - 快照对象在两次 push 之间保持同一引用（便于 React memo / 上下文依赖）；
   * - 未结束喂入时：不含底部悬挂线段；语义边只含已可解析的部分
   *   （父 Commit 尚未喂入的边在后续 push 后自动出现，finish 时补齐悬挂边）。
   */
  /**
   * 当前泳道队列对应的「底部悬挂线段」（算法步骤 8 的临时版本）。
   * 不写入 this.segments：未结束喂入时每次快照重算，喂入更多提交后自然消失，
   * 避免与正式行带线段交错破坏「segments 按 row 升序」的不变式。
   */
  private buildHangingSegments(): LaneSegment[] {
    if (this.nodes.length === 0) {
      return [];
    }
    const hanging: LaneSegment[] = [];
    for (let index = 0; index < this.lanes.length; index += 1) {
      const line = this.lanes[index];
      if (!line) continue;
      const fromLane = this.previousColumns.get(line.id);
      const start = fromLane === undefined ? index : fromLane;
      hanging.push({
        row: this.nodes.length - 1,
        fromLane: start,
        toLane: index,
        oid: line.oid,
        color: line.color,
        kind: start === index ? "straight" : "diagonal",
        truncated: !this.inputOids.has(line.oid),
      });
    }
    return hanging;
  }

  /** 泳道总数：节点、已存线段与（快照时的）临时悬挂线段覆盖到的最大列 + 1。 */
  private computeLaneCount(hanging: LaneSegment[] = []): number {
    if (this.nodes.length === 0) {
      return 0;
    }
    let maxColumn = this.maxColumn;
    for (const segment of hanging) {
      maxColumn = Math.max(maxColumn, segment.fromLane, segment.toLane);
    }
    return maxColumn + 1;
  }

  /**
   * 产出截至当前的布局快照（未 finish 也可用）。
   * - 快照对象在两次 push 之间保持同一引用（便于 React memo / 上下文依赖）；
   * - 含**临时**底部悬挂线段（每次快照按当前泳道队列重算，喂入更多提交后
   *   自动消失或转为正式线段），渲染上与全量计算的当前前缀一致；
   * - 语义边只含已可解析的部分（父提交尚未喂入的边在后续 push 后出现，
   *   finish 时补齐悬挂边）。
   */
  snapshot(): LaneLayout {
    if (this.finished) {
      return this.cache!;
    }
    if (!this.dirty && this.cache) {
      return this.cache;
    }
    this.resolveTruncatedSegments();
    this.resolveDrafts();
    const hanging = this.buildHangingSegments();
    this.dirty = false;
    this.cache = {
      nodes: [...this.nodes],
      segments: [...this.segments, ...hanging],
      edges: [...this.resolvedEdges],
      laneCount: this.computeLaneCount(hanging),
    };
    return this.cache;
  }

  /**
   * 结束喂入并产出最终布局：补齐底部悬挂线段（步骤 8）与悬挂语义边（步骤 9 的
   * else 分支）。结果与 {@link computeLaneLayout} 逐字段一致。
   * 返回的快照稳定不变；之后不可再 push。
   */
  finish(): LaneLayout {
    if (this.finished) {
      return this.cache!;
    }
    this.resolveTruncatedSegments();
    this.resolveDrafts();

    // 8) 底部悬挂线段：父提交不在输入中（分页截断 / 被遗弃）时连线越过底部继续向下。
    const hanging = this.buildHangingSegments();
    this.segments.push(...hanging);
    for (const segment of hanging) {
      this.maxColumn = Math.max(this.maxColumn, segment.fromLane, segment.toLane);
    }

    // 9) 仍不可解析的语义边 = 悬挂边（父提交自始至终未出现）。
    // 已解析边按草稿产生序号排序，保证与全量计算的 edges 次序一致。
    const ordered = this.resolvedEdges
      .map((edge, index) => ({ edge, seq: this.resolvedSeq[index]! }))
      .sort((left, right) => left.seq - right.seq);
    for (const draft of this.pendingDrafts) {
      ordered.push({
        edge: {
          fromOid: draft.fromOid,
          toOid: draft.toOid,
          fromRow: draft.fromRow,
          fromLane: draft.fromLane,
          toRow: null,
          toLane: null,
          kind: draft.kind,
          color: draft.color,
          truncated: true,
        },
        seq: draft.seq,
      });
    }
    ordered.sort((left, right) => left.seq - right.seq);
    this.pendingDrafts = [];

    // 10) 计算泳道总数（覆盖所有节点与线段使用到的列）。
    this.finished = true;
    this.dirty = false;
    this.cache = {
      nodes: [...this.nodes],
      segments: [...this.segments],
      edges: ordered.map((entry) => entry.edge),
      laneCount: this.computeLaneCount(),
    };
    return this.cache;
  }
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
 * 需要分段喂入（深分页 / 服务端缓存）时用 {@link LaneComputation}，结果等价。
 */
export function computeLaneLayout(commits: CommitLike[]): LaneLayout {
  return new LaneComputation().push(commits).finish();
}

/** 把行号钳制到 [0, total]；非有限输入按 0 处理，小数截断。 */
function clampRow(value: number, total: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), total));
}

/** 在按 `row` 升序排列的线段中二分出第一条第 `row >= target` 的线段下标（无则返回长度）。 */
function firstSegmentAtOrAfter(segments: LaneSegment[], target: number): number {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (segments[middle]!.row < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * 从完整布局切出渲染窗口 `[start, end)`（虚拟滚动 / 窗口化）。
 *
 * - `nodes` 为行 `start`..`end - 1`；
 * - `segments` 只保留起点行在窗口内、且终点行也在窗口内（或本身是越底悬挂段）的连线段：
 *   窗口末行之外的行带落在视口外（`computeVirtualWindow` 已含 overscan），无需创建 SVG 元素；
 * - `laneCount` 取整体值，保证滚动时列宽稳定。
 *
 * 依赖 `computeLaneLayout` 的不变式「segments 按 row 升序」：窗口内的线段是其中一段连续区间，
 * 二分定位即可，避免每帧扫描全量线段（万级节点 / 满并发下这是切片成本的大头）。
 *
 * 纯函数、无副作用，不修改入参。
 */
export function sliceLaneLayout(layout: LaneLayout, start: number, end: number): LaneSlice {
  const total = layout.nodes.length;
  const from = clampRow(start, total);
  const to = Math.max(from, clampRow(end, total));

  const segmentsFrom = firstSegmentAtOrAfter(layout.segments, from);
  const segmentsTo = firstSegmentAtOrAfter(layout.segments, to);

  return {
    start: from,
    end: to,
    laneCount: layout.laneCount,
    nodes: layout.nodes.slice(from, to),
    segments: layout.segments
      .slice(segmentsFrom, segmentsTo)
      .filter((segment) => segment.row + 1 < to || segment.truncated),
  };
}
