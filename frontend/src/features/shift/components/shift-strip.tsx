import { cn } from "@/lib/utils/cn";

import { ABSENCE_LABELS, hours, type Calculation } from "../schemas";

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/**
 * График смен, СГРУППИРОВАННЫЙ ПО МЕСЯЦАМ.
 *
 * --- Почему по месяцам, а не сплошной лентой ----------------------------
 *
 * Сплошная лента годится для месяца и разваливается на полугодии: 180
 * клеток подряд не читаются, и найти в них конкретное число нельзя.
 * Табель же выдают помесячно, и сверяют его помесячно — значит, и
 * показывать надо так, чтобы строки экрана совпадали со строками бумаги.
 *
 * У каждого месяца свой итог: смен, отработанных часов и пропущенных.
 * Именно эти числа человек сравнивает с выданным листом, и считать их в
 * уме, глядя на ленту, — лишняя работа ровно там, где нужна точность.
 */

interface MonthGroup {
  year: number;
  month: number;
  days: Date[];
  shifts: number;
  workedHours: number;
  absentShifts: number;
}

export function ShiftStrip({ calculation }: { calculation: Calculation }) {
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
      group = { year, month, days: [], shifts: 0, workedHours: 0, absentShifts: 0 };
      groups.push(group);
    }

    const iso = cursor.toISOString().slice(0, 10);
    group.days.push(new Date(cursor));

    const shift = byDay.get(iso);
    if (shift) {
      group.shifts += 1;
      if (shift.absenceKind) group.absentShifts += 1;
      else group.workedHours += Number(shift.hours);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={`${group.year}-${group.month}`} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-4 border-b border-rule pb-1">
            <h3 className="font-display text-sm font-bold uppercase tracking-wide">
              {MONTH_NAMES[group.month]}
              {groups.length > 1 && group.month === 0 ? ` ${group.year}` : ""}
            </h3>
            <p className="text-xs text-ink-muted">
              смен: <span className="font-mono">{group.shifts}</span>
              {group.absentShifts > 0 ? (
                <>
                  {" "}
                  · пропущено:{" "}
                  <span className="font-mono text-signal">{group.absentShifts}</span>
                </>
              ) : null}
              {" · "}
              отработано: <span className="font-mono">{hours(group.workedHours)}</span> ч
            </p>
          </div>

          <div className="flex flex-wrap gap-1">
            {group.days.map((day) => {
              const iso = day.toISOString().slice(0, 10);
              const shift = byDay.get(iso);
              const weekday = (day.getUTCDay() + 6) % 7;

              return (
                <div
                  key={iso}
                  title={
                    shift
                      ? shift.absenceKind
                        ? `${day.getUTCDate()} — смена по графику, ${ABSENCE_LABELS[shift.absenceKind]}`
                        : `${day.getUTCDate()} — смена, ${hours(shift.hours)} ч`
                      : `${day.getUTCDate()} — выходной`
                  }
                  className={cn(
                    "flex w-11 flex-col items-center rounded-xs border py-1",
                    !shift && "border-rule text-ink-faint",
                    shift && !shift.absenceKind && "border-verify bg-verify-soft text-verify",
                    shift?.absenceKind &&
                      "border-dashed border-signal bg-signal-soft text-signal",
                  )}
                >
                  <span className="text-[10px] uppercase">{WEEKDAYS[weekday]}</span>
                  <span className="font-mono text-sm">{day.getUTCDate()}</span>
                  <span className="font-mono text-[10px]">
                    {shift
                      ? shift.absenceKind
                        ? "—"
                        : hours(shift.hours).split(",")[0]
                      : "·"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}

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

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className={cn("size-4 shrink-0 rounded-xs border", className)} aria-hidden />
      <dd className="text-ink-muted">{label}</dd>
    </div>
  );
}
