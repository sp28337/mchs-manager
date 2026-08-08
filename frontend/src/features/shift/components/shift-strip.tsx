import { cn } from "@/lib/utils/cn";

import { ZERO, formatHours as hours, type Decimal } from "../domain/decimal";
import type { PeriodCalculation, ShiftRecord } from "../domain/calculation";
import { ABSENCE_LABELS } from "../schemas";

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/**
 * График смен: месяц — блок, неделя — строка.
 *
 * --- Почему по месяцам --------------------------------------------------
 *
 * Табель выдают помесячно и сверяют помесячно. У каждого месяца свой итог
 * — смен, отработанных часов, пропущенных, — и это ровно те числа, что
 * человек сличает с выданным листом. Считать их в уме, глядя на сплошную
 * ленту, — лишняя работа там, где нужна точность.
 *
 * --- Почему ровно семь дней в строке ------------------------------------
 *
 * Дни выровнены по дням недели, как в настенном календаре: строка — это
 * неделя, столбец — один и тот же день недели. При графике «сутки через
 * трое» цикл четырёхдневный, а неделя семидневная, поэтому смены идут по
 * столбцам наискось — и сбой в графике виден как разрыв этой диагонали,
 * без пересчёта дат.
 *
 * Лента произвольной ширины такого не даёт: в ней порядковый номер дня
 * ничего не значит, и найти в ней конкретное число можно только счётом.
 *
 * --- Почему месяцы в колонках -------------------------------------------
 *
 * Учётный период — полугодие или год (Приказ № 308 п. 2, № 307 п. 7), то
 * есть шесть-двенадцать блоков. В одну колонку они дают полосу в
 * несколько экранов, где соседние месяцы невозможно сравнить глазом. От
 * одной до трёх колонок по ширине окна: узкий экран получает читаемый
 * столбец, широкий — год, видимый целиком.
 */

interface MonthGroup {
  year: number;
  month: number;
  days: Date[];
  /** Пустых клеток перед первым днём — чтобы столбцы совпали с днями недели. */
  offset: number;
  shifts: number;
  workedHours: Decimal;
  absentShifts: number;
}

export function ShiftStrip({ calculation }: { calculation: PeriodCalculation }) {
  const start = new Date(`${calculation.periodStart}T00:00:00Z`);
  const end = new Date(`${calculation.periodEnd}T00:00:00Z`);

  const byDay = new Map(calculation.shifts.map((shift) => [shift.startedOn, shift]));

  const groups: MonthGroup[] = [];
  const cursor = new Date(start);
  while (cursor < end) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    let group = groups.at(-1);
    if (!group || group.year !== year || group.month !== month) {
      group = {
        year,
        month,
        days: [],
        offset: (cursor.getUTCDay() + 6) % 7,
        shifts: 0,
        workedHours: ZERO,
        absentShifts: 0,
      };
      groups.push(group);
    }

    const iso = cursor.toISOString().slice(0, 10);
    group.days.push(new Date(cursor));

    const shift = byDay.get(iso);
    if (shift) {
      group.shifts += 1;
      if (shift.absenceKind) group.absentShifts += 1;
      else group.workedHours = group.workedHours.plus(shift.hours);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group, index) => (
          <MonthBlock
            key={`${group.year}-${group.month}`}
            group={group}
            byDay={byDay}
            // Год подписывается только там, где он меняется: повторять его
            // у каждого месяца — шум, а не сведения.
            showYear={index === 0 || group.year !== groups[index - 1]?.year}
          />
        ))}
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <Legend className="border-verify bg-verify-soft text-verify" label="Отработанная смена" />
        <Legend
          className="border-dashed border-signal bg-signal-soft text-signal"
          label="Смена по графику, пропущенная по уважительной причине"
        />
        <Legend className="border-rule text-ink-faint" label="Выходной" />
      </dl>
    </div>
  );
}

function MonthBlock({
  group,
  byDay,
  showYear,
}: {
  group: MonthGroup;
  byDay: Map<string, ShiftRecord>;
  showYear: boolean;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-rule pb-1">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide">
          {MONTH_NAMES[group.month]}
          {showYear ? <span className="text-ink-muted"> {group.year}</span> : null}
        </h3>
        <p className="font-mono text-[11px] text-ink-muted">
          {group.shifts} см · {hours(group.workedHours)} ч
          {group.absentShifts > 0 ? (
            <span className="text-signal"> · −{group.absentShifts}</span>
          ) : null}
        </p>
      </div>

      <div className="grid grid-cols-7 gap-px">
        {WEEKDAYS.map((name) => (
          <div
            key={name}
            aria-hidden
            className="pb-0.5 text-center text-[10px] uppercase text-ink-faint"
          >
            {name}
          </div>
        ))}

        {Array.from({ length: group.offset }, (_, index) => (
          <div key={`pad-${index}`} aria-hidden />
        ))}

        {group.days.map((day) => {
          const iso = day.toISOString().slice(0, 10);
          const shift = byDay.get(iso);
          const date = day.getUTCDate();
          const month = (MONTH_NAMES[group.month] ?? "").toLowerCase();
          const weekday = WEEKDAYS[(day.getUTCDay() + 6) % 7] ?? "";

          // День недели ушёл из клетки в шапку столбца, и без подписи
          // незрячий читатель получил бы голое число: календарная сетка
          // передаёт день недели положением, а положение он не видит.
          const label = shift
            ? shift.absenceKind
              ? `${date} ${month}, ${weekday} — смена по графику, ${ABSENCE_LABELS[shift.absenceKind]}`
              : `${date} ${month}, ${weekday} — смена, ${hours(shift.hours)} ч`
            : `${date} ${month}, ${weekday} — выходной`;

          return (
            <div
              key={iso}
              title={label}
              className={cn(
                "flex min-w-0 flex-col items-center rounded-xs border py-0.5 leading-tight",
                !shift && "border-rule text-ink-faint",
                shift && !shift.absenceKind && "border-verify bg-verify-soft text-verify",
                shift?.absenceKind && "border-dashed border-signal bg-signal-soft text-signal",
              )}
            >
              <span className="sr-only">{label}</span>
              <span aria-hidden className="font-mono text-xs">
                {date}
              </span>
              <span aria-hidden className="font-mono text-[9px]">
                {shift ? (shift.absenceKind ? "—" : hours(shift.hours).split(",")[0]) : "·"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className={cn("size-4 shrink-0 rounded-xs border", className)} aria-hidden />
      <dd className="text-ink-muted">{label}</dd>
    </div>
  );
}
