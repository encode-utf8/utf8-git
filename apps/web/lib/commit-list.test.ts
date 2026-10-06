import { describe, expect, it } from "vitest";

import { mergeCommits } from "./commit-list";
import type { TimelineCommit } from "./github-timeline";

function commit(oid: string): TimelineCommit {
  return {
    oid,
    headline: `提交 ${oid}`,
    committedDate: "2026-10-06T00:00:00Z",
    author: { login: "u", name: "u", avatarUrl: null },
    parents: [],
    pullRequests: [],
  };
}

describe("mergeCommits", () => {
  it("追加新提交并保持顺序", () => {
    const merged = mergeCommits([commit("a"), commit("b")], [commit("c"), commit("d")]);
    expect(merged.map((item) => item.oid)).toEqual(["a", "b", "c", "d"]);
  });

  it("按 oid 去重（分页边界重复不追加）", () => {
    const merged = mergeCommits([commit("a"), commit("b")], [commit("b"), commit("c")]);
    expect(merged.map((item) => item.oid)).toEqual(["a", "b", "c"]);
  });

  it("incoming 内自身重复也去重", () => {
    const merged = mergeCommits([], [commit("a"), commit("a")]);
    expect(merged.map((item) => item.oid)).toEqual(["a"]);
  });
});
