import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@mailqivo/shared";

/**
 * 登录检查（§11.1）：没有会话 Cookie 时重定向到 /login。
 * 这里只检查 Cookie 是否存在；签名与有效期由服务端在每个 /api 请求上校验，
 * 校验失败时前端请求会得到 401。
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (pathname === "/login") {
    return NextResponse.next();
  }

  if (!hasSession) {
    const url = new URL("/login", request.url);
    if (pathname !== "/" && pathname !== "/dashboard") {
      url.searchParams.set("next", pathname + search);
    }
    return NextResponse.redirect(url);
  }

  if (pathname === "/" || pathname === "/dashboard") {
    return NextResponse.redirect(new URL("/campaigns", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // 排除：Next 内部资源、后端转发路径（/api、/t、/u、/webhooks、/mcp、/healthz）以及带扩展名的静态文件
  matcher: ["/((?!_next/|api/|t/|u/|webhooks/|mcp|healthz|.*\\..*).*)"]
};
