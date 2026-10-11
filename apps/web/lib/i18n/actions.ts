"use server";

// 语言偏好的写入端：由语言切换器（客户端组件）调用。
//
// 放在 Server Action 里而不是浏览器端 `document.cookie`：cookie 由服务端设置，
// `secure` 等属性按环境判定，也避免客户端直接写全局对象（React Compiler 规则）。

import { cookies } from "next/headers";

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "./config";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** 记住语言偏好；非法值回退到默认语言。随后由调用方 `router.refresh()` 触发重渲染。 */
export async function setLocalePreference(value: string): Promise<void> {
  const locale = isLocale(value) ? value : DEFAULT_LOCALE;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    // 非 HttpOnly：语言偏好不是凭据，也让排查问题时一眼可见
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
}
