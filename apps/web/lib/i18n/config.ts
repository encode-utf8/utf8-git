// 国际化配置：语言清单、默认语言、语言偏好 Cookie 与请求侧解析（纯函数，可单测）。
//
// 设计：不做 URL 前缀路由 —— 语言偏好存在 Cookie 上，未设置时按 Accept-Language 推断。
// 代价是根布局要读 Cookie，原本静态预渲染的页面（如 /permissions）改为动态渲染。

export const LOCALES = ["zh-CN", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** 中文是产品默认语言（docs/requirements.md FR-5.3：中文优先，预留英文）。 */
export const DEFAULT_LOCALE: Locale = "zh-CN";

/**
 * 语言偏好 Cookie。非 HttpOnly：切换由浏览器写入，随后 `router.refresh()` 让服务端按新语言重渲染。
 */
export const LOCALE_COOKIE = "utf8-git-locale";

/** 语言的自称（界面上不翻译语言名，方便任何语言的用户认出自己的语言）。 */
export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-CN": "中文",
  en: "English",
};

/** 语言偏好 Cookie 等外部输入的类型收窄。 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** 语言标签的主子标签：`zh-Hans-CN` / `zh_CN` → `zh`，`en-US` → `en`。 */
function primarySubtag(tag: string): string {
  return (tag.trim().toLowerCase().split(/[-_;]/)[0] ?? "").trim();
}

/** 把语言标签映射到受支持的语言；不支持时返回 null。 */
function matchLocale(tag: string): Locale | null {
  const primary = primarySubtag(tag);
  if (primary === "zh") return "zh-CN";
  if (primary === "en") return "en";
  return null;
}

/** 解析 Accept-Language：按 q 值从高到低，忽略 q=0（显式拒绝）与空标签。 */
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.split(";");
      const qualityParam = params.map((item) => item.trim()).find((item) => item.startsWith("q="));
      const quality = qualityParam ? Number(qualityParam.slice(2)) : 1;
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((entry) => entry.tag !== "" && entry.quality > 0)
    .sort((left, right) => right.quality - left.quality)
    .map((entry) => entry.tag);
}

/**
 * 解析要使用的语言：显式偏好（Cookie）优先；偏好缺失或不支持时按 Accept-Language 推断；
 * 都不匹配时回退到默认语言。
 */
export function resolveLocale(
  preference: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (preference) {
    const matched = matchLocale(preference);
    if (matched) return matched;
  }
  if (acceptLanguage) {
    for (const tag of parseAcceptLanguage(acceptLanguage)) {
      const matched = matchLocale(tag);
      if (matched) return matched;
    }
  }
  return DEFAULT_LOCALE;
}
