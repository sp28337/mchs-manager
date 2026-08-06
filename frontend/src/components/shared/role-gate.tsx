"use client";

import { useHasRole } from "@/lib/auth/session-provider";
import type { Role } from "@/lib/auth/session";

/**
 * FE013 — показ по роли.
 *
 * DoD: «дочерний контент не рендерится при отсутствии нужной роли».
 * Именно НЕ РЕНДЕРИТСЯ, а не прячется стилями: скрытый `display: none`
 * остаётся в разметке, попадает в дерево доступности некоторых браузеров и
 * читается в исходном коде страницы.
 *
 * --- Чем это НЕ является ------------------------------------------------
 *
 * Механизмом разграничения доступа. Роли берутся из JWT, который клиент не
 * проверяет и проверить не может; решение принимает сервер на каждом
 * запросе (API_Conventions разд. 2). `RoleGate` избавляет человека от
 * кнопок, которые всё равно ответят 403, — это удобство, и полагаться на
 * него как на защиту нельзя.
 *
 * Оговорка не формальная: соблазн «скрыли — значит защитили» — самый
 * распространённый способ получить дыру в системе с ролями.
 */
export interface RoleGateProps {
  allow: readonly Role[];
  children: React.ReactNode;
  /** Что показать вместо содержимого. По умолчанию — ничего. */
  fallback?: React.ReactNode;
}

export function RoleGate({ allow, children, fallback = null }: RoleGateProps) {
  const permitted = useHasRole(allow);
  return permitted ? <>{children}</> : <>{fallback}</>;
}
