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
     * Всё, кроме зоны входа, маршрутов аутентификации, ПРОКСИ К API и
     * служебных путей Next.js. Статику исключаем явно: перехватывать её
     * незачем.
     *
     * --- Почему `api/backend` тоже исключён ------------------------------
     *
     * Найдено осмотром: браузерные запросы к API получали 307 на
     * `/login` — то есть код, ожидавший JSON, получал HTML-страницу
     * входа, и любая ошибка выглядела как «сервер недоступен».
     *
     * Редирект — ответ, осмысленный для НАВИГАЦИИ: человек шёл на
     * страницу, его отправили войти. Для запроса данных он бессмыслен:
     * `fetch` последует за редиректом молча и вернёт разметку вместо
     * данных. Правильный отказ для API — 401 с телом `problem+json`, и
     * выдать его должен тот, кто проверяет права, то есть бэкенд
     * (фаза 12). Подменять его редиректом здесь значит скрывать причину.
     *
     * Дыры это не создаёт: `/api/backend/*` — прокси, за которым стоит
     * бэкенд со своими проверками. Middleware ничего не защищал — он
     * только ломал ответ.
     */
    "/((?!login|api/auth|api/backend|_next/static|_next/image|favicon.ico).*)",
  ],
};
