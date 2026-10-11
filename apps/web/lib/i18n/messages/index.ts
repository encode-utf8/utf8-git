import type { Locale } from "../config";
import { en } from "./en";
import { zhCN, type Messages } from "./zh-CN";

/** 消息目录的类型以中文（源语言）为准；`en` 用它约束，保证两种语言键完全一致。 */
export type { Messages } from "./zh-CN";

export const CATALOG: Record<Locale, Messages> = {
  "zh-CN": zhCN,
  en,
};
