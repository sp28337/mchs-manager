import { NextResponse } from "next/server";

import { apiBaseUrl } from "@/lib/api-client/client";
import { SESSION_COOKIE, sessionFromToken } from "@/lib/auth/session";

/**
 * Route Handler входа. Существует ради одного: поставить токен в
 * `HttpOnly`-cookie, чего браузерный код сделать не может.
 *
 * Пароль здесь не хранится и не логируется — он проходит насквозь к
 * бэкенду и остаётся в теле запроса.
 */
export async function POST(request: Request) {
  let credentials: unknown;
  try {
    credentials = await request.json();
  } catch {
    return problem(400, "validation-failed", "Некорректный запрос", "Тело запроса не разобрано.");
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
      cache: "no-store",
    });
  } catch {
    return problem(
      503,
      "upstream-unavailable",
      "Сервер недоступен",
      "Не удалось связаться с сервером учёта. Повторите попытку позже.",
    );
  }

  if (!upstream.ok) {
    // Ответ бэкенда переносится как есть: он уже RFC 7807, и подменять
    // его собственной формулировкой значило бы скрыть причину отказа.
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
  }

  const payload = (await upstream.json()) as { accessToken?: string };
  const token = payload.accessToken;
  if (!token || !sessionFromToken(token)) {
    return problem(
      502,
      "upstream-contract",
      "Неожиданный ответ сервера",
      "Сервер вернул ответ без пригодного токена доступа.",
    );
  }

  const session = sessionFromToken(token);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Срок жизни cookie — срок жизни токена, не больше: cookie, живущая
    // дольше, оставляла бы человека «вошедшим» с мёртвым токеном.
    expires: session?.expiresAt ? new Date(session.expiresAt) : undefined,
  });
  return response;
}

function problem(status: number, type: string, title: string, detail: string) {
  return NextResponse.json(
    {
      type: `https://api.fps-timekeeping.gov.ru/errors/${type}`,
      title,
      status,
      detail,
    },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}
