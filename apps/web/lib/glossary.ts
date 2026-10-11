// 概念解释层（M2-6）的术语结构与展示规则；词条文案在消息目录 `glossary.*` 下（随语言切换）。
// 解释层默认关闭，只有用户主动开启后才渲染，避免干扰熟悉 Git 的使用者。

import type { MessageKey } from "./i18n/translate";

export type GlossaryTermId =
  "author" | "sha" | "merge" | "branch" | "pull-request" | "issue" | "lane";

/** 术语难度：basic 面向新手，deep 面向进阶阅读；与语言无关。 */
export type GlossaryLevel = "basic" | "deep";

/** 解释模式：关闭 / 新手 / 进阶。 */
export type ExplainMode = "off" | "beginner" | "advanced";

/** 全部术语 id（顺序即界面展示顺序的参考）。 */
export const GLOSSARY_TERM_IDS: readonly GlossaryTermId[] = [
  "author",
  "sha",
  "merge",
  "branch",
  "pull-request",
  "issue",
  "lane",
];

const TERM_LEVELS: Readonly<Record<GlossaryTermId, GlossaryLevel>> = {
  author: "basic",
  sha: "basic",
  merge: "basic",
  branch: "basic",
  "pull-request": "deep",
  issue: "deep",
  lane: "deep",
};

export const EXPLAIN_MODES: readonly { value: ExplainMode; labelKey: MessageKey }[] = [
  { value: "off", labelKey: "glossary.modeOff" },
  { value: "beginner", labelKey: "glossary.modeBeginner" },
  { value: "advanced", labelKey: "glossary.modeAdvanced" },
];

/** 术语文案字段。 */
export type GlossaryField = "term" | "summary" | "detail";

/** 术语文案在消息目录中的键：`glossary.<id>.<field>`。 */
export function glossaryKey(id: GlossaryTermId, field: GlossaryField): MessageKey {
  return `glossary.${id}.${field}`;
}

/** 术语难度（与语言无关，用于「新手 / 进阶」展示判定）。 */
export function glossaryLevel(id: GlossaryTermId): GlossaryLevel {
  return TERM_LEVELS[id];
}

/** 判断某词条在当前模式下是否展示：新手展示全部，进阶只保留进阶概念，关闭则一律不展示。 */
export function shouldExplain(id: GlossaryTermId, mode: ExplainMode): boolean {
  if (mode === "off") {
    return false;
  }
  if (mode === "beginner") {
    return true;
  }
  return TERM_LEVELS[id] === "deep";
}

export function isExplainMode(value: string): value is ExplainMode {
  return EXPLAIN_MODES.some((option) => option.value === value);
}
