import { describe, expect, it, vi } from "vitest";

import { createFrameCoalescer } from "./frame-coalescer";

/** 手动调度：收集待执行的回调，由测试决定何时「到帧」。 */
function manualScheduler() {
  let nextHandle = 1;
  const queued = new Map<number, () => void>();
  return {
    schedule: (callback: () => void) => {
      const handle = nextHandle++;
      queued.set(handle, callback);
      return handle;
    },
    cancel: (handle: number) => {
      queued.delete(handle);
    },
    /** 触发下一帧：把所有排队回调执行掉（模拟一次 rAF）。 */
    flush: () => {
      const callbacks = [...queued.values()];
      queued.clear();
      for (const callback of callbacks) {
        callback();
      }
    },
    pending: () => queued.size,
  };
}

describe("createFrameCoalescer", () => {
  it("同一帧内的多次 push 只回调一次，且取最后一个值", () => {
    const scheduler = manualScheduler();
    const apply = vi.fn();
    const coalescer = createFrameCoalescer(apply, scheduler.schedule, scheduler.cancel);

    coalescer.push(1);
    coalescer.push(2);
    coalescer.push(3);
    expect(apply).not.toHaveBeenCalled();

    scheduler.flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(3);
  });

  it("下一帧继续 push 会重新调度", () => {
    const scheduler = manualScheduler();
    const apply = vi.fn();
    const coalescer = createFrameCoalescer(apply, scheduler.schedule, scheduler.cancel);

    coalescer.push("a");
    scheduler.flush();
    coalescer.push("b");
    scheduler.flush();

    expect(apply.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("cancel 丢弃挂起的值且不再回调", () => {
    const scheduler = manualScheduler();
    const apply = vi.fn();
    const coalescer = createFrameCoalescer(apply, scheduler.schedule, scheduler.cancel);

    coalescer.push("x");
    coalescer.cancel();
    scheduler.flush();

    expect(apply).not.toHaveBeenCalled();
    expect(scheduler.pending()).toBe(0);
  });

  it("1 秒 1000 次事件、60fps 下回调 63 次（此前是 1000 次）", () => {
    // 复测口径：每次回调 = 一次 setState ≈ 一次渲染。
    // 1000 次 pointermove 按每 16 次一帧合并，落成 62 个整帧 + 最后一次收尾。
    const scheduler = manualScheduler();
    const apply = vi.fn();
    const coalescer = createFrameCoalescer(apply, scheduler.schedule, scheduler.cancel);

    for (let index = 0; index < 1000; index += 1) {
      coalescer.push(index);
      if (index % 16 === 15) {
        scheduler.flush();
      }
    }
    scheduler.flush();

    expect(apply).toHaveBeenCalledTimes(63);
    // 每次拿到的都是该帧的最后一个值
    expect(apply).toHaveBeenLastCalledWith(999);
  });

  it("没有 push 时 flush 不产生回调", () => {
    const scheduler = manualScheduler();
    const apply = vi.fn();
    createFrameCoalescer(apply, scheduler.schedule, scheduler.cancel);
    scheduler.flush();
    expect(apply).not.toHaveBeenCalled();
  });
});
