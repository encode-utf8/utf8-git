// 限流快照存储（按用户隔离）：记录最近一次 GitHub 响应的配额剩余量与恢复时间。
// 用途：M1-4 限流降级——低于阈值时只读缓存并提示恢复时间，不再发新请求。

export type RateLimitSnapshot = {
  limit: number | null;
  remaining: number;
  resetAt: Date | null;
  cost: number | null;
  source: "rest" | "graphql";
  recordedAt: number;
};

export type DegradeDecision = {
  degrade: boolean;
  resetAt: Date | null;
  snapshot: RateLimitSnapshot | null;
};

export class RateLimitStore {
  private readonly snapshots = new Map<string, RateLimitSnapshot>();

  record(userId: string, snapshot: RateLimitSnapshot): void {
    this.snapshots.set(userId, snapshot);
  }

  get(userId: string): RateLimitSnapshot | null {
    return this.snapshots.get(userId) ?? null;
  }

  delete(userId: string): void {
    this.snapshots.delete(userId);
  }

  // 配额低于阈值且尚未到恢复时间 → 需要降级；已过恢复时间视为可尝试新请求
  shouldDegrade(userId: string, threshold: number, now: number = Date.now()): DegradeDecision {
    const snapshot = this.snapshots.get(userId) ?? null;
    if (!snapshot) {
      return { degrade: false, resetAt: null, snapshot: null };
    }
    const resetAtMs = snapshot.resetAt?.getTime() ?? null;
    if (resetAtMs !== null && resetAtMs <= now) {
      return { degrade: false, resetAt: snapshot.resetAt, snapshot };
    }
    return {
      degrade: snapshot.remaining <= threshold,
      resetAt: snapshot.resetAt,
      snapshot,
    };
  }
}
