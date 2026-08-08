import { cn } from "@/lib/utils/cn";

import type { DayRecord, PeriodCalculation } from "../domain/calculation";
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
 * --- Почему счёт идёт по СУТКАМ, а не по сменам --------------------------
 *
 * Смена длится сутки с развода, поэтому лежит в двух календарных днях. При
 * разводе в 08:30 смена, заступившая 31 марта, отдаёт марту 15,5 часа, а
 * 8,5 — апрелю, и ночных в марте у неё два часа, а не шесть.
 *
 * Раньше блок брал часы смены целиком и приписывал их месяцу ЗАСТУПЛЕНИЯ.
 * На периоде в полгода это давало марту все 24 часа: месячная сумма
 * оказывалась завышена, апрельская — занижена, и обе расходились с
 * табелем. Поэтому итог месяца — сумма его СУТОК, и она в точности равна
 * сумме чисел, видимых в клетках.
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
  /** Заступлений в этом месяце. */
  starts: number;
  /** Отработанные часы, пришедшиеся на СУТКИ этого месяца. */
  workedHours: Decimal;
  nightHours: Decimal;
  /** Пропущенных по уважительной причине заступлений. */
  absentStarts: number;
}

export function ShiftStrip({ calculation }: { calculation: PeriodCalculation }) {
  const byDay = new Map(calculation.days.map((record) => [record.day, record]));

  const groups: MonthGroup[] = [];
  for (const day of datesInRange(calculation.periodStart, calculation.periodEnd)) {
    const year = yearOf(day);
    const month = monthIndex(day);
    let group = groups.at(-1);
    if (!group || group.year !== year || group.month !== month) {
      group = {
        year,
        month,
        days: [],
        starts: 0,
        workedHours: ZERO,
        nightHours: ZERO,
        absentStarts: 0,
      };
      groups.push(group);
    }

    group.days.push(day);

    const record = byDay.get(day);
    if (!record) continue;
    if (record.isShiftStart) {
      group.starts += 1;
      if (record.absenceKind) group.absentStarts += 1;
    }
    if (!record.absenceKind) {
      group.workedHours = group.workedHours.plus(record.hours);
      group.nightHours = group.nightHours.plus(record.nightHours);
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
                {group.starts} см · {hours(group.workedHours)} ч
                {/* Раньше здесь стояло «· −8», и человек справедливо
                    прочитал это как «минус 8 часов». Число пропущенных
                    смен обязано быть подписано словом: приложение
                    существует ровно для того, чтобы часы не отнимались
                    молча, и двусмысленность в его собственном итоге —
                    последнее, что тут допустимо. */}
                {group.absentStarts > 0 ? (
                  <span className="text-signal"> · пропущено {group.absentStarts}</span>
                ) : null}
                {group.nightHours.greaterThan(0) ? (
                  <span className="text-ink-faint"> · ноч. {hours(group.nightHours)}</span>
                ) : null}
              </>
            }
            days={group.days}
            renderDay={(day) => <DayCell day={day} record={byDay.get(day)} />}
          />
        ))}
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <Legend className="border-verify bg-verify-soft text-verify" label="Заступление на смену" />
        <Legend
          className="border-verify/50 bg-verify-soft/50 text-verify"
          label="Продолжение смены, заступившей накануне"
        />
        <Legend
          className="border-dashed border-signal bg-signal-soft text-signal"
          label="Смена по графику, пропущенная по уважительной причине"
        />
        <Legend className="border-rule text-ink-faint" label="Свободные сутки" />
      </dl>
    </div>
  );
}

function DayCell({ day, record }: { day: IsoDate; record: DayRecord | undefined }) {
  const date = dayOfMonth(day);
  const month = (MONTH_NAMES[monthIndex(day)] ?? "").toLowerCase();
  const weekdayName = WEEKDAY_LABELS[weekday(day)] ?? "";

  // День недели ушёл из клетки в шапку столбца, и без подписи незрячий
  // читатель получил бы голое число: календарная сетка передаёт день
  // недели положением, а положение он не видит.
  //
  // Подпись называет и то, чего в клетке не видно: сколько из этих часов
  // ночные. Именно они чаще всего расходятся с табелем.
  const label = !record
    ? `${date} ${month}, ${weekdayName} — свободные сутки`
    : record.absenceKind
      ? `${date} ${month}, ${weekdayName} — ${record.isShiftStart ? "смена по графику" : "продолжение смены"}, ${ABSENCE_LABELS[record.absenceKind]}`
      : `${date} ${month}, ${weekdayName} — ${
          record.isShiftStart ? "заступление" : "продолжение смены"
        }, ${hours(record.hours)} ч` +
        (record.nightHours.greaterThan(0) ? `, из них ночных ${hours(record.nightHours)}` : "");

  const worked = record !== undefined && record.absenceKind === null;

  return (
    <div
      title={label}
      className={cn(
        "flex min-w-0 flex-col items-center justify-center rounded-xs border py-0.5 leading-tight",
        "lg:aspect-square lg:py-0",
        !record && "border-rule text-ink-faint",
        // Хвост смены отличается от заступления бледностью, а не другим
        // цветом: это те же отработанные часы, и разный цвет читался бы как
        // разный род времени.
        worked && record.isShiftStart && "border-verify bg-verify-soft text-verify",
        worked && !record.isShiftStart && "border-verify/50 bg-verify-soft/50 text-verify",
        record?.absenceKind && "border-dashed border-signal bg-signal-soft text-signal",
      )}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden className="font-mono text-xs">
        {date}
      </span>
      <span aria-hidden className="font-mono text-[9px]">
        {!record ? "·" : record.absenceKind ? "—" : hours(record.hours).replace(",00", "")}
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
