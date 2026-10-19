// 拖拽到边缘时的自动滚动：纯函数，供芯片条（横向）与提交画布（纵向）共用。
// 为什么需要它：分支多时芯片条会横向溢出，被裁在视口外的芯片根本拖不到；
// 提交多时画布也拖不到可视区外的落点——「拖到边缘就自己滚」是这类画布交互的必备行为。

/** 边缘触发带宽度（px）：指针进入距边界这么近的范围就开始滚动。 */
export const EDGE_SCROLL_BAND = 56;

/** 每帧最大滚动步长（px）：再快就会「甩过头」，落点不可控。 */
export const EDGE_SCROLL_MAX_STEP = 16;

/**
 * 计算一帧的自动滚动步长。
 *
 * @param pointer 指针在滚动轴上的坐标（viewport 坐标）
 * @param start   滚动容器在该轴上的起点（左 / 上）
 * @param end     滚动容器在该轴上的终点（右 / 下）
 * @returns 负值 = 向起点方向滚，正值 = 向终点方向滚，0 = 不滚
 *
 * 越靠近边缘越快（线性）；指针越过容器边界时按最大步长钳制。
 * 容器比两条边带还窄时直接不滚：两侧带重叠会让方向在相邻帧里反复翻转。
 */
export function edgeScrollStep(
  pointer: number,
  start: number,
  end: number,
  band: number = EDGE_SCROLL_BAND,
  maxStep: number = EDGE_SCROLL_MAX_STEP,
): number {
  if (band <= 0 || end - start <= band * 2) {
    return 0;
  }
  if (pointer < start + band) {
    const ratio = (start + band - pointer) / band;
    return -Math.min(maxStep, Math.max(2, Math.round(ratio * maxStep)));
  }
  if (pointer > end - band) {
    const ratio = (pointer - (end - band)) / band;
    return Math.min(maxStep, Math.max(2, Math.round(ratio * maxStep)));
  }
  return 0;
}
