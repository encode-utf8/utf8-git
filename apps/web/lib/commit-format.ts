// 提交节点格式化工具（纯函数；时间戳一律以 UTC 呈现，避免 SSR / CSR 时区不一致）

// 短 SHA：取前 7 位
export function shortSha(sha: string): string {
  return sha.length <= 7 ? sha : sha.slice(0, 7);
}

// 相对时间：刚刚 / X 分钟前 / X 小时前 / X 天前；超过 30 天回退到日期
export function formatRelativeTime(fromMs: number, toMs: number): string {
  const diff = Math.max(0, toMs - fromMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) {
    return "刚刚";
  }
  if (diff < hour) {
    return `${Math.floor(diff / minute)} 分钟前`;
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)} 小时前`;
  }
  if (diff < 30 * day) {
    return `${Math.floor(diff / day)} 天前`;
  }
  return new Date(fromMs).toISOString().slice(0, 10);
}

// 绝对时间：YYYY-MM-DD HH:mm（UTC）
export function formatUtcDateTime(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) {
    return "—";
  }
  return new Date(time).toISOString().slice(0, 16).replace("T", " ");
}
