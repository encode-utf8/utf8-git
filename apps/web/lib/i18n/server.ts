// 服务端入口：从请求里取当前语言。仅在服务端组件 / 路由处理器中调用（依赖 next/headers）。

import { cookies, headers } from "next/headers";

import { LOCALE_COOKIE, resolveLocale, type Locale } from "./config";
import { createTranslator, type Translator } from "./translate";

/** 当前请求使用的语言：语言偏好 Cookie 优先，其次 Accept-Language，最后默认中文。 */
export async function getLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const preference = cookieStore.get(LOCALE_COOKIE)?.value;
  return resolveLocale(preference, headerStore.get("accept-language"));
}

/** 服务端组件里的翻译入口：`const { t } = await getTranslator();` */
export async function getTranslator(): Promise<Translator> {
  return createTranslator(await getLocale());
}
