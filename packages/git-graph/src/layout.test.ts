import { describe, expect, it } from "vitest";
import { pickBranchColor } from "./color";
import { computeLaneLayout } from "./layout";
import type { CommitLike, LaneLayout, LaneSegment } from "./types";

/** 按 oid 查找节点，便于断言。 */
function node(layout: LaneLayout, oid: string) {
  const found = layout.nodes.find((item) => item.oid === oid);
  if (!found) throw new Error(`节点 ${oid} 不存在`);
  return found;
}

/** 取某一「行带」上的全部线段（row 为线段上端所在行）。 */
function segmentsAt(layout: LaneLayout, row: number): LaneSegment[] {
  return layout.segments.filter((segment) => segment.row === row);
}

describe("computeLaneLayout", () => {
  it("空输入返回空布局", () => {
    const layout = computeLaneLayout([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.segments).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.laneCount).toBe(0);
  });

  it("线性历史：全部落在 0 号泳道且共用一条线颜色", () => {
    const commits: CommitLike[] = [
      { oid: "A", parents: ["B"] },
      { oid: "B", parents: ["C"] },
      { oid: "C", parents: [] },
    ];
    const layout = computeLaneLayout(commits);
    const color = pickBranchColor("A");
    expect(layout.nodes).toEqual([
      { oid: "A", lane: 0, color },
      { oid: "B", lane: 0, color },
      { oid: "C", lane: 0, color },
    ]);
    expect(layout.laneCount).toBe(1);
    expect(layout.segments).toEqual([
      { row: 0, fromLane: 0, toLane: 0, oid: "B", color, kind: "straight", truncated: false },
      { row: 1, fromLane: 0, toLane: 0, oid: "C", color, kind: "straight", truncated: false },
    ]);
    expect(layout.edges).toEqual([
      {
        fromOid: "A",
        toOid: "B",
        fromRow: 0,
        fromLane: 0,
        toRow: 1,
        toLane: 0,
        kind: "first-parent",
        color,
        truncated: false,
      },
      {
        fromOid: "B",
        toOid: "C",
        fromRow: 1,
        fromLane: 0,
        toRow: 2,
        toLane: 0,
        kind: "first-parent",
        color,
        truncated: false,
      },
    ]);
  });

  it("单个 root 提交：没有连线", () => {
    const layout = computeLaneLayout([{ oid: "R", parents: [] }]);
    expect(layout.nodes).toEqual([{ oid: "R", lane: 0, color: pickBranchColor("R") }]);
    expect(layout.segments).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.laneCount).toBe(1);
  });

  it("单次 merge（两个父提交）：分叉与汇入各产生一条斜线", () => {
    const commits: CommitLike[] = [
      { oid: "M", parents: ["A", "B"] },
      { oid: "A", parents: ["Base"] },
      { oid: "B", parents: ["Base"] },
      { oid: "Base", parents: [] },
    ];
    const layout = computeLaneLayout(commits);
    const colorM = pickBranchColor("M");
    const colorB = pickBranchColor("B");
    expect(node(layout, "M")).toEqual({ oid: "M", lane: 0, color: colorM });
    expect(node(layout, "A")).toEqual({ oid: "A", lane: 0, color: colorM });
    expect(node(layout, "B")).toEqual({ oid: "B", lane: 1, color: colorB });
    expect(node(layout, "Base")).toEqual({ oid: "Base", lane: 0, color: colorM });
    expect(layout.laneCount).toBe(2);

    expect(segmentsAt(layout, 0)).toEqual([
      { row: 0, fromLane: 0, toLane: 0, oid: "A", color: colorM, kind: "straight", truncated: false },
      { row: 0, fromLane: 0, toLane: 1, oid: "B", color: colorB, kind: "diagonal", truncated: false },
    ]);
    expect(segmentsAt(layout, 2)).toEqual([
      { row: 2, fromLane: 0, toLane: 0, oid: "Base", color: colorM, kind: "straight", truncated: false },
      { row: 2, fromLane: 1, toLane: 0, oid: "Base", color: colorB, kind: "diagonal", truncated: false },
    ]);

    expect(layout.edges.find((edge) => edge.fromOid === "M" && edge.toOid === "A")).toMatchObject({
      kind: "first-parent",
      toRow: 1,
      toLane: 0,
      truncated: false,
    });
    expect(layout.edges.find((edge) => edge.fromOid === "M" && edge.toOid === "B")).toMatchObject({
      kind: "merge",
      fromRow: 0,
      fromLane: 0,
      toRow: 2,
      toLane: 1,
      color: colorB,
      truncated: false,
    });
  });

  it("octopus merge（三个父提交）：每个父各占一条泳道", () => {
    const commits: CommitLike[] = [
      { oid: "O", parents: ["P1", "P2", "P3"] },
      { oid: "P1", parents: ["Root"] },
      { oid: "P2", parents: ["Root"] },
      { oid: "P3", parents: ["Root"] },
      { oid: "Root", parents: [] },
    ];
    const layout = computeLaneLayout(commits);
    expect(node(layout, "O").lane).toBe(0);
    expect(node(layout, "P1").lane).toBe(0);
    expect(node(layout, "P2").lane).toBe(1);
    expect(node(layout, "P3").lane).toBe(2);
    expect(node(layout, "Root").lane).toBe(0);
    expect(layout.laneCount).toBe(3);

    const mergeEdges = layout.edges.filter((edge) => edge.fromOid === "O" && edge.kind === "merge");
    expect(mergeEdges.map((edge) => edge.toOid)).toEqual(["P2", "P3"]);
    expect(mergeEdges.map((edge) => edge.toLane)).toEqual([1, 2]);
    expect(layout.edges.every((edge) => edge.truncated === false)).toBe(true);

    const band = segmentsAt(layout, 0);
    expect(band.map((segment) => segment.toLane)).toEqual([0, 1, 2]);
    expect(band.map((segment) => segment.oid)).toEqual(["P1", "P2", "P3"]);
    expect(band.map((segment) => segment.kind)).toEqual(["straight", "diagonal", "diagonal"]);
  });

  it("多个独立根：两条互不相干的历史各占一条泳道", () => {
    const commits: CommitLike[] = [
      { oid: "T1", parents: ["R1"] },
      { oid: "T2", parents: ["R2"] },
      { oid: "R1", parents: [] },
      { oid: "R2", parents: [] },
    ];
    const layout = computeLaneLayout(commits);
    expect(node(layout, "T1").lane).toBe(0);
    expect(node(layout, "T2").lane).toBe(1);
    expect(node(layout, "R1").lane).toBe(0);
    expect(node(layout, "R2").lane).toBe(1);
    expect(layout.laneCount).toBe(2);
    expect(layout.edges.map((edge) => `${edge.fromOid}->${edge.toOid}`)).toEqual(["T1->R1", "T2->R2"]);
  });

  it("分叉点：两个子提交共享同一父提交时于父处收束", () => {
    const commits: CommitLike[] = [
      { oid: "mainTip", parents: ["fork"] },
      { oid: "featTip", parents: ["fork"] },
      { oid: "fork", parents: ["root"] },
      { oid: "root", parents: [] },
    ];
    const layout = computeLaneLayout(commits);
    expect(node(layout, "mainTip").lane).toBe(0);
    expect(node(layout, "featTip").lane).toBe(1);
    expect(node(layout, "fork").lane).toBe(0);
    expect(node(layout, "root").lane).toBe(0);
    expect(layout.edges.map((edge) => `${edge.fromOid}->${edge.toOid}`)).toEqual([
      "mainTip->fork",
      "featTip->fork",
      "fork->root",
    ]);
    expect(segmentsAt(layout, 1)).toContainEqual({
      row: 1,
      fromLane: 1,
      toLane: 0,
      oid: "fork",
      color: pickBranchColor("featTip"),
      kind: "diagonal",
      truncated: false,
    });
  });

  it("rebase 后被遗弃的旧提交：形成一条独立的截断悬挂线", () => {
    const commits: CommitLike[] = [
      { oid: "newTip", parents: ["base"] },
      { oid: "oldTip", parents: ["oldBase"] },
      { oid: "base", parents: [] },
    ];
    const layout = computeLaneLayout(commits);
    expect(node(layout, "newTip").lane).toBe(0);
    expect(node(layout, "oldTip").lane).toBe(1);
    expect(node(layout, "base").lane).toBe(0);

    expect(layout.edges.find((edge) => edge.fromOid === "oldTip")).toMatchObject({
      toOid: "oldBase",
      kind: "first-parent",
      toRow: null,
      toLane: null,
      truncated: true,
    });
    expect(segmentsAt(layout, 2)).toEqual([
      {
        row: 2,
        fromLane: 1,
        toLane: 1,
        oid: "oldBase",
        color: pickBranchColor("oldTip"),
        kind: "straight",
        truncated: true,
      },
    ]);
  });

  it("父提交不在输入中（分页截断）：边标记 truncated 且连线越过底部", () => {
    const commits: CommitLike[] = [
      { oid: "A", parents: ["B"] },
      { oid: "B", parents: ["C"] },
    ];
    const layout = computeLaneLayout(commits);
    const color = pickBranchColor("A");
    expect(node(layout, "A").lane).toBe(0);
    expect(node(layout, "B").lane).toBe(0);
    expect(layout.edges.find((edge) => edge.toOid === "C")).toMatchObject({
      fromOid: "B",
      fromRow: 1,
      fromLane: 0,
      toRow: null,
      toLane: null,
      truncated: true,
    });
    expect(layout.segments).toEqual([
      { row: 0, fromLane: 0, toLane: 0, oid: "B", color, kind: "straight", truncated: false },
      { row: 1, fromLane: 0, toLane: 0, oid: "C", color, kind: "straight", truncated: true },
    ]);
  });

  it("确定性：相同输入得到相同结果，且不修改输入", () => {
    const commits: CommitLike[] = [
      { oid: "M", parents: ["A", "B"] },
      { oid: "A", parents: ["Base"] },
      { oid: "B", parents: ["Base"] },
      { oid: "Base", parents: [] },
    ];
    const snapshot = JSON.stringify(commits);
    const first = computeLaneLayout(commits);
    const second = computeLaneLayout(commits);
    expect(second).toEqual(first);
    expect(JSON.stringify(commits)).toBe(snapshot);
  });
});
