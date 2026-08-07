import Link from "next/link";

import { cn } from "@/lib/utils/cn";

/**
 * Переход между годами календаря.
 *
 * Ссылками, а не выпадающим списком: год — это адрес страницы, и
 * навигация между годами должна работать так же, как любая навигация —
 * средней кнопкой в новую вкладку, «назад» в историю. Список лет
 * ограничен окном вокруг текущего: календарь ведут на будущий год и
 * сверяются с прошлым, а до 2100 никто не листает.
 */
export interface YearSwitcherProps {
  year: number;
}

export function YearSwitcher({ year }: YearSwitcherProps) {
  const current = new Date().getUTCFullYear();
  const first = Math.min(year, current) - 2;
  const years = Array.from({ length: 6 }, (_, index) => first + index);

  return (
    <nav aria-label="Годы календаря" className="flex flex-wrap items-center gap-1">
      {years.map((candidate) => (
        <Link
          key={candidate}
          href={`/service-calendar/${candidate}`}
          aria-current={candidate === year ? "page" : undefined}
          className={cn(
            "rounded-xs border px-3 py-1 font-mono text-sm",
            candidate === year
              ? "border-ink bg-paper-sunken font-medium"
              : "border-rule text-ink-muted hover:border-rule-strong hover:text-ink",
          )}
        >
          {candidate}
        </Link>
      ))}
    </nav>
  );
}
