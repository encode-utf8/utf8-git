import { parseInline, parseMarkdownLite, type MarkdownInline } from "@/lib/markdown-lite";

// 行内渲染：加粗与行内代码映射为元素，纯文本原样输出（不注入 HTML）。
function renderInline(text: string) {
  return parseInline(text).map((part: MarkdownInline, index: number) => {
    if (part.type === "bold") {
      return (
        <strong key={index} className="font-semibold text-zinc-900 dark:text-zinc-50">
          {part.value}
        </strong>
      );
    }
    if (part.type === "code") {
      return (
        <code
          key={index}
          className="rounded bg-black/[.06] px-1 font-mono text-[11px] dark:bg-white/[.1]"
        >
          {part.value}
        </code>
      );
    }
    return <span key={index}>{part.value}</span>;
  });
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: "text-sm font-semibold text-zinc-900 dark:text-zinc-50",
  2: "text-xs font-semibold text-zinc-900 dark:text-zinc-50",
  3: "text-xs font-medium text-zinc-800 dark:text-zinc-100",
};

/** Issue 正文预览：结构化渲染，避免 HTML 注入。 */
export function MarkdownPreview({ source }: { source: string }) {
  const blocks = parseMarkdownLite(source);
  if (blocks.length === 0) {
    return <p className="text-xs text-zinc-400 dark:text-zinc-500">（正文预览）</p>;
  }
  return (
    <div className="space-y-2 text-xs text-zinc-700 dark:text-zinc-200">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <p key={index} className={HEADING_CLASS[block.level]}>
              {renderInline(block.text)}
            </p>
          );
        }
        if (block.type === "code") {
          return (
            <pre
              key={index}
              className="overflow-x-auto rounded-lg bg-black/[.05] p-2 font-mono text-[11px] dark:bg-white/[.08]"
            >
              {block.lines.join("\n")}
            </pre>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={index} className="list-disc space-y-0.5 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}
