import { ROLE_LABELS, type Session } from "@/lib/auth/session";

import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";

/**
 * Верхняя панель. Несёт то, что должно быть верным всегда: кто вошёл и в
 * какой роли.
 *
 * Роль показана словом, а не значком: у одного человека их может быть
 * несколько (табельщик и начальник караула), и от роли зависит, что он
 * вправе сделать на текущем экране. Догадываться об этом по цвету аватара
 * человек не должен.
 */
export function AppTopBar({ session }: { session: Session }) {
  const roles = session.roles.map((role) => ROLE_LABELS[role]).join(", ");

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper-raised">
      <div aria-hidden className="h-0.5 w-full bg-signal" />
      <div className="flex items-center justify-between gap-4 px-6 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-base font-bold uppercase tracking-wide">
            Учёт служебного времени
          </span>
          <span className="hidden font-mono text-[11px] uppercase tracking-widest text-ink-faint sm:inline">
            ФПС ГПС МЧС России
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden text-right sm:block">
            <p className="text-sm leading-tight">{session.fullName}</p>
            <p className="text-xs leading-tight text-ink-muted">
              {roles || "Роль не назначена"}
            </p>
          </div>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
