// 横向时间轴的布局计算（纯函数，便于单测）。
//
// 坐标系：x = 时间（左旧右新），y = 泳道。与原来的竖向列表相比，行高语义变成「泳道高度」，
// 虚拟窗口也从 scrollTop 换成 scrollLeft。
//
// 间距模型（与设计稿一致）：
// 1. 全局按真实时间线性映射（一个 scale 贯穿整条轴，时间才可比）；
// 2. scale 由「最密泳道」反推——保证该泳道的平均间距不小于卡片宽 + 间隙，
//    否则时间轴再准也会挤成一团；
// 3. 同泳道再做一次最小间距兜底：局部扎堆（比如一小时内 5 条）时向右推，宁可牺牲一点时间精度。

const DAY_MS = 24 * 60 * 60 * 1000;

export type HorizontalTimelineInput = {
  /** 每条提交的泳道号（与提交数组下标对齐）。 */
  lanes: number[];
  /** 每条提交的时间戳（毫秒）；无效时间给 null。 */
  times: Array<number | null>;
  /** 整体泳道数（不随窗口变化，保证纵向尺寸稳定）。 */
  laneCount: number;
  /** 卡片宽度（px）。 */
  cardWidth: number;
  /** 卡片之间的最小水平间隙（px）。 */
  cardGap: number;
  /** 泳道高度（px）。 */
  laneGap: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  /** 内容最小宽度：提交很少时也要铺满视口。 */
  minWidth?: number;
  /** 每天至少给多少像素（保证长跨度仓库的沉寂期看得出来）。 */
  minPxPerDay?: number;
};

export type HorizontalTimeline = {
  /** 每张卡片的左边缘 x（与提交下标对齐）。 */
  x: number[];
  /** 每张卡片的垂直中心 y（与提交下标对齐）。 */
  y: number[];
  /** 每个泳道的中线 y。 */
  laneY: number[];
  width: number;
  height: number;
  /** 按 x 升序排列的下标：可视区裁剪用二分查找，避免每帧扫全量。 */
  order: number[];
  /** 时间刻度（取每月 1 号，过密时抽稀）。 */
  ticks: Array<{ x: number; time: number }>;
};

const DEFAULT_MIN_WIDTH = 1200;
const DEFAULT_MIN_PX_PER_DAY = 2;
/** 刻度上限：超过就按季度 / 半年 / 年抽稀。 */
const MAX_TICKS = 40;

function monthStart(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function addMonths(time: number, months: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

/** 计算时间刻度：按月取整，密度过高时按 3 / 6 / 12 / 24 个月抽稀。 */
function buildTicks(minTime: number, maxTime: number, scale: number, padLeft: number) {
  const ticks: Array<{ x: number; time: number }> = [];
  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime) || maxTime <= minTime) {
    return ticks;
  }
  const first = monthStart(minTime);
  const months = Math.max(1, Math.ceil((maxTime - first) / (30.44 * DAY_MS)) + 1);
  const stepCandidates = [1, 3, 6, 12, 24, 60];
  const step = stepCandidates.find((value) => months / value <= MAX_TICKS) ?? 120;

  let cursor = first;
  // 起点对齐到 step 的整数倍月份，避免抽稀后刻度落在奇怪的位置
  while (cursor < minTime) {
    cursor = addMonths(cursor, step);
  }
  let guard = 0;
  while (cursor <= maxTime && guard < MAX_TICKS * 2) {
    ticks.push({ x: padLeft + (cursor - minTime) * scale, time: cursor });
    cursor = addMonths(cursor, step);
    guard += 1;
  }
  return ticks;
}

