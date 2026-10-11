// 提交节点格式化工具（纯函数；时间戳一律以 UTC 呈现，避免 SSR / CSR 时区不一致）
// 相对时间的文案取自消息目录 `time.*`，默认源语言，组件传入当前语言的 `t` 时随语言切换。

import { sourceTranslate, type Translate } from "./i18n/translate";

// 短 SHA：取前 7 位
export function shortSha(sha: string): string {
  return sha.length <= 7 ? sha : sha.slice(0, 7);
}

// 相对时间：刚刚 / X 分钟前 / X 小时前 / X 天前；超过 30 天回退到日期
export function formatRelativeTime(
  fromMs: number,
  toMs: number,
  t: Translate = sourceTranslate,
): string {
  const diff = Math.max(0, toMs - fromMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) {
    return t("time.justNow");
  }
  if (diff < hour) {
    return t("time.minutesAgo", { count: Math.floor(diff / minute) });
  }
  if (diff < day) {
    return t("time.hoursAgo", { count: Math.floor(diff / hour) });
  }
  if (diff < 30 * day) {
    return t("time.daysAgo", { count: Math.floor(diff / day) });
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
