import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

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
 *
 * --- Месяц как одна плашка (`joined`) ------------------------------------
 *
 * Клетки стояли врозь, каждая в своей рамке. Сорок бордюров на месяц и
 * четыреста восемьдесят на год — это сетка, которая громче того, что в
 * ней написано: глаз читает решётку, а не смены.
 *
 * В сомкнутом виде месяц выглядит одной плашкой: щелей между клетками
 * нет, рамок у обычных дней нет тоже, а форму блоку задаёт его СОБСТВЕННЫЙ
 * внешний контур — со скруглениями по углам, включая уступ там, где месяц
 * начинается не с понедельника. Рамка остаётся только у дней, которые
 * что-то означают, и потому наконец что-то означает.
 *
 * Скругления считаются по соседям, и правил два. Первое: угол скругляется,
 * если по обе стороны от него клеток нет, — это внешний угол блока.
 * Второе: угол скругляется и когда оба соседа НА МЕСТЕ, а угловой клетки
 * нет, — это вогнутый угол уступа. Такое скругление режет саму клетку, и
 * получается выемка бумаги: контур входит в уступ дугой, а не прямым
 * углом.
 *
 * Идеальной сопряжённой дуги (когда обе линии переходят в неё без
 * перелома) так не получить: она потребовала бы закрашивать клетку
 * ЧУЖИМ цветом — угловая клетка в уступе принадлежит трём разным дням.
 * Выемка в одной клетке даёт тот же мягкий уступ ценой двух незаметных
 * стыков на её концах.
 */

export const WEEKDAY_LABELS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

export interface MonthGridProps {
  /**
   * Заголовок месяца. Необязателен: во всплывающем календаре месяц уже
   * назван в его собственной шапке со стрелками, и вторая подпись под ней
   * была бы повтором.
   */
  title?: ReactNode;
  /** Итог месяца справа от названия: смены, часы, число правок. */
  meta?: ReactNode;
  /** Подряд идущие дни ОДНОГО месяца. */
  days: readonly IsoDate[];
  /**
   * `corners` — классы скругления для этой клетки: у сомкнутого месяца
   * форму держат сами клетки, и знать её может только сетка.
   */
  renderDay: (day: IsoDate, corners: string) => ReactNode;
  /** Месяц одной плашкой: без щелей между клетками, с общим контуром. */
  joined?: boolean;
}

export function MonthGrid({ title, meta, days, renderDay, joined }: MonthGridProps) {
  const first = days[0];
  if (first === undefined) return null;

  const offset = weekday(first);
  const filled = (slot: number) => slot >= offset && slot < offset + days.length;

  /** Скругления клетки по её месту в контуре месяца. */
  function corners(slot: number): string {
    if (!joined) return "";
    const column = slot % 7;
    const left = column > 0 && filled(slot - 1);
    const right = column < 6 && filled(slot + 1);
    const up = filled(slot - 7);
    const down = filled(slot + 7);
    // Клетки по диагонали. Нужны для уступа: там, где месяц начинается не
    // с понедельника, у контура есть ВОГНУТЫЙ угол — оба соседа на месте,
    // а угловой клетки нет. Скругление такой клетки внутрь и есть выемка,
    // которой уступ смягчается.
    const upLeft = column > 0 && filled(slot - 8);
    const upRight = column < 6 && filled(slot - 6);
    const downLeft = column > 0 && filled(slot + 6);
    const downRight = column < 6 && filled(slot + 8);
    return cn(
      (!left && !up) || (left && up && !upLeft) ? "rounded-tl-lg" : "",
      (!right && !up) || (right && up && !upRight) ? "rounded-tr-lg" : "",
      (!left && !down) || (left && down && !downLeft) ? "rounded-bl-lg" : "",
      (!right && !down) || (right && down && !downRight) ? "rounded-br-lg" : "",
    );
  }

  return (
    <section className="space-y-1.5">
      {title ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-rule pb-1">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide">{title}</h3>
          {meta ? <p className="font-mono text-[11px] text-ink-muted">{meta}</p> : null}
        </div>
      ) : null}

      <div className={cn("grid grid-cols-7", joined ? "gap-0" : "gap-px")}>
        {WEEKDAY_LABELS.map((name) => (
          <div
            key={name}
            aria-hidden
            className={cn(
              "text-center text-[10px] uppercase text-ink-faint",
              joined ? "pb-1.5" : "pb-0.5",
            )}
          >
            {name}
          </div>
        ))}

        {Array.from({ length: offset }, (_, index) => (
          <div key={`pad-${index}`} aria-hidden />
        ))}

        {days.map((day, index) => (
          <div key={day} className="min-w-0">
            {renderDay(day, corners(offset + index))}
          </div>
        ))}
      </div>
    </section>
  );
}
