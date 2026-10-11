"use client";

import { glossaryKey, shouldExplain, type ExplainMode, type GlossaryTermId } from "@/lib/glossary";
import { useTranslator } from "@/lib/i18n/client";

const NOTE_CLASS =
  "rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] leading-5 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100";

/**
 * 概念说明：在操作入口处内联展示「这是什么 / 会产生什么作用」，与悬浮术语卡片共用词条。
 * 仅在术语解释开启（新手 / 进阶）时渲染，关闭模式对老用户零干扰。
 */
export function ConceptNote({
  id,
  mode,
  className,
}: {
  id: GlossaryTermId;
  mode: ExplainMode;
  className?: string;
}) {
  const { t } = useTranslator();
  if (!shouldExplain(id, mode)) {
    return null;
  }
  return (
    <p className={className ? `${NOTE_CLASS} ${className}` : NOTE_CLASS}>
      <span className="font-medium">
        {t("glossary.note", { term: t(glossaryKey(id, "term")) })}
      </span>
      {t(glossaryKey(id, "summary"))}
    </p>
  );
}
