import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Кнопка в расчёт. Одна деталь на обе: в шапке она меньше, на первом
 * экране крупнее, но разъехаться формой или цветом им нельзя — это одна
 * и та же дверь.
 *
 * Лежит отдельным файлом, а не в самой странице, потому что надпись на
 * ней решает `HeroCta` — а он читает хранилище и потому работает в
 * браузере. Кнопка при этом остаётся обычной: ни состояния, ни эффектов у
 * неё нет, и в шапку она попадает прямо из серверной разметки.
 */
export function ToCalculator({
  children,
  size = "md",
}: {
  children: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <Link
      href="/calculator"
      className={cn(
        "inline-flex shrink-0 items-center rounded-xl bg-ink font-bold text-paper no-underline",
        "hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
        size === "sm" ? "h-9 px-4 text-sm" : "h-11 px-6 text-base",
      )}
    >
      {children}
    </Link>
  );
}
