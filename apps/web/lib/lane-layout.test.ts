import { describe, expect, it } from "vitest";
import { computeLaneLayout } from "@utf8-git/git-graph";

import {
  computeCachedLaneLayout,
  getLaneLayoutCache,
  laneLayoutFingerprint,
  LANE_LAYOUT_CACHE_MAX_ENTRIES,
  LANE_LAYOUT_CACHE_TTL_MS,
} from "./lane-layout";
import { TtlCache } from "./server-cache";
import type { LaneLayout } from "@utf8-git/git-graph";

const linear = [
  { oid: "A", parents: ["B"] },
  { oid: "B", parents: ["C"] },
  { oid: "C", parents: [] },
];

const branchy = [
  { oid: "A", parents: ["B", "X"] },
  { oid: "B", parents: [] },
  { oid: "X", parents: [] },
];

describe("laneLayoutFingerprint", () => {
  it("相同集合（不同数组实例）得到相同指纹", () => {
    expect(laneLayoutFingerprint(linear)).toBe(laneLayoutFingerprint([...linear]));
  });

  it("顺序、oid、parents 任一不同都会改变指纹", () => {
    const base = laneLayoutFingerprint(linear);
    expect(laneLayoutFingerprint([...linear].reverse())).not.toBe(base);
    expect(laneLayoutFingerprint(branchy)).not.toBe(base);
    // parents 不同（同 oid）也算不同集合
    expect(laneLayoutFingerprint([{ oid: "A", parents: ["B"] }])).not.toBe(
      laneLayoutFingerprint([{ oid: "A", parents: ["C"] }]),
    );
  });

  it('字段边界不歧义（["ab","c"] 与 ["a","bc"]）', () => {
    expect(laneLayoutFingerprint([{ oid: "ab", parents: ["c"] }])).not.toBe(
      laneLayoutFingerprint([{ oid: "a", parents: ["bc"] }]),
    );
  });

  it("空集合有稳定指纹且长度有界", () => {
    const fingerprint = laneLayoutFingerprint([]);
    expect(fingerprint).toBe(laneLayoutFingerprint([]));
    expect(fingerprint.length).toBeLessThan(64);
  });

  it("万级集合的指纹远小于原始内容（缓存键可接受）", () => {
    const commits = Array.from({ length: 10_000 }, (_, index) => ({
      oid: `oid-${index.toString(36)}`,
      parents: index === 9_999 ? [] : [`oid-${(index + 1).toString(36)}`],
    }));
    const fingerprint = laneLayoutFingerprint(commits);
    expect(fingerprint.length).toBeLessThan(64);
    expect(laneLayoutFingerprint(commits)).toBe(fingerprint);
  });
});

describe("computeCachedLaneLayout", () => {
  function freshCache(now = () => 0) {
    return new TtlCache<LaneLayout>({
      ttlMs: LANE_LAYOUT_CACHE_TTL_MS,
      maxEntries: LANE_LAYOUT_CACHE_MAX_ENTRIES,
      now,
    });
  }

  it("首次计算：未命中且结果与全量算法一致", () => {
    const result = computeCachedLaneLayout(branchy, { cache: freshCache() });
    expect(result.cached).toBe(false);
    expect(result.layout).toEqual(computeLaneLayout(branchy));
  });

  it("同集合再次请求命中缓存并返回同一布局对象", () => {
    const cache = freshCache();
    const first = computeCachedLaneLayout(linear, { cache });
    const second = computeCachedLaneLayout([...linear], { cache });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.layout).toBe(first.layout);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("不同集合互不干扰", () => {
    const cache = freshCache();
    const a = computeCachedLaneLayout(linear, { cache });
    const b = computeCachedLaneLayout(branchy, { cache });
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(false);
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(a.layout).not.toBe(b.layout);
  });

  it("TTL 过期后仍服务同一集合（布局由集合唯一决定，陈旧项与重算一致）", () => {
    let now = 0;
    const cache = freshCache(() => now);
    const first = computeCachedLaneLayout(linear, { cache });
    now = LANE_LAYOUT_CACHE_TTL_MS + 1;
    const second = computeCachedLaneLayout(linear, { cache });
    expect(first.cached).toBe(false);
    // 指纹相同 ⇒ 布局必然相同，服务陈旧项优于重算（~190ms）
    expect(second.cached).toBe(true);
    expect(second.layout).toEqual(computeLaneLayout(linear));
  });

  it("集合变化后即使是新条目也照常计算", () => {
    let now = 0;
    const cache = freshCache(() => now);
    computeCachedLaneLayout(linear, { cache });
    now = LANE_LAYOUT_CACHE_TTL_MS + 1;
    const other = computeCachedLaneLayout([...branchy, ...linear], { cache });
    expect(other.cached).toBe(false);
    expect(other.layout).toEqual(computeLaneLayout([...branchy, ...linear]));
  });

  it("超出容量按 LRU 淘汰：最早的条目被重算", () => {
    const cache = new TtlCache<LaneLayout>({ ttlMs: LANE_LAYOUT_CACHE_TTL_MS, maxEntries: 1 });
    const a = computeCachedLaneLayout(linear, { cache });
    computeCachedLaneLayout(branchy, { cache });
    const aAgain = computeCachedLaneLayout(linear, { cache });
    expect(a.cached).toBe(false);
    expect(aAgain.cached).toBe(false);
    expect(aAgain.layout).toEqual(a.layout);
  });

  it("默认使用进程内单例缓存", () => {
    const cache = getLaneLayoutCache();
    expect(cache).toBe(getLaneLayoutCache());
    const first = computeCachedLaneLayout(branchy);
    expect(first.cached).toBe(false);
    const second = computeCachedLaneLayout([...branchy]);
    expect(second.cached).toBe(true);
    expect(second.layout).toBe(first.layout);
  });
});
