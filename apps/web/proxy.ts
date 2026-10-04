import { NextResponse, type NextRequest } from "next/server";

// Auth.js 会话 Cookie 名称：开发环境为 authjs.session-token，HTTPS 为 __Secure- 前缀
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

// 乐观检查（只读 Cookie，不查数据库）：把未登录用户提前挡在受保护路由之外；
// 真正的会话校验仍由 /me 页面中的 auth() 完成，二者形成纵深防御。
export default function proxy(request: NextRequest) {
  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
  if (hasSessionCookie) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl, 302);
}

export const config = {
  matcher: ["/me/:path*", "/repos/:path*"],
};
