// M4-2 性能基准（TODO-242）：1000 / 10000 节点下的泳道布局与窗口切片吞吐。
//
// 与 `layout.perf.test.ts`（CI 护栏，断言预算、防退化）互补：这里不做绝对断言，
// 只采样并打印 Markdown 表，用于回答「这次改动让大仓库更慢了吗」、归档基线数字。
//
// 为什么不用 Vitest 的 `bench` fixture：其单行统计表依赖 reporter 的终端渲染，
// 在管道 / CI 下会丢表格。这里自行采样并输出，口径与 scripts/perf-validate.mjs 一致。
//
// 运行：
//   pnpm --filter @utf8-git/git-graph bench
//   pnpm --filter @utf8-git/git-graph bench -t 10000   # 只跑万级用例
//
// 指标：每个用例预热后采样 `ROUNDS` 轮，报告 min / median / p99（ms）。
// 机器噪声大时看 median / p99 与相对倍率，不要只看单次绝对值。

import { describe, expect, test } from "vitest";

import { computeLaneLayout, sliceLaneLayout } from "./layout";
import { makeBranchyHistory, makeLinearHistory } from "./synthetic-history";
import type { CommitLike, LaneLayout } from "./types";

/** 与 apps/web/lib/virtual-window.ts 的视口窗口一致（600px / 76px 行高 + overscan）。 */
const WINDOW_SIZE = 21;
/** 预热轮数：让 V8 完成 JIT 预热，避免把首次编译耗时算进结果。 */
const WARMUP = 5;
/** 采样轮数：中位数 / p99 才有意义。 */
const ROUNDS = 25;

// 该文件只在 Node 下作为基准脚本运行。算法包本身浏览器无关（不引 @types/node），
// 这里按需取用运行时已有的极小子集：高精度计时与标准输出。
const now = (): number =>
  (globalThis as unknown as { performance: { now(): number } }).performance.now();
const writeOut = (chunk: string): void => {
  (
    globalThis as unknown as { process: { stdout: { write(text: string): void } } }
  ).process.stdout.write(chunk);
};

/**
 * 规模拆分保证节点数是精确值：分支历史节点数 = `branches × (commitsPerBranch + 1) + 1`。
 * - 1000 节点：27 × 37 + 1；10000 节点：99 × 101 + 1。
 */
const CASES: { label: string; make: () => CommitLike[] }[] = [
  { label: "深链（1 泳道）", make: () => makeLinearHistory(1000) },
  {
    label: "分支合并（默认并发 6）",
    make: () => makeBranchyHistory({ branches: 27, commitsPerBranch: 36 }),
  },
  {
    label: "合并风暴（满并发）",
    make: () => makeBranchyHistory({ branches: 27, commitsPerBranch: 36, concurrent: 27 }),
  },
  { label: "深链（1 泳道）", make: () => makeLinearHistory(10000) },
  {
    label: "分支合并（默认并发 6）",
    make: () => makeBranchyHistory({ branches: 99, commitsPerBranch: 100 }),
  },
  {
    label: "合并风暴（满并发）",
    make: () => makeBranchyHistory({ branches: 99, commitsPerBranch: 100, concurrent: 99 }),
  },
];

type Stats = { min: number; median: number; p99: number };

/** 预热后采样 `ROUNDS` 轮，返回 min / median / p99（ms）。 */
function measure(run: () => unknown): Stats {
  for (let index = 0; index < WARMUP; index += 1) run();
  const samples: number[] = [];
  for (let index = 0; index < ROUNDS; index += 1) {
    const startedAt = now();
    run();
    samples.push(now() - startedAt);
  }
  samples.sort((left, right) => left - right);
  const percentile = (value: number): number =>
    samples[Math.min(samples.length - 1, Math.ceil((value / 100) * samples.length) - 1)]!;
  return { min: samples[0]!, median: percentile(50), p99: percentile(99) };
}

/** 保留 3 位有效数字，避免表格被浮点尾巴撑爆。 */
function ms(value: number): string {
  if (value >= 100) return value.toFixed(1);
  if (value >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

interface Row {
  size: number;
  label: string;
  lanes: number;
  layout: Stats;
  slice: Stats;
}

function runCase(item: (typeof CASES)[number]): Row {
  // 输入与整体布局在计时外一次性备好：只测「整仓布局」与「每帧切片」本身。
  const commits = item.make();
  const layout: LaneLayout = computeLaneLayout(commits);
  const middle = Math.floor(commits.length / 2);
  const start = Math.max(0, middle - Math.floor(WINDOW_SIZE / 2));
  const end = start + WINDOW_SIZE;

  return {
    size: commits.length,
    label: item.label,
    lanes: layout.laneCount,
    layout: measure(() => computeLaneLayout(commits)),
    slice: measure(() => sliceLaneLayout(layout, start, end)),
  };
}

function toMarkdown(rows: Row[]): string {
  const lines: string[] = [];
  lines.push(`# M4-2 泳道布局基准`);
  lines.push("");
  lines.push(`- 采样方式：预热 ${WARMUP} 轮后采样 ${ROUNDS} 轮，取 min / median / p99（ms）`);
  lines.push(`- 窗口切片：${WINDOW_SIZE} 行（与 apps/web/lib/virtual-window.ts 视口一致）`);
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push("");
  lines.push("| 规模 | 场景 | 泳道 | 布局 min | 布局 median | 布局 p99 | 切片 median | 切片 p99 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    lines.push(
      `| ${row.size} | ${row.label} | ${row.lanes} | ${ms(row.layout.min)} | ${ms(
        row.layout.median,
      )} | ${ms(row.layout.p99)} | ${ms(row.slice.median)} | ${ms(row.slice.p99)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

describe("泳道布局基准（1000 / 10000 节点）", () => {
  test("输出布局与切片耗时", () => {
    const rows = CASES.map(runCase);
    // 结构性断言：确保基准跑在预期的输入规模上（若生成器改造导致规模漂移，这里先发现）。
    expect(rows.map((row) => row.size)).toEqual([1000, 1000, 1000, 10000, 10000, 10000]);
    expect(rows[3]!.lanes).toBe(1);
    expect(rows[5]!.lanes).toBe(100);
    writeOut(`\n${toMarkdown(rows)}\n`);
  });
});
