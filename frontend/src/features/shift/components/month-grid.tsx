import type { ReactNode } from "react";

import { weekday, type IsoDate } from "../domain/plain-date";

/**
 * Месяц как в настенном календаре: строка — неделя, столбец — день недели.
 *
 * --- Почему это отдельная деталь ----------------------------------------
 *
 * Так показываются и график смен, и производственный календарь, и это не
 * совпадение: человек сверяет одно с другим глазами, перескакивая между
 * ними, и любое расхождение в раскладке пришлось бы держать в голове.
 * Одна раскладка на оба экрана — единственный способ, чтобы «то же число»
 * оказывалось на том же месте.
 *
 * --- Что здесь считается ------------------------------------------------
 *
 * Ровно одно: сколько пустых клеток поставить перед первым числом, чтобы
 * столбцы совпали с днями недели. Всё остальное — содержимое клетки —
 * решает вызывающий: у графика в клетке часы, у календаря тип дня.
 */

export const WEEKDAY_LABELS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

export interface MonthGridProps {
  title: ReactNode;
  /** Итог месяца справа от названия: смены, часы, число правок. */
  meta?: ReactNode;
  /** Подряд идущие дни ОДНОГО месяца. */
  days: readonly IsoDate[];
  renderDay: (day: IsoDate) => ReactNode;
}

export function MonthGrid({ title, meta, days, renderDay }: MonthGridProps) {
  const first = days[0];
  if (first === undefined) return null;

  return (
    <section className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-rule pb-1">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide">{title}</h3>
        {meta ? <p className="font-mono text-[11px] text-ink-muted">{meta}</p> : null}
      </div>

      <div className="grid grid-cols-7 gap-px">
        {WEEKDAY_LABELS.map((name) => (
          <div
            key={name}
            aria-hidden
            className="pb-0.5 text-center text-[10px] uppercase text-ink-faint"
          >
            {name}
          </div>
        ))}

        {Array.from({ length: weekday(first) }, (_, index) => (
          <div key={`pad-${index}`} aria-hidden />
        ))}

        {days.map((day) => (
          <div key={day} className="min-w-0">
            {renderDay(day)}
          </div>
        ))}
      </div>
    </section>
  );
}