export function computeHorizontalTimeline(input: HorizontalTimelineInput): HorizontalTimeline {
  const count = input.lanes.length;
  const cardWidth = Math.max(40, input.cardWidth);
  const cardGap = Math.max(0, input.cardGap);
  const laneGap = Math.max(20, input.laneGap);
  const laneCount = Math.max(1, input.laneCount);
  const padLeft = Math.max(0, input.padLeft);
  const padRight = Math.max(0, input.padRight);

  // 泳道中线：卡片垂直居中在这条线上
  const laneY = Array.from(
    { length: laneCount },
    (_, lane) => input.padTop + laneGap / 2 + lane * laneGap,
  );

  if (count === 0) {
    return {
      x: [],
      y: [],
      laneY,
      width: padLeft + padRight + (input.minWidth ?? DEFAULT_MIN_WIDTH),
      height: input.padTop + laneGap * laneCount + input.padBottom,
      order: [],
      ticks: [],
    };
  }

  const y = input.lanes.map(
    (lane) => laneY[Math.min(laneCount - 1, Math.max(0, lane))] ?? laneY[0],
  );

  // 时间范围：全部无效时退回「按序号」，保证仍能排出位置
  const validTimes = input.times.filter((time): time is number => time !== null);
  const hasTime = validTimes.length > 0;
  const minTime = hasTime ? Math.min(...validTimes) : 0;
  const maxTime = hasTime ? Math.max(...validTimes) : count - 1;
  const span = Math.max(1, maxTime - minTime);

  // 最密泳道决定宽度：保证平均间距不小于「卡片宽 + 间隙」
  const perLane = new Map<number, number>();
  for (const lane of input.lanes) {
    perLane.set(lane, (perLane.get(lane) ?? 0) + 1);
  }
  const densest = Math.max(1, ...perLane.values());
  const neededWidth = densest * (cardWidth + cardGap);
  const timeWidth = hasTime ? (span / DAY_MS) * (input.minPxPerDay ?? DEFAULT_MIN_PX_PER_DAY) : 0;
  const contentWidth = Math.max(input.minWidth ?? DEFAULT_MIN_WIDTH, neededWidth, timeWidth);
  const scale = contentWidth / span;

  const x = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    const time = input.times[index];
    x[index] = padLeft + (time === null ? 0 : (time - minTime) * scale);
  }

  // 同泳道最小间距：按 x 升序逐条推，避免局部扎堆时卡片重叠
  const byLane = new Map<number, number[]>();
  for (let index = 0; index < count; index += 1) {
    const lane = input.lanes[index];
    const list = byLane.get(lane);
    if (list) {
      list.push(index);
    } else {
      byLane.set(lane, [index]);
    }
  }
  for (const list of byLane.values()) {
    list.sort((a, b) => x[a] - x[b] || a - b);
    for (let k = 1; k < list.length; k += 1) {
      const previous = list[k - 1];
      const current = list[k];
      const minX = x[previous] + cardWidth + cardGap;
      if (x[current] < minX) {
        x[current] = minX;
      }
    }
  }

  const rightmost = Math.max(...x);
  const width = rightmost + cardWidth + padRight;

  const order = Array.from({ length: count }, (_, index) => index).sort(
    (a, b) => x[a] - x[b] || a - b,
  );

  return {
    x,
    y,
    laneY,
    width,
    height: input.padTop + laneGap * laneCount + input.padBottom,
    order,
    ticks: hasTime ? buildTicks(minTime, maxTime, scale, padLeft) : [],
  };
}

/**
 * 可视区裁剪：返回 `order` 数组上的 [start, end) 区间。
 *
 * 用二分定位「第一张右边缘进入视口的卡片」，再向后走卡片宽度 + 间隙的距离，
 * 因此每帧代价是 O(log n + 可见数)，与总提交数无关。
 */
export function visibleCardRange(
  layout: Pick<HorizontalTimeline, "x" | "order">,
  scrollLeft: number,
  viewportWidth: number,
  cardWidth: number,
  overscan = 2,
): { start: number; end: number } {
  const total = layout.order.length;
  if (total === 0 || viewportWidth <= 0) {
    return { start: 0, end: 0 };
  }
  const left = scrollLeft - cardWidth;
  const right = scrollLeft + viewportWidth;

  // 二分：order 上第一个 x >= left 的位置
  let low = 0;
  let high = total;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (layout.x[layout.order[middle]] < left) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const first = low;

  let last = first;
  while (last < total && layout.x[layout.order[last]] <= right) {
    last += 1;
  }

  return {
    start: Math.max(0, first - overscan),
    end: Math.min(total, last + overscan),
  };
}
