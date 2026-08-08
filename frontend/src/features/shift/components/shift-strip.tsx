import { cn } from "@/lib/utils/cn";

import type { PeriodCalculation, ShiftRecord } from "../domain/calculation";
import { ZERO, formatHours as hours, type Decimal } from "../domain/decimal";
import {
  datesInRange,
  dayOfMonth,
  monthIndex,
  weekday,
  year as yearOf,
  type IsoDate,
} from "../domain/plain-date";
import { ABSENCE_LABELS } from "../schemas";
import { MONTH_NAMES } from "./month-names";
import { MonthGrid, WEEKDAY_LABELS } from "./month-grid";

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
 * Дни выровнены по дням недели, как в настенном календаре. При графике
 * «сутки через трое» цикл четырёхдневный, а неделя семидневная, поэтому
 * смены идут по столбцам наискось — и сбой в графике виден как разрыв
 * этой диагонали, без пересчёта дат.
 *
 * --- Почему месяцы в колонках -------------------------------------------
 *
 * Учётный период — полугодие или год (Приказ № 308 п. 2, № 307 п. 7), то
 * есть шесть-двенадцать блоков. В одну колонку они дают полосу в
 * несколько экранов, где соседние месяцы невозможно сравнить глазом.
 */

interface MonthGroup {
  year: number;
  month: number;
  days: IsoDate[];
  shifts: number;
  workedHours: Decimal;
  absentShifts: number;
}

export function ShiftStrip({ calculation }: { calculation: PeriodCalculation }) {
  const byDay = new Map(calculation.shifts.map((shift) => [shift.startedOn, shift]));

  const groups: MonthGroup[] = [];
  for (const day of datesInRange(calculation.periodStart, calculation.periodEnd)) {
    const year = yearOf(day);
    const month = monthIndex(day);
    let group = groups.at(-1);
    if (!group || group.year !== year || group.month !== month) {
      group = { year, month, days: [], shifts: 0, workedHours: ZERO, absentShifts: 0 };
      groups.push(group);
    }

    group.days.push(day);
    const shift = byDay.get(day);
    if (shift) {
      group.shifts += 1;
      if (shift.absenceKind) group.absentShifts += 1;
      else group.workedHours = group.workedHours.plus(shift.hours);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group, index) => (
          <MonthGrid
            key={`${group.year}-${group.month}`}
            title={
              <>
                {MONTH_NAMES[group.month]}
                {/* Год подписывается только там, где он меняется:
                    повторять его у каждого месяца — шум. */}
                {index === 0 || group.year !== groups[index - 1]?.year ? (
                  <span className="text-ink-muted"> {group.year}</span>
                ) : null}
              </>
            }
            meta={
              <>
                {group.shifts} см · {hours(group.workedHours)} ч
                {group.absentShifts > 0 ? (
                  <span className="text-signal"> · −{group.absentShifts}</span>
                ) : null}
              </>
            }
            days={group.days}
            renderDay={(day) => <ShiftCell day={day} shift={byDay.get(day)} />}
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

function ShiftCell({ day, shift }: { day: IsoDate; shift: ShiftRecord | undefined }) {
  const date = dayOfMonth(day);
  const month = (MONTH_NAMES[monthIndex(day)] ?? "").toLowerCase();
  const weekdayName = WEEKDAY_LABELS[weekday(day)] ?? "";

  // День недели ушёл из клетки в шапку столбца, и без подписи незрячий
  // читатель получил бы голое число: календарная сетка передаёт день
  // недели положением, а положение он не видит.
  const label = shift
    ? shift.absenceKind
      ? `${date} ${month}, ${weekdayName} — смена по графику, ${ABSENCE_LABELS[shift.absenceKind]}`
      : `${date} ${month}, ${weekdayName} — смена, ${hours(shift.hours)} ч`
    : `${date} ${month}, ${weekdayName} — выходной`;

  return (
    <div
      title={label}
      className={cn(
        // Квадрат на больших экранах: клетка по высоте содержимого делает
        // из недели приплюснутую полосу, не похожую ни на настенный
        // календарь, ни на табель. На узких экранах квадрат, наоборот,
        // растянул бы месяц на два экрана.
        "flex min-w-0 flex-col items-center justify-center rounded-xs border py-0.5 leading-tight",
        "lg:aspect-square lg:py-0",
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
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className={cn("size-4 shrink-0 rounded-xs border", className)} aria-hidden />
      <dd className="text-ink-muted">{label}</dd>
    </div>
  );
}
