// 极简 Markdown 解析（M3-3 Issue 预览用）：只支持标题 / 列表 / 代码块 / 段落与
// 行内加粗 / 行内代码。刻意「先解析成数据结构」再由组件渲染，避免 dangerouslySetInnerHTML 的 XSS 风险。
// 如需完整 CommonMark，后续再引入成熟解析器。

export type MarkdownInline =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "code"; value: string };

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; lines: string[] };

const HEADING_PATTERN = /^(#{1,3})\s+(.*)$/;
const UNORDERED_PATTERN = /^\s*[-*]\s+(.*)$/;
const ORDERED_PATTERN = /^\s*\d+\.\s+(.*)$/;

/** 行内解析：加粗（**x**）与行内代码（`x`），其余按纯文本。 */
export function parseInline(text: string): MarkdownInline[] {
  const parts: MarkdownInline[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, index) });
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push({ type: "bold", value: token.slice(2, -2) });
    } else {
      parts.push({ type: "code", value: token.slice(1, -1) });
    }
    lastIndex = index + token.length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }
  return parts;
}

/** 块级解析：按行扫描，产出标题 / 段落 / 列表 / 代码块。 */
export function parseMarkdownLite(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items });
      list = null;
    }
  };
  const flushLoose = () => {
    flushParagraph();
    flushList();
  };

  for (const line of lines) {
    if (code) {
      if (line.trim().startsWith("```")) {
        blocks.push({ type: "code", lines: code });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      flushLoose();
      code = [];
      continue;
    }
    if (trimmed === "") {
      flushLoose();
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      flushLoose();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      continue;
    }

    const unordered = UNORDERED_PATTERN.exec(line);
    const ordered = unordered ? null : ORDERED_PATTERN.exec(line);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushParagraph();
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(((unordered ?? ordered) as RegExpExecArray)[1].trim());
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  if (code) {
    blocks.push({ type: "code", lines: code });
  }
  flushLoose();
  return blocks;
}
