// 提交列表工具（纯函数）

import type { TimelineCommit } from "./github-timeline";

// 追加一页提交并按 oid 去重（防止分页边界重复）
export function mergeCommits(
  existing: TimelineCommit[],
  incoming: TimelineCommit[],
): TimelineCommit[] {
  const seen = new Set(existing.map((commit) => commit.oid));
  const merged = [...existing];
  for (const commit of incoming) {
    if (!seen.has(commit.oid)) {
      seen.add(commit.oid);
      merged.push(commit);
    }
  }
  return merged;
}
