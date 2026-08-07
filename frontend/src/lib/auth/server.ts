/**
 * Доступ к сессии на СЕРВЕРЕ (Server Components, Route Handlers).
 *
 * `cache()` из React — дедупликация в пределах одного запроса
 * (`server-cache-react`): корневой layout, страница и вложенный layout
 * спросят сессию каждый по разу, а разбор произойдёт один.
 */

import { cache } from "react";
import { cookies } from "next/headers";

import { SESSION_COOKIE, sessionFromToken, type Session } from "./session";

export const getServerSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? sessionFromToken(token) : null;
});
