// 服务端内存 TTL 缓存（仅性能优化，不作离线数据源）
// - 过期条目不立即删除：限流降级时仍可读取旧数据（标记 stale 后展示）
// - 超出容量按最近最少使用（LRU）淘汰
// - 单例由 data-stores.ts 挂到 globalThis，避免 dev 热重载反复清空

export type CacheLookup<V> = {
  value: V;
  storedAt: number;
  fresh: boolean;
};

export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; storedAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: { ttlMs: number; maxEntries?: number; now?: () => number }) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 500;
    this.now = options.now ?? Date.now;
  }

  get(key: string): CacheLookup<V> | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    // LRU：命中后移到队尾
    this.entries.delete(key);
    this.entries.set(key, entry);
    return {
      value: entry.value,
      storedAt: entry.storedAt,
      fresh: this.now() - entry.storedAt < this.ttlMs,
    };
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

// 缓存键拼接：用 NUL 分隔，避免不同字段组合产生歧义
export function cacheKey(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => (part === null || part === undefined ? "" : String(part)))
    .join("\u0000");
}
