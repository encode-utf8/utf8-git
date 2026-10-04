const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32 位 FNV-1a 哈希：同一输入始终得到同一结果。 */
function fnv1a(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** 按分支名哈希取色：同名分支颜色稳定（技术分析 §7「分支着色」）。 */
export function pickBranchColor(branchName: string): string {
  const hue = fnv1a(branchName) % 360;
  return `hsl(${hue} 65% 55%)`;
}
