import { describe, expect, it } from "vitest";

import { LOCALES } from "../config";
import { CATALOG } from "./index";

/** 展平成 `[点号键, 文案]`，用于比对两种语言的结构与内容。 */
function leaves(value: unknown, prefix = ""): [string, string][] {
  if (typeof value === "string") return [[prefix, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("消息目录", () => {
  it("所有语言的叶子键与源语言（中文）完全一致", () => {
    const source = leaves(CATALOG["zh-CN"])
      .map(([key]) => key)
      .sort();
    for (const locale of LOCALES) {
      expect(
        leaves(CATALOG[locale])
          .map(([key]) => key)
          .sort(),
        locale,
      ).toEqual(source);
    }
  });

  it("没有空文案（含全空白）", () => {
    for (const locale of LOCALES) {
      const empties = leaves(CATALOG[locale])
        .filter(([, text]) => text.trim() === "")
        .map(([key]) => key);
      expect(empties, locale).toEqual([]);
    }
  });
});
