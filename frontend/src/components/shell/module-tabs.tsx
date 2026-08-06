"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavItem } from "@/lib/auth/navigation";
import { cn } from "@/lib/utils/cn";

/**
 * Табы модуля. Один пункт — не выбор, поэтому при единственном доступном
 * разделе панель не рисуется вовсе: строка с одной вкладкой сообщает
 * человеку только то, что он и так видит.
 */
export function ModuleTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  if (items.length < 2) return null;

  return (
    <nav aria-label="Разделы модуля" className="border-b border-rule">
      <ul className="-mb-px flex flex-wrap gap-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block border-b-2 px-3 py-2 text-sm transition-colors",
                  active
                    ? "border-signal font-medium text-ink"
                    : "border-transparent text-ink-muted hover:border-rule-strong hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
