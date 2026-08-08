/**
 * Связка «сохранённый профиль → расчёт периода».
 *
 * Тонкий слой между тем, что человек ввёл, и доменом, который считает.
 * Отдельно от домена, потому что домен ничего не знает про хранилище, и
 * отдельно от экранов, потому что экраны ничего не должны знать про
 * порядок вывода нормы.
 */

import {
  calculatePeriod,
  type AbsencePeriod,
  type PeriodCalculation,
} from "../domain/calculation";
import { calendarFactsFor, type DayType } from "../domain/production-calendar";
import type { IsoDate } from "../domain/plain-date";
import {
  ACCOUNTING_PERIODS,
  deriveWeeklyNorm,
  type AccountingPeriodKind,
  type GuardNumber,
  type WeeklyNorm,
} from "../domain/value-objects";
import { overridesOf, type StoredProfile } from "../storage/profile";

export function weeklyNormOf(profile: StoredProfile): WeeklyNorm {
  return deriveWeeklyNorm({
    employment: profile.employmentKind,
    gender: profile.gender,
    conditions: profile.workingConditions,
    northernLocality: profile.northernLocality,
    disabilityGroupIorII: profile.disabilityGroupIorII,
  });
}

/**
 * Учётные периоды, разрешённые приказом именно этому человеку.
 *
 * Квартал предлагается только работникам (Приказ № 307 п. 7); сотруднику
 * Приказ № 308 п. 2 оставляет полугодие или год. Показывать сотруднику
 * квартал значило бы предлагать период, в котором его переработку считать
 * нельзя, — а именно по итогу учётного периода она и определяется.
 */
export function accountingPeriodsOf(
  profile: StoredProfile,
): readonly AccountingPeriodKind[] {
  return ACCOUNTING_PERIODS[profile.employmentKind];
}

export function absencePeriodsOf(profile: StoredProfile): AbsencePeriod[] {
  return profile.absences.map((absence) => ({
    start: absence.startsOn,
    endInclusive: absence.endsOn,
    kind: absence.kind,
  }));
}

/**
 * Правки календаря, разложенные по годам.
 *
 * Домену нужен именно такой вид: период может пересечь границу года, и
 * тогда календарей понадобится два.
 */
function overridesByYear(
  profile: StoredProfile,
): Map<number, ReadonlyMap<IsoDate, DayType>> {
  const byYear = new Map<number, Map<IsoDate, DayType>>();
  for (const [day, dayType] of overridesOf(profile)) {
    const year = Number(day.slice(0, 4));
    const bucket = byYear.get(year);
    if (bucket) bucket.set(day, dayType);
    else byYear.set(year, new Map([[day, dayType]]));
  }
  return byYear;
}

export function calculateFor(
  profile: StoredProfile,
  periodStart: IsoDate,
  periodEnd: IsoDate,
): PeriodCalculation {
  const facts = calendarFactsFor(periodStart, periodEnd, overridesByYear(profile));
  return calculatePeriod({
    periodStart,
    periodEnd,
    cycle: {
      guard: profile.guardNumber as GuardNumber,
      firstShiftDate: profile.firstShiftDate,
    },
    weekly: weeklyNormOf(profile),
    calendar: { workingDays: facts.workingDays, preHolidayDays: facts.preHolidayDays },
    absences: absencePeriodsOf(profile),
    holidayDays: facts.holidays,
  });
}

const pad = (value: number) => String(value).padStart(2, "0");

export function monthBounds(year: number, month: number) {
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  return {
    periodStart: `${year}-${pad(month + 1)}-01` as IsoDate,
    periodEnd: `${nextYear}-${pad(nextMonth + 1)}-01` as IsoDate,
  };
}

export function statutoryBounds(
  year: number,
  kind: AccountingPeriodKind,
  index: number,
) {
  const months = kind === "quarter" ? 3 : kind === "half_year" ? 6 : 12;
  const startMonth = index * months;
  const endMonth = startMonth + months;
  return {
    periodStart: `${year}-${pad(startMonth + 1)}-01` as IsoDate,
    periodEnd: (endMonth >= 12
      ? `${year + 1}-01-01`
      : `${year}-${pad(endMonth + 1)}-01`) as IsoDate,
  };
}
