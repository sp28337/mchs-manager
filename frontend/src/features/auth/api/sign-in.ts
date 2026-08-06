/**
 * Вход. Обращается к маршруту приложения, а не к бэкенду напрямую.
 *
 * Причина одна и серьёзная: токен обязан лечь в `HttpOnly`-cookie, а
 * такую cookie не может поставить JavaScript — в этом её смысл. Токен,
 * доступный скрипту, доступен и любому чужому скрипту на странице.
 *
 * Поэтому браузер шлёт логин и пароль в `/api/auth/login` (Route Handler
 * Next.js), тот обращается к бэкенду и ставит cookie заголовком ответа.
 */

import { apiClient } from "@/lib/api-client/client";

export interface SignInRequest {
  login: string;
  password: string;
}

export async function signIn(credentials: SignInRequest): Promise<void> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const { toApiError } = await import("@/lib/api-client/problem");
    throw await toApiError(response);
  }
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

/** Реэкспорт для маршрута: тот обращается к бэкенду тем же клиентом. */
export { apiClient };
