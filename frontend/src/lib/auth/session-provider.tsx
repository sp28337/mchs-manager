"use client";

import { createContext, useContext, useMemo } from "react";

import { hasAnyRole, type Role, type Session } from "./session";

/**
 * Сессия в браузере. Значение приходит СВЕРХУ, от Server Component, а не
 * читается из cookie повторно: два независимых разбора одного токена —
 * два места, где ответ может разойтись, а DoD FE008 требует ровно
 * обратного («одинаковый набор ролей»).
 */
const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: Session | null;
  children: React.ReactNode;
}) {
  // Значение сессии стабильно в пределах навигации; мемоизация не даёт
  // всему поддереву перерисовываться при каждом рендере провайдера.
  const value = useMemo(() => session, [session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session | null {
  return useContext(SessionContext);
}

export function useHasRole(allowed: readonly Role[]): boolean {
  const session = useSession();
  return hasAnyRole(session, allowed);
}
