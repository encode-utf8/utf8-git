// 时间线显示密度（P0 画布改造）：用户可在「紧凑 36px」与「舒适 52px」之间切换。
// 只影响行高，不影响虚拟窗口与泳道布局算法——窗口按行高换算，换密度等价于换一屏能看多少条。

/** 显示密度：紧凑 / 舒适。 */
export type TimelineDensity = "compact" | "comfy";

/** 密度在 localStorage 中的键（与术语解释模式一样，只记住用户显式选择）。 */
export const TIMELINE_DENSITY_STORAGE_KEY = "utf8-git:timeline-density";

/** 未选择过的默认密度：一屏能看更多历史，符合「看图」而非「读列表」的定位。 */
export const DEFAULT_TIMELINE_DENSITY: TimelineDensity = "compact";

/** 各密度对应的固定行高（px）：虚拟滚动依赖固定行高，切换时整体重排。 */
export const TIMELINE_ROW_HEIGHT: Record<TimelineDensity, number> = {
  compact: 36,
  comfy: 52,
};

/** 密度选项的展示顺序（工具条分段控件按此渲染）。 */
export const TIMELINE_DENSITIES: readonly TimelineDensity[] = ["compact", "comfy"] as const;

export function isTimelineDensity(value: unknown): value is TimelineDensity {
  return value === "compact" || value === "comfy";
}

/** 解析存储值：无法识别（旧版本 / 被改写 / null）时回落到默认密度，不抛错。 */
export function parseTimelineDensity(value: string | null | undefined): TimelineDensity {
  return isTimelineDensity(value) ? value : DEFAULT_TIMELINE_DENSITY;
}

/** 密度 → 行高。集中在这里，避免各处重复写 36 / 52 的魔法数字。 */
export function timelineRowHeight(density: TimelineDensity): number {
  return TIMELINE_ROW_HEIGHT[density];
}
