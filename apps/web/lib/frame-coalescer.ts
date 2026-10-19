// 把高频事件合并成「每帧最多一次」回调。
//
// 为什么需要：pointermove 在高刷屏上可达 120Hz，而浏览器每帧只画一次。
// 每个事件都 setState 意味着两帧之间可能渲染两次，中间那次用户根本看不到——
// 拖拽时这笔开销会随节点数放大（虚拟窗口、泳道图、工具栏都要重算）。
//
// 调度函数可注入，便于在单测里用「手动 flush」代替真实 rAF。

export type FrameCoalescer<T> = {
  /** 记下最新值；同一帧内多次调用只会触发一次回调，且用的是最后一个值。 */
  push: (value: T) => void;
  /** 取消尚未触发的回调并丢弃挂起的值（拖动结束 / 取消时调用）。 */
  cancel: () => void;
};

export function createFrameCoalescer<T>(
  apply: (value: T) => void,
  schedule: (callback: () => void) => number = (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
): FrameCoalescer<T> {
  let handle: number | null = null;
  let pending: T | null = null;
  let hasPending = false;

  const flush = () => {
    handle = null;
    if (!hasPending) {
      return;
    }
    const value = pending as T;
    pending = null;
    hasPending = false;
    apply(value);
  };

  return {
    push(value) {
      pending = value;
      hasPending = true;
      if (handle === null) {
        handle = schedule(flush);
      }
    },
    cancel() {
      if (handle !== null) {
        cancelFrame(handle);
        handle = null;
      }
      pending = null;
      hasPending = false;
    },
  };
}
