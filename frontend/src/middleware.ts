import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Первый рубеж защищённой зоны: запрос без cookie сессии до маршрутизации
 * не доходит.
 *
 * Здесь НЕ разбирается токен. Middleware выполняется на каждый запрос,
 * включая статику, и разбор JWT в нём стоил бы больше, чем даёт: cookie
 * есть — пропускаем, а просроченный или испорченный токен отсечёт layout,
 * который сессию всё равно разбирает.
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (hasSession) return NextResponse.next();

  const login = new URL("/login", request.url);
  // Адрес, ради которого человек шёл, переживает вход.
  login.searchParams.set("from", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    /*
     * Всё, кроме зоны входа, маршрутов аутентификации и служебных путей
     * Next.js. Статику исключаем явно: перехватывать её незачем.
     */
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
