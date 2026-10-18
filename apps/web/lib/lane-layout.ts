// 服务端泳道布局缓存（TODO-246）。
//
// 背景：`computeLaneLayout` 对万级满并发提交约 190ms（见 M4-2 基准），
// 深分页时客户端每「加载更多」一页就全量重算一次（代价随已加载量线性增长）。
// 该模块把布局计算搬到服务端并按「提交集合内容指纹」缓存：
//
// - 指纹 = 提交序列的 oid + parents 内容哈希（与仓库 / 分支 / 页码无关），
//   同一集合（含客户端深分页累积集合、切分支后再切回）稳定命中；
// - 布局是纯函数派生物，不落 Postgres：共享缓存表存大 JSON 会迅速膨胀，
//   按实例内存 LRU（上限 20 条 ≈ 万级布局最坏约 10MB）+ 10 分钟 TTL 即可，
//   未命中时按基准的 ~190ms 上限重算，可接受；
// - 单例挂 globalThis，与 data-stores 同套路，避免 dev 热重载反复清空。

import { computeLaneLayout, type CommitLike, type LaneLayout } from "@utf8-git/git-graph";

import { TtlCache, cacheKey } from "./server-cache";

/** 布局缓存 TTL：与提交详情缓存同档（派生物随提交列表过期即可）。 */
export const LANE_LAYOUT_CACHE_TTL_MS = 10 * 60 * 1000;
/**
 * 布局缓存条数上限：万级满并发布局的序列化结果约 500KB，
 * 20 条最坏约 10MB；超出按 LRU 淘汰（重算成本有界，可直接丢）。
 */
export const LANE_LAYOUT_CACHE_MAX_ENTRIES = 20;

const globalForLaneLayout = globalThis as unknown as {
  __utf8gitLaneLayoutCache?: TtlCache<LaneLayout>;
};

/** 泳道布局缓存单例（进程内；dev 热重载不丢）。 */
export function getLaneLayoutCache(): TtlCache<LaneLayout> {
  if (!globalForLaneLayout.__utf8gitLaneLayoutCache) {
    globalForLaneLayout.__utf8gitLaneLayoutCache = new TtlCache<LaneLayout>({
      ttlMs: LANE_LAYOUT_CACHE_TTL_MS,
      maxEntries: LANE_LAYOUT_CACHE_MAX_ENTRIES,
    });
  }
  return globalForLaneLayout.__utf8gitLaneLayoutCache;
}

/**
 * 提交集合的内容指纹。
 *
 * 双 32 位 FNV-1a（不同偏移基）拼接成 64 位量级的十六进制串，加长度与前
 * 后各一个 oid，碰撞概率可忽略；比直接拼全量 oid 串作键短得多
 * （万级提交 ~420KB → 24 字符）。
 *
 * 输入顺序即布局顺序（拓扑序），顺序不同视为不同集合。
 */
export function laneLayoutFingerprint(commits: CommitLike[]): string {
  let hashA = 0x811c9dc5;
  let hashB = 0x01000193;
  const length = commits.length;
  const first = length > 0 ? commits[0]!.oid : "";
  const last = length > 0 ? commits[length - 1]!.oid : "";
  for (const commit of commits) {
    for (const part of [commit.oid, ...commit.parents]) {
      for (let index = 0; index < part.length; index += 1) {
        const code = part.charCodeAt(index);
        hashA ^= code;
        hashA = Math.imul(hashA, 0x01000193) >>> 0;
        hashB = (Math.imul(hashB ^ code, 0x85ebca6b) + 0x27d4eb2f) >>> 0;
      }
      // 字段分隔符，避免 ["ab","c"] 与 ["a","bc"] 同哈希
      hashA ^= 0x1f;
      hashA = Math.imul(hashA, 0x01000193) >>> 0;
      hashB = (Math.imul(hashB ^ 0x1f, 0x85ebca6b) + 0x27d4eb2f) >>> 0;
    }
  }
  return cacheKey(length, first, last, hashA.toString(16).padStart(8, "0"), hashB.toString(16).padStart(8, "0"));
}

export type CachedLaneLayout = {
  /** 布局结果（命中缓存时为缓存对象，调用方不得修改）。 */
  layout: LaneLayout;
  /** 是否命中缓存（false = 本次新算；可用于观测与日志）。 */
  cached: boolean;
  /** 内容指纹。 */
  fingerprint: string;
};

/**
 * 计算（或命中缓存地取得）提交集合的泳道布局。
 *
 * 纯内存副作用：未命中时写入 LRU 缓存。缓存条目是同一布局对象的共享引用，
 * 消费方按只读使用（渲染切片均为拷贝，见 `sliceLaneLayout`）。
 *
 * 过期条目照样服务：指纹相同 ⇒ 提交集合相同 ⇒ 布局必然一致（纯函数），
 * 服务陈旧项优于按 ~190ms 上限重算；集合变化时指纹变化，自然走到重算路径。
 */
export function computeCachedLaneLayout(
  commits: CommitLike[],
  deps: { cache?: TtlCache<LaneLayout>; now?: () => number } = {},
): CachedLaneLayout {
  const cache = deps.cache ?? getLaneLayoutCache();
  const fingerprint = laneLayoutFingerprint(commits);
  const hit = cache.get(fingerprint);
  if (hit) {
    // 过期条目不删：布局是纯派生物，陈旧一档仍可渲染，调用方按 cached 语义展示
    return { layout: hit.value, cached: true, fingerprint };
  }
  const layout = computeLaneLayout(commits);
  cache.set(fingerprint, layout);
  return { layout, cached: false, fingerprint };
}
