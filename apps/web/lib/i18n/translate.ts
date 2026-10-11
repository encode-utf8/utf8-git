// 翻译内核：点号路径查表 + `{name}` 插值 + 回退（当前语言 → 默认语言 → 键名）。
// 纯函数、无依赖，服务端与客户端共用；类型上键名由消息目录推导，拼错 / 漏键在编译期报错。

import { DEFAULT_LOCALE, type Locale } from "./config";
import { CATALOG, type Messages } from "./messages";

/** 把嵌套目录展成点号路径：`{ a: { b: "x" } }` → `"a.b"`。 */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;

export type TranslateParams = Record<string, string | number>;

export type Translate = (key: MessageKey, params?: TranslateParams) => string;

export interface Translator {
  locale: Locale;
  t: Translate;
}

function lookup(messages: Messages, key: string): string | undefined {
  let current: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

/** 把 `{name}` 替换成参数值；缺失的参数原样保留，便于在界面上发现漏传。 */
function interpolate(template: string, params: TranslateParams | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * 生成某语言的翻译函数。查表顺序：当前语言 → 默认语言（中文）→ 键名本身。
 * 回退到键名只在目录被运行时裁剪（如按需加载）时才会出现，便于定位缺失文案。
 */
export function createTranslator(locale: Locale): Translator {
  const messages = CATALOG[locale];
  const fallback = CATALOG[DEFAULT_LOCALE];

  const t: Translate = (key, params) => {
    const template = lookup(messages, key) ?? lookup(fallback, key) ?? key;
    return interpolate(template, params);
  };

  return { locale, t };
}
