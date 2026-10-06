// 虚拟滚动窗口计算（纯函数，便于单测）
// 固定行高方案：只渲染 [start, end) 区间，配合 translateY 占位保持滚动条高度。

export const DEFAULT_OVERSCAN = 6;

export type VirtualWindowInput = {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  total: number;
  overscan?: number;
};

export type VirtualWindow = {
  start: number;
  end: number;
  offsetY: number;
  totalHeight: number;
  visibleCount: number;
};

export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const { scrollTop, viewportHeight, rowHeight, total } = input;
  const overscan = input.overscan ?? DEFAULT_OVERSCAN;

  if (rowHeight <= 0 || total <= 0) {
    return { start: 0, end: 0, offsetY: 0, totalHeight: 0, visibleCount: 0 };
  }

  const totalHeight = total * rowHeight;
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  const safeScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
  const firstVisible = Math.floor(safeScrollTop / rowHeight);
  const start = Math.max(0, Math.min(firstVisible - overscan, total - 1));
  // 覆盖视口所需行数 + 上下 overscan + 1 行兜底
  const needed = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + overscan * 2 + 1;
  const end = Math.min(total, start + needed);

  return {
    start,
    end,
    offsetY: start * rowHeight,
    totalHeight,
    visibleCount: end - start,
  };
}
