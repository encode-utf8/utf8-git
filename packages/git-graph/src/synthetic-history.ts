// 合成历史生成器：为性能基准与窗口化测试提供确定性输入（纯函数、无随机）。
//
// 结构贴近真实仓库：一条主干 + 若干功能分支。每条功能分支自主干上稍晚的提交 fork，
// 再以一个 merge 提交回到主干；`concurrent` 控制主干上同时并存的功能分支数量，
// 因此并发泳道数约为 `concurrent + 1`。把它调到 `branches` 即可得到「合并风暴」极端输入。

import type { CommitLike } from "./types";

/** 合成历史规模描述。 */
export type SyntheticHistoryOptions = {
  /** 功能分支数量（每条分支线一个 merge 提交回到主干）。 */
  branches: number;
  /** 每条功能分支上的提交数量。 */
  commitsPerBranch: number;
  /** 主干上同时并存的功能分支数量（决定并发泳道数，默认 6）。 */
  concurrent?: number;
};

const DEFAULT_CONCURRENT = 6;

function trunkOid(index: number): string {
  return `t${index}`;
}

function featureOid(branch: number, step: number): string {
  return `f${branch}-${step}`;
}

/** 取正整数，非法 / 缺省时回退（合成输入不因脏参数产生奇怪规模）。 */
function positiveInt(value: unknown, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 生成确定性的「主干 + 功能分支」历史，子提交在前、父提交在后（满足拓扑序前提）。
 * 相同入参始终得到相同输出，便于基准对比与断言。
 */
export function makeBranchyHistory(options: SyntheticHistoryOptions): CommitLike[] {
  const branches = positiveInt(options.branches, 1);
  const commitsPerBranch = positiveInt(options.commitsPerBranch, 1);
  const concurrent = Math.min(branches, positiveInt(options.concurrent, DEFAULT_CONCURRENT));

  const parentsOf = new Map<string, string[]>();

  // 主干：t0 为 HEAD，t{branches} 为最早的根提交（不参与 merge，保证 fork 点严格早于 merge 点）
  for (let index = 0; index <= branches; index += 1) {
    parentsOf.set(trunkOid(index), index + 1 <= branches ? [trunkOid(index + 1)] : []);
  }

  for (let branch = 0; branch < branches; branch += 1) {
    // fork 点取主干上稍晚的提交：离 merge 点越远，该分支线存续越久（并发度越高）；
    // 上界取 branches（根提交），确保 fork 点严格早于 merge 点，避免 fork === merge 成环。
    const forkPoint = trunkOid(Math.min(branches, branch + concurrent));
    for (let step = 0; step < commitsPerBranch; step += 1) {
      parentsOf.set(
        featureOid(branch, step),
        step + 1 < commitsPerBranch ? [featureOid(branch, step + 1)] : [forkPoint],
      );
    }
    // merge 提交：主干 t{branch} 增加第二个父提交，指向该功能分支的起点
    const trunkParents = parentsOf.get(trunkOid(branch)) ?? [];
    parentsOf.set(trunkOid(branch), [...trunkParents, featureOid(branch, 0)]);
  }

  // 确定性拓扑序：自 HEAD 做后序 DFS，再整体反转，得到「子提交在前」的顺序
  const postOrder: string[] = [];
  const visited = new Set<string>();
  const visit = (oid: string): void => {
    if (visited.has(oid)) return;
    visited.add(oid);
    for (const parent of parentsOf.get(oid) ?? []) visit(parent);
    postOrder.push(oid);
  };
  visit(trunkOid(0));

  return postOrder.reverse().map((oid) => ({ oid, parents: parentsOf.get(oid) ?? [] }));
}
