import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdownLite } from "./markdown-lite";

describe("parseInline", () => {
  it("切分加粗、行内代码与纯文本", () => {
    expect(parseInline("修 **排序** 并加 `code`")).toEqual([
      { type: "text", value: "修 " },
      { type: "bold", value: "排序" },
      { type: "text", value: " 并加 " },
      { type: "code", value: "code" },
    ]);
  });

  it("无标记时整体为文本", () => {
    expect(parseInline("plain")).toEqual([{ type: "text", value: "plain" }]);
  });
});

describe("parseMarkdownLite", () => {
  it("识别标题级别", () => {
    expect(parseMarkdownLite("# 一\n## 二\n### 三")).toEqual([
      { type: "heading", level: 1, text: "一" },
      { type: "heading", level: 2, text: "二" },
      { type: "heading", level: 3, text: "三" },
    ]);
  });

  it("合并连续的无序 / 有序列表", () => {
    expect(parseMarkdownLite("- a\n- b\n\n1. x\n2. y")).toEqual([
      { type: "list", ordered: false, items: ["a", "b"] },
      { type: "list", ordered: true, items: ["x", "y"] },
    ]);
  });

  it("保留代码块内容并合并段落", () => {
    expect(parseMarkdownLite("前\n\n```\nline1\n\nline2\n```\n后")).toEqual([
      { type: "paragraph", text: "前" },
      { type: "code", lines: ["line1", "", "line2"] },
      { type: "paragraph", text: "后" },
    ]);
  });

  it("空输入返回空数组", () => {
    expect(parseMarkdownLite("   \n\n")).toEqual([]);
  });
});
