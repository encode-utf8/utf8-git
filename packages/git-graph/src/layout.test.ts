import { describe, expect, it } from "vitest";
import { pickBranchColor } from "./color";
import { LaneComputation, computeLaneLayout, sliceLaneLayout } from "./layout";
import { makeBranchyHistory, makeLinearHistory } from "./synthetic-history";
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
      {
        row: 0,
        fromLane: 0,
        toLane: 0,
        oid: "A",
        color: colorM,
        kind: "straight",
        truncated: false,
      },
      {
        row: 0,
        fromLane: 0,
        toLane: 1,
        oid: "B",
        color: colorB,
        kind: "diagonal",
        truncated: false,
      },
    ]);
    expect(segmentsAt(layout, 2)).toEqual([
      {
        row: 2,
        fromLane: 0,
        toLane: 0,
        oid: "Base",
        color: colorM,
        kind: "straight",
        truncated: false,
      },
      {
        row: 2,
        fromLane: 1,
        toLane: 0,
        oid: "Base",
        color: colorB,
        kind: "diagonal",
        truncated: false,
      },
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
    expect(layout.edges.map((edge) => `${edge.fromOid}->${edge.toOid}`)).toEqual([
      "T1->R1",
      "T2->R2",
    ]);
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
describe("sliceLaneLayout", () => {
  // 线性历史 A -> B -> C -> D：行带 0 / 1 / 2 分别连接相邻两行
  const linear: CommitLike[] = [
    { oid: "A", parents: ["B"] },
    { oid: "B", parents: ["C"] },
    { oid: "C", parents: ["D"] },
    { oid: "D", parents: [] },
  ];

  it("全量窗口等价于原布局", () => {
    const layout = computeLaneLayout(linear);
    const slice = sliceLaneLayout(layout, 0, layout.nodes.length);
    expect(slice.start).toBe(0);
    expect(slice.end).toBe(4);
    expect(slice.laneCount).toBe(layout.laneCount);
    expect(slice.nodes).toEqual(layout.nodes);
    expect(slice.segments).toEqual(layout.segments);
  });

  it("中间窗口只保留两端都在窗口内的行带", () => {
    const layout = computeLaneLayout(linear);
    const slice = sliceLaneLayout(layout, 1, 3);
    expect(slice.nodes.map((node) => node.oid)).toEqual(["B", "C"]);
    expect(slice.segments.map((segment) => segment.row)).toEqual([1]);
  });

  it("窗口末行若没有越底线段则不绘制（终点行在窗口之外）", () => {
    const layout = computeLaneLayout(linear);
    expect(sliceLaneLayout(layout, 0, 1).segments).toEqual([]);
  });

  it("末行悬挂段（父提交不在已加载集合）仍保留：它要画到窗口底部", () => {
    const truncated = computeLaneLayout([
      { oid: "A", parents: ["B"] },
      { oid: "B", parents: ["C"] }, // C 不在输入中
    ]);
    // 全量窗口下与原布局等价（含悬挂段）
    expect(sliceLaneLayout(truncated, 0, 2).segments).toEqual(truncated.segments);
    // 只切末行时，悬挂段不能被末行规则丢掉
    const slice = sliceLaneLayout(truncated, 1, 2);
    expect(slice.nodes.map((node) => node.oid)).toEqual(["B"]);
    expect(slice.segments).toHaveLength(1);
    expect(slice.segments[0]).toMatchObject({ row: 1, truncated: true });
  });

  it("越界与非法输入被钳制", () => {
    const layout = computeLaneLayout(linear);
    expect(sliceLaneLayout(layout, -5, 3)).toMatchObject({ start: 0, end: 3 });
    expect(sliceLaneLayout(layout, 2, 999)).toMatchObject({ start: 2, end: 4 });
    expect(sliceLaneLayout(layout, 3, 1)).toMatchObject({ start: 3, end: 3 });
    expect(sliceLaneLayout(layout, Number.NaN, 2)).toMatchObject({ start: 0, end: 2 });
    expect(sliceLaneLayout(layout, 1.7, 2.9)).toMatchObject({ start: 1, end: 2 });
  });

  it("空窗口 / 空布局返回空切片", () => {
    expect(sliceLaneLayout(computeLaneLayout([]), 0, 10)).toEqual({
      start: 0,
      end: 0,
      laneCount: 0,
      nodes: [],
      segments: [],
    });
    const layout = computeLaneLayout(linear);
    expect(sliceLaneLayout(layout, 2, 2)).toMatchObject({
      start: 2,
      end: 2,
      nodes: [],
      segments: [],
    });
  });

  it("laneCount 不随窗口变化（滚动时列宽稳定）", () => {
    const layout = computeLaneLayout([
      { oid: "M", parents: ["A", "B"] },
      { oid: "A", parents: ["Base"] },
      { oid: "B", parents: ["Base"] },
      { oid: "Base", parents: [] },
    ]);
    expect(layout.laneCount).toBe(2);
    expect(sliceLaneLayout(layout, 0, 1).laneCount).toBe(2);
    expect(sliceLaneLayout(layout, 3, 4).laneCount).toBe(2);
  });

  it("不修改入参", () => {
    const layout = computeLaneLayout(linear);
    const snapshot = JSON.stringify(layout);
    sliceLaneLayout(layout, 1, 3);
    expect(JSON.stringify(layout)).toBe(snapshot);
  });

  it("segments 按 row 升序（切片二分定位依赖的不变式）", () => {
    const layouts = [
      computeLaneLayout(linear),
      computeLaneLayout([
        { oid: "M", parents: ["A", "B"] },
        { oid: "A", parents: ["Base"] },
        { oid: "B", parents: ["Base"] },
        { oid: "Base", parents: [] },
      ]),
      computeLaneLayout(makeBranchyHistory({ branches: 12, commitsPerBranch: 7 })),
      computeLaneLayout(makeBranchyHistory({ branches: 12, commitsPerBranch: 7, concurrent: 12 })),
    ];
    for (const layout of layouts) {
      const rows = layout.segments.map((segment) => segment.row);
      expect(rows).toEqual([...rows].sort((left, right) => left - right));
    }
  });

  it("二分切片与朴素过滤在每个窗口上等价", () => {
    const layout = computeLaneLayout(
      makeBranchyHistory({ branches: 12, commitsPerBranch: 7, concurrent: 12 }),
    );
    const naive = (from: number, to: number) =>
      layout.segments.filter(
        (segment) =>
          segment.row >= from && segment.row < to && (segment.row + 1 < to || segment.truncated),
      );

    for (let from = 0; from <= layout.nodes.length; from += 1) {
      for (let to = from; to <= layout.nodes.length; to += 1) {
        expect(sliceLaneLayout(layout, from, to).segments).toEqual(naive(from, to));
      }
    }
  });
});

describe("makeBranchyHistory", () => {
  it("生成确定性的多分支历史，且父提交总是晚于子提交（拓扑序前提）", () => {
    const commits = makeBranchyHistory({ branches: 50, commitsPerBranch: 100 });
    // 50 条主干（每条含 1 个 merge）+ 50 × 100 条功能分支提交
    expect(commits).toHaveLength(5051);

    const rowByOid = new Map(commits.map((commit, index) => [commit.oid, index]));
    const violations = commits.flatMap((commit, index) =>
      commit.parents
        .filter((parent) => (rowByOid.get(parent) ?? -1) <= index)
        .map((parent) => `${commit.oid} → ${parent}`),
    );
    expect(violations).toEqual([]);

    const sample = { branches: 3, commitsPerBranch: 2 };
    expect(JSON.stringify(makeBranchyHistory(sample))).toBe(
      JSON.stringify(makeBranchyHistory(sample)),
    );
  });

  it("基准输入确实包含多条泳道", () => {
    const layout = computeLaneLayout(makeBranchyHistory({ branches: 50, commitsPerBranch: 100 }));
    expect(layout.nodes).toHaveLength(5051);
    // 默认并发 6：主干 1 条 + 功能分支 6 条左右
    expect(layout.laneCount).toBeGreaterThan(1);
    expect(layout.laneCount).toBeLessThanOrEqual(10);
    expect(layout.segments.length).toBeGreaterThan(5000);
  });
});

describe("LaneComputation", () => {
  /** 代表性输入：线性 / 多分支 / 多父合并都要覆盖。 */
  function samples(): Array<{ name: string; commits: CommitLike[] }> {
    return [
      { name: "空输入", commits: [] },
      { name: "单提交", commits: [{ oid: "A", parents: [] }] },
      {
        name: "线性历史",
        commits: makeLinearHistory(120),
      },
      {
        name: "多分支历史",
        commits: makeBranchyHistory({ branches: 8, commitsPerBranch: 12, concurrent: 4 }),
      },
      {
        name: "含截断父提交（分页场景）",
        commits: [
          { oid: "A", parents: ["B", "MISSING"] },
          { oid: "B", parents: ["C"] },
          { oid: "C", parents: [] },
        ],
      },
    ];
  }

  it("任意分段粒度下 finish() 与全量 computeLaneLayout 完全一致", () => {
    for (const { name, commits } of samples()) {
      const expected = computeLaneLayout(commits);
      for (const chunk of [1, 2, 7, 50, 1000]) {
        const computation = new LaneComputation();
        for (let index = 0; index < commits.length; index += chunk) {
          computation.push(commits.slice(index, index + chunk));
          // 每个中间快照的渲染面（节点 / 线段 / 泳道数）== 当前前缀的全量计算结果；
          // 语义边只含已可解析部分（未喂入父提交的边在 finish 时补齐，见下）
          const loaded = commits.slice(0, Math.min(index + chunk, commits.length));
          const snapshot = computation.snapshot();
          const prefixLayout = computeLaneLayout(loaded);
          expect(
            {
              nodes: snapshot.nodes,
              segments: snapshot.segments,
              laneCount: snapshot.laneCount,
            },
            `${name} / chunk=${chunk} / prefix=${loaded.length}`,
          ).toEqual({
            nodes: prefixLayout.nodes,
            segments: prefixLayout.segments,
            laneCount: prefixLayout.laneCount,
          });
        }
        expect(computation.finish(), `${name} / chunk=${chunk}`).toEqual(expected);
      }
    }
  });

  it("快照随分段推进：临时悬挂段在父提交喂入后转为正式线段", () => {
    const commits: CommitLike[] = [
      { oid: "A", parents: ["B"] },
      { oid: "B", parents: ["C"] },
      { oid: "C", parents: [] },
    ];
    const computation = new LaneComputation();
    computation.push(commits.slice(0, 2));
    const midSnapshot = computation.snapshot();
    // 只喂了 A、B：C 尚未出现 → 末行有一条临时悬挂线段（ truncated ）
    expect(midSnapshot.nodes.map((node) => node.oid)).toEqual(["A", "B"]);
    const hanging = midSnapshot.segments.filter((segment) => segment.truncated);
    expect(hanging).toHaveLength(1);
    expect(hanging[0]).toMatchObject({ row: 1, oid: "C" });
    computation.push(commits.slice(2));
    const final = computation.finish();
    // C 出现后：row 1 的线段不再是悬挂段，且整体与全量计算一致
    expect(final.segments.filter((segment) => segment.truncated)).toEqual([]);
    expect(final).toEqual(computeLaneLayout(commits));
  });

  it("快照对象在无新喂入时保持同一引用（React memo 友好）", () => {
    const computation = new LaneComputation();
    computation.push(makeLinearHistory(10));
    const first = computation.snapshot();
    expect(computation.snapshot()).toBe(first);
    computation.push(makeLinearHistory(20).slice(10));
    const second = computation.snapshot();
    expect(second).not.toBe(first);
    expect(computation.snapshot()).toBe(second);
  });

  it("前缀稳定性：追加更旧的提交不改变已有节点的列号与颜色", () => {
    const commits = makeBranchyHistory({ branches: 6, commitsPerBranch: 10, concurrent: 3 });
    const computation = new LaneComputation();
    computation.push(commits.slice(0, 37));
    const prefix = computation.snapshot();
    computation.push(commits.slice(37));
    const full = computation.finish();
    // 已喂入行的列号 / 颜色在追加后逐字段不变
    expect(full.nodes.slice(0, 37)).toEqual(prefix.nodes);
    // 最终截断段集合与全量计算一致
    expect(full.segments.filter((segment) => segment.truncated)).toEqual(
      computeLaneLayout(commits).segments.filter((segment) => segment.truncated),
    );
  });

  it("父提交在后续分段出现时，悬挂线段自动解除截断标记", () => {
    const commits: CommitLike[] = [
      { oid: "A", parents: ["B", "X"] }, // 第二条父线等待 X（第 3 行才喂入）
      { oid: "B", parents: [] },
      { oid: "X", parents: [] },
    ];
    const computation = new LaneComputation();
    computation.push(commits.slice(0, 2));
    const prefix = computation.snapshot();
    // X 尚未喂入：A 分叉出的那条线是悬挂段
    expect(prefix.segments.some((segment) => segment.truncated)).toBe(true);

    computation.push(commits.slice(2));
    const full = computation.finish();
    // X 出现后该线段不再是悬挂段，且整体与全量计算一致
    expect(full.segments.filter((segment) => segment.truncated)).toEqual([]);
    expect(full).toEqual(computeLaneLayout(commits));
  });

  it("重复 oid 的喂入被跳过（幂等）", () => {
    const commits = makeLinearHistory(5);
    const computation = new LaneComputation();
    computation.push(commits);
    computation.push(commits.slice(0, 3));
    computation.push([]);
    expect(computation.finish()).toEqual(computeLaneLayout(commits));
  });

  it("finish 之后重复 finish 返回同一布局，push 抛错", () => {
    const computation = new LaneComputation().push(makeLinearHistory(4));
    const first = computation.finish();
    expect(computation.finish()).toBe(first);
    expect(() => computation.push([{ oid: "X", parents: [] }])).toThrow(/已 finish/);
  });

  it("size / isFinished 反映喂入进度", () => {
    const computation = new LaneComputation();
    expect(computation.size).toBe(0);
    expect(computation.isFinished).toBe(false);
    computation.push(makeLinearHistory(3));
    expect(computation.size).toBe(3);
    computation.finish();
    expect(computation.isFinished).toBe(true);
    expect(computation.size).toBe(3);
  });
});
