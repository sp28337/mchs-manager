import { NextResponse } from "next/server";

import { SESSION_COOKIE, sessionFromToken, type Role } from "@/lib/auth/session";

/**
 * Вход для разработки — ТОЛЬКО для разработки.
 *
 * --- Зачем он существует -------------------------------------------------
 *
 * Настоящий вход (`/api/auth/login`) обращается к `POST /auth/login`
 * бэкенда, которого нет: аутентификация целиком отнесена в фазу 12. Пока
 * её нет, посмотреть систему нельзя вообще — ни один экран не открывается
 * без cookie сессии (`middleware.ts`). Это делало всю проделанную работу
 * непроверяемой руками, что само по себе дефект.
 *
 * --- Почему это не «вход без пароля», а отдельная дверь ------------------
 *
 * Соблазн был другой: дать `/api/auth/login` тихо выдавать токен, когда
 * бэкенд ответил 404. Так делать нельзя. Подделка, вставленная в
 * НАСТОЯЩИЙ путь входа, переживает появление аутентификации: ветка
 * «бэкенд не ответил — впустим» останется в коде и однажды сработает в
 * бою при обычном сбое сети. Отдельный маршрут с говорящим именем виден
 * в любом обзоре кода и удаляется одним движением.
 *
 * --- Гарантии --------------------------------------------------------
 *
 * 1. Маршрут отвечает 404 в production-сборке — не 403: в бою его не
 *    должно быть видно вовсе.
 * 2. Токен НЕ подписан. Подпись — строка `dev-not-signed`, и это
 *    осознанно: как только бэкенд начнёт проверять подпись (фаза 12),
 *    такой токен перестанет работать сам, без чьей-либо памяти о том,
 *    что его надо отключить.
 * 3. Срок жизни — 12 часов, чтобы забытая вкладка не жила вечно.
 *
 * ЭТОТ ФАЙЛ УДАЛЯЕТСЯ ВМЕСТЕ С ПОЯВЛЕНИЕМ НАСТОЯЩЕГО `POST /auth/login`.
 */

const TWELVE_HOURS_SECONDS = 12 * 60 * 60;

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

interface DevLoginBody {
  employeeId?: unknown;
  fullName?: unknown;
  roles?: unknown;
  unitScope?: unknown;
}

export async function POST(request: Request) {
  // Единственная проверка, и она же достаточная: в production-сборке
  // маршрута нет. `next build` выставляет NODE_ENV=production, `next dev`
  // — development.
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }

  let body: DevLoginBody;
  try {
    body = (await request.json()) as DevLoginBody;
  } catch {
    return NextResponse.json(
      {
        type: "https://api.fps-timekeeping.gov.ru/errors/validation-failed",
        title: "Некорректный запрос",
        status: 400,
        detail: "Тело запроса не разобрано.",
      },
      { status: 400, headers: { "Content-Type": "application/problem+json" } },
    );
  }

  const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
  if (!employeeId) {
    return NextResponse.json(
      {
        type: "https://api.fps-timekeeping.gov.ru/errors/validation-failed",
        title: "Не выбран сотрудник",
        status: 400,
        detail:
          "Сессия строится вокруг идентификатора сотрудника: без него экраны «мой табель», "
          + "«мой баланс» и «мои отпуска» не знают, чьи данные показывать.",
      },
      { status: 400, headers: { "Content-Type": "application/problem+json" } },
    );
  }

  const roles = Array.isArray(body.roles)
    ? body.roles.filter((role): role is Role => typeof role === "string")
    : [];
  const unitScope = Array.isArray(body.unitScope)
    ? body.unitScope.filter((unit): unit is string => typeof unit === "string")
    : [];

  const token = [
    base64url({ alg: "none", typ: "JWT" }),
    base64url({
      sub: employeeId,
      name: typeof body.fullName === "string" && body.fullName ? body.fullName : employeeId,
      roles,
      unit_scope: unitScope,
      exp: Math.floor(Date.now() / 1000) + TWELVE_HOURS_SECONDS,
    }),
    "dev-not-signed",
  ].join(".");

  const session = sessionFromToken(token);
  if (!session) {
    return NextResponse.json(
      {
        type: "https://api.fps-timekeeping.gov.ru/errors/upstream-contract",
        title: "Токен не разобрался",
        status: 500,
        detail: "Собранный токен не прошёл собственный разбор — это ошибка в dev-login.",
      },
      { status: 500, headers: { "Content-Type": "application/problem+json" } },
    );
  }

  const response = NextResponse.json({ ok: true, session: { ...session, token: undefined } });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    expires: new Date(session.expiresAt),
  });
  return response;
}
