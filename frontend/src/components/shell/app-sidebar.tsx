"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavSection } from "@/lib/auth/navigation";
import { cn } from "@/lib/utils/cn";

/**
 * Ролевая навигация. Состав приходит СВЕРХУ, уже отфильтрованный сервером
 * (`navigationFor`): фильтровать в браузере значило бы отправить человеку
 * список страниц, которых он не увидит, — мелкая, но настоящая утечка
 * сведений об устройстве системы.
 *
 * `aria-current="page"` вместо одной лишь подсветки: программа чтения с
 * экрана обязана знать, где человек находится (WCAG 2.2, 2.4.8).
 */
export function AppSidebar({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Разделы системы"
      className="hidden w-60 shrink-0 border-r border-rule px-3 py-6 md:block"
    >
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.title} className="space-y-1">
            <p className="px-2 font-display text-xs font-bold uppercase tracking-widest text-ink-faint">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-sm px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-paper-sunken font-medium text-ink"
                          : "text-ink-muted hover:bg-paper-sunken hover:text-ink",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
