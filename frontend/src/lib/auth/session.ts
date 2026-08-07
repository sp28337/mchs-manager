/**
 * FE008 — сессия: роли и область видимости из JWT.
 *
 * DoD задачи: «Server и Client Component получают ОДИНАКОВЫЙ набор ролей
 * из сессии». Отсюда устройство модуля: разбор токена и словарь ролей
 * живут здесь, изолированно от способа его достать, а способов два —
 * `cookies()` на сервере и провайдер в браузере.
 *
 * --- Чего этот модуль НЕ делает ----------------------------------------
 *
 * Не проверяет подпись. Клиент не может этого сделать осмысленно: у него
 * нет ключа, а если бы был, проверка всё равно ничего не гарантировала бы
 * — решение принимает сервер на каждом запросе (API_Conventions разд. 2).
 * Здесь токен разбирается только для того, чтобы НЕ ПОКАЗЫВАТЬ человеку
 * то, чего он всё равно не сможет сделать.
 *
 * Это существенная оговорка: скрытый пункт меню — удобство, а не защита.
 * `RoleGate` не является механизмом разграничения доступа, и полагаться
 * на него как на защиту нельзя.
 */

export const ROLES = [
  "employee",
  "shift_commander",
  "timekeeper",
  "unit_commander",
  "regional_commander",
  "hr_specialist",
  "finance_specialist",
  "legal_officer",
  "auditor",
  "system_admin",
] as const;

export type Role = (typeof ROLES)[number];

/** Подписи ролей — по SRS разд. 3 (таблица заинтересованных сторон). */
export const ROLE_LABELS: Record<Role, string> = {
  employee: "Сотрудник",
  shift_commander: "Начальник караула",
  timekeeper: "Табельщик",
  unit_commander: "Начальник подразделения",
  regional_commander: "Начальник территориального органа",
  hr_specialist: "Специалист по кадрам",
  finance_specialist: "Специалист финансово-экономического подразделения",
  legal_officer: "Юрист",
  auditor: "Проверяющий",
  system_admin: "Администратор системы",
};

export interface Session {
  /** `sub` токена — идентификатор сотрудника. */
  employeeId: string;
  fullName: string;
  roles: Role[];
  /** `unit_scope[]` — подразделения, доступные этой сессии. */
  unitScope: string[];
  token: string;
  /** Момент истечения, мс. */
  expiresAt: number;
}

interface JwtClaims {
  sub?: string;
  name?: string;
  roles?: unknown;
  unit_scope?: unknown;
  exp?: number;
}

function decodeSegment(segment: string): unknown {
  const normalised = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised.padEnd(
    normalised.length + ((4 - (normalised.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function asRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(ROLES);
  return value.filter((item): item is Role => typeof item === "string" && known.has(item));
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Разбирает JWT в сессию. `null`, если токен не разбирается или истёк —
 * не исключение: испорченный токен означает «сессии нет», и это обычное
 * состояние, а не сбой.
 */
export function sessionFromToken(token: string): Session | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;

  let claims: JwtClaims;
  try {
    claims = decodeSegment(parts[1]) as JwtClaims;
  } catch {
    return null;
  }

  if (typeof claims.sub !== "string") return null;

  const expiresAt = typeof claims.exp === "number" ? claims.exp * 1000 : 0;
  if (expiresAt > 0 && expiresAt <= Date.now()) return null;

  return {
    employeeId: claims.sub,
    fullName: typeof claims.name === "string" ? claims.name : claims.sub,
    roles: asRoles(claims.roles),
    unitScope: asStrings(claims.unit_scope),
    token,
    expiresAt,
  };
}

/** Есть ли у сессии хотя бы одна из перечисленных ролей. */
export function hasAnyRole(session: Session | null, allowed: readonly Role[]): boolean {
  if (!session) return false;
  if (allowed.length === 0) return true;
  return session.roles.some((role) => allowed.includes(role));
}

export const SESSION_COOKIE = "fps_session";
