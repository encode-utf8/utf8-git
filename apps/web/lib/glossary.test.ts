import { describe, expect, it } from "vitest";

import {
  EXPLAIN_MODES,
  GLOSSARY_TERM_IDS,
  glossaryKey,
  glossaryLevel,
  isExplainMode,
  shouldExplain,
} from "./glossary";
import { zhCN } from "./i18n/messages/zh-CN";

// 词条文案已迁到消息目录，这里通过源语言（中文）目录校验内容与结构。
function zh(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((current, part) => (current as Record<string, unknown>)[part], zhCN);
}

describe("术语词条", () => {
  it("id 唯一且文案字段完整", () => {
    expect(new Set(GLOSSARY_TERM_IDS).size).toBe(GLOSSARY_TERM_IDS.length);
    for (const id of GLOSSARY_TERM_IDS) {
      for (const field of ["term", "summary", "detail"] as const) {
        const value = zh(glossaryKey(id, field));
        expect(typeof value).toBe("string");
        expect((value as string).length).toBeGreaterThan(0);
      }
      expect(["basic", "deep"]).toContain(glossaryLevel(id));
    }
  });

  it("分支 / PR / Issue 都说明「是什么」与「会产生什么作用」", () => {
    expect(zh(glossaryKey("branch", "term"))).toBe("分支");
    expect(zh(glossaryKey("branch", "summary"))).toContain("独立开发线");
    expect(zh(glossaryKey("branch", "detail"))).toContain("不会改动任何现有分支");

    expect(zh(glossaryKey("pull-request", "summary"))).toContain("合并");
    expect(zh(glossaryKey("pull-request", "detail"))).toContain("不可撤销");

    expect(zh(glossaryKey("issue", "summary"))).toContain("不包含代码改动");
    expect(zh(glossaryKey("issue", "detail"))).toContain("不会改动任何代码");
  });
});

describe("展示规则", () => {
  it("关闭模式不展示任何术语", () => {
    for (const id of GLOSSARY_TERM_IDS) {
      expect(shouldExplain(id, "off")).toBe(false);
    }
  });

  it("新手模式展示全部术语", () => {
    for (const id of GLOSSARY_TERM_IDS) {
      expect(shouldExplain(id, "beginner")).toBe(true);
    }
  });

  it("进阶模式只保留进阶术语", () => {
    for (const id of GLOSSARY_TERM_IDS) {
      expect(shouldExplain(id, "advanced")).toBe(glossaryLevel(id) === "deep");
    }
  });
});

describe("模式取值", () => {
  it("模式选项固定为 关闭 / 新手 / 进阶", () => {
    expect(EXPLAIN_MODES.map((option) => option.value)).toEqual(["off", "beginner", "advanced"]);
  });

  it("isExplainMode 只接受合法取值", () => {
    expect(isExplainMode("off")).toBe(true);
    expect(isExplainMode("beginner")).toBe(true);
    expect(isExplainMode("advanced")).toBe(true);
    expect(isExplainMode("expert")).toBe(false);
  });
});
