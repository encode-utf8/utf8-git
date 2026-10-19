import { describe, expect, it } from "vitest";

import { EMPTY_TIMELINE_FILTER } from "./timeline-filters";
import { decodeTimelineShare, encodeTimelineShare, mergeShareFilters } from "./timeline-share";

const base = {
  branch: null,
  filters: EMPTY_TIMELINE_FILTER,
  density: "compact" as const,
  explain: "off" as const,
};

describe("encodeTimelineShare", () => {
  it("默认状态得到空查询串", () => {
    expect(encodeTimelineShare(base).toString()).toBe("");
  });

  it("只写非默认字段", () => {
    const params = encodeTimelineShare({
      branch: "feature/x",
      filters: { ...EMPTY_TIMELINE_FILTER, query: "  fix  ", kind: "merge" },
      density: "comfy",
      explain: "beginner",
    });
    expect(params.get("branch")).toBe("feature/x");
    expect(params.get("q")).toBe("fix"); // 首尾空白去掉
    expect(params.get("kind")).toBe("merge");
    expect(params.get("density")).toBe("comfy");
    expect(params.get("explain")).toBe("beginner");
    expect(params.get("author")).toBeNull();
    expect(params.get("range")).toBeNull();
  });

  it("自定义时间窗写出 from / to", () => {
    const params = encodeTimelineShare({
      ...base,
      filters: {
        ...EMPTY_TIMELINE_FILTER,
        range: "custom",
        window: { from: 1000, to: 2000 },
      },
    });
    expect(params.get("range")).toBe("custom");
    expect(params.get("from")).toBe("1000");
    expect(params.get("to")).toBe("2000");
  });
});

describe("decodeTimelineShare", () => {
  it("空查询串返回空补丁", () => {
    const patch = decodeTimelineShare(new URLSearchParams(""));
    expect(patch).toEqual({
      branch: null,
      filters: undefined,
      density: undefined,
      explain: undefined,
    });
  });

  it("编解码往返一致", () => {
    const state = {
      branch: "feature/e2e",
      filters: { ...EMPTY_TIMELINE_FILTER, query: "feat", author: "ada", kind: "issue" as const },
      density: "comfy" as const,
      explain: "beginner" as const,
    };
    const patch = decodeTimelineShare(encodeTimelineShare(state));
    expect(patch.branch).toBe("feature/e2e");
    expect(mergeShareFilters(patch.filters)).toEqual(state.filters);
    expect(patch.density).toBe("comfy");
    expect(patch.explain).toBe("beginner");
  });

  it("非法值一律丢弃（kind / range / density / explain）", () => {
    const patch = decodeTimelineShare(
      new URLSearchParams("kind=delete&range=year&density=huge&explain=expert"),
    );
    expect(patch.filters).toBeUndefined();
    expect(patch.density).toBeUndefined();
    expect(patch.explain).toBeUndefined();
  });

  it("from / to 两端颠倒时自动排序，并强制 custom", () => {
    const patch = decodeTimelineShare(new URLSearchParams("from=2000&to=1000&range=week"));
    expect(patch.filters?.window).toEqual({ from: 1000, to: 2000 });
    expect(patch.filters?.range).toBe("custom");
  });

  it("只有 custom 而没有窗口时丢弃 custom（它本来就不裁剪）", () => {
    const patch = decodeTimelineShare(new URLSearchParams("range=custom"));
    expect(patch.filters?.range).toBeUndefined();
  });

  it("非数字 / 负时间戳不算窗口", () => {
    expect(
      decodeTimelineShare(new URLSearchParams("from=abc&to=1000")).filters?.window,
    ).toBeUndefined();
    expect(
      decodeTimelineShare(new URLSearchParams("from=-5&to=1000")).filters?.window,
    ).toBeUndefined();
  });

  it("文本参数截断到 200 字符，空白查询被丢弃", () => {
    const long = "x".repeat(300);
    expect(decodeTimelineShare(new URLSearchParams({ q: long })).filters?.query).toHaveLength(200);
    expect(decodeTimelineShare(new URLSearchParams("q=%20%20")).filters?.query).toBeUndefined();
  });
});
