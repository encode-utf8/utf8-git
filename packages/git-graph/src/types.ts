/**
 * 提交图的输入节点：对应 GitHub GraphQL `Commit` 的最小字段集。
 */
export interface CommitLike {
  oid: string;
  parents: string[];
}

/**
 * 泳道布局结果：每个提交的列号与颜色。
 * 完整布局算法（merge / root / 多父 / rebase 等边界）见技术分析 §7，于 M2-1 落地。
 */
export interface LaneAssignment {
  oid: string;
  lane: number;
  color: string;
}
