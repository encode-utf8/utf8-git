import { describe, expect, it } from "vitest";

import {
  EXPLAIN_MODES,
  GLOSSARY_TERMS,
  isExplainMode,
  shouldExplain,
  termById,
  type GlossaryTermId,
} from "./glossary";

describe("术语词条", () => {
  it("id 唯一且字段完整", () => {
    const ids = GLOSSARY_TERMS.map((term) => term.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const term of GLOSSARY_TERMS) {
      expect(term.term.length).toBeGreaterThan(0);
      expect(term.summary.length).toBeGreaterThan(0);
      expect(term.detail.length).toBeGreaterThan(0);
      expect(["basic", "deep"]).toContain(term.level);
    }
  });

  it("termById 命中词条，未知 id 抛错", () => {
    expect(termById("sha").term).toContain("哈希");
    expect(() => termById("missing" as GlossaryTermId)).toThrow(/未知术语/);
  });
});

describe("展示规则", () => {
  it("关闭模式不展示任何术语", () => {
    for (const term of GLOSSARY_TERMS) {
      expect(shouldExplain(term, "off")).toBe(false);
    }
  });

  it("新手模式展示全部术语", () => {
    for (const term of GLOSSARY_TERMS) {
      expect(shouldExplain(term, "beginner")).toBe(true);
    }
  });

  it("进阶模式只保留进阶术语", () => {
    for (const term of GLOSSARY_TERMS) {
      expect(shouldExplain(term, "advanced")).toBe(term.level === "deep");
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
