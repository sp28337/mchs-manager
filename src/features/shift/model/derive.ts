/**
 * Связка «сохранённый профиль → расчёт периода».
 *
 * Тонкий слой между тем, что человек ввёл, и доменом, который считает.
 * Отдельно от домена, потому что домен ничего не знает про хранилище, и
 * отдельно от экранов, потому что экраны ничего не должны знать про
 * порядок вывода нормы.
 */

import { Dec } from "../domain/decimal";
import {
  calculatePeriod,
  type AbsencePeriod,
  type CalloutPeriod,
  type PeriodCalculation,
} from "../domain/calculation";
import { calendarFactsFor, type DayType } from "../domain/production-calendar";
import { addDays, type IsoDate } from "../domain/plain-date";
import {
  ACCOUNTING_PERIODS,
  deriveWeeklyNorm,
  weeklyNormGroundOf,
  weeklyNormGroundToFacts,
  type AccountingPeriodKind,
  type WeeklyNorm,
  type WeeklyNormGround,
  type WeeklyNormInput,
} from "../domain/value-objects";
import { overridesOf, type StoredProfile } from "../storage/profile";

/**
 * Профиль на языке домена.
 *
 * Хранилище называет поля своими именами (`workingConditions`), домен —
 * своими. Перевод собран здесь один раз, потому что нужен дважды: для
 * нормы и для её основания.
 */
export function weeklyNormInputOf(profile: StoredProfile): WeeklyNormInput {
  return {
    conditions: profile.workingConditions,
    disabilityGroupIorII: profile.disabilityGroupIorII,
  };
}

export function weeklyNormOf(profile: StoredProfile): WeeklyNorm {
  return deriveWeeklyNorm(weeklyNormInputOf(profile));
}

/**
 * Выбранное основание — признаками профиля.
 *
 * Возвращаемый тип назван через `Pick`, а не описан вручную, и это важно:
 * домен зовёт поле `conditions`, хранилище — `workingConditions`. Первая
 * версия раскладывала основание прямо в доменных именах и подмешивала
 * результат в профиль через `...`, отчего в профиль попадал посторонний
 * ключ `conditions`, а настоящий оставался прежним: человек выбирал «36
 * часов — вредные условия» и получал 40. Проверка лишних полей на
 * расширении объекта не срабатывает, поэтому поймать это может только
 * тип, названный явно.
 */
export function weeklyNormGroundFacts(
  ground: WeeklyNormGround,
): Pick<StoredProfile, "workingConditions" | "disabilityGroupIorII"> {
  const facts = weeklyNormGroundToFacts(ground);
  return {
    workingConditions: facts.conditions,
    disabilityGroupIorII: facts.disabilityGroupIorII,
  };
}

/** Какое основание действует сейчас. */
export function weeklyNormGroundOfProfile(profile: StoredProfile): WeeklyNormGround {
  return weeklyNormGroundOf(weeklyNormInputOf(profile));
}


/** Учётные периоды: все три, выбор за человеком. */
export function accountingPeriodsOf(): readonly AccountingPeriodKind[] {
  return ACCOUNTING_PERIODS;
}

export function calloutPeriodsOf(profile: StoredProfile): CalloutPeriod[] {
  return profile.callouts.map((callout) => ({
    start: callout.startsOn,
    endInclusive: callout.endsOn,
    kind: callout.kind,
    hoursPerDay: new Dec(callout.hoursPerDay),
  }));
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
      // Хранилище зовёт это поле `firstShiftDate` с тех пор, когда
      // спрашивали именно первую смену года. Смысл теперь другой — любая
      // известная смена, — но переименовывать ключ значило бы сломать
      // сохранённые файлы профилей ради названия.
      knownShiftDate: profile.firstShiftDate,
    },
    weekly: weeklyNormOf(profile),
    calendar: { workingDays: facts.workingDays, preHolidayDays: facts.preHolidayDays },
    absences: absencePeriodsOf(profile),
    callouts: calloutPeriodsOf(profile),
    holidayDays: facts.holidays,
    workingDays: facts.workingDaySet,
    preHolidayDays: facts.preHolidayDaySet,
    shiftStartTime: profile.shiftStartTime,
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

/**
 * Границы «по сегодня»: тот же период, но обрезанный живым временем.
 *
 * --- Зачем это -----------------------------------------------------------
 *
 * Учётный период — год или полугодие, и его итог станет известен только
 * в конце. А человек ведёт табель СЕЙЧАС: ему нужно знать, сколько
 * переработки набежало к сегодняшнему дню, — иначе весь расчёт до декабря
 * показывает норму, которую он ещё не должен был отработать, и «недоработку»
 * в сотни часов.
 *
 * --- Почему начало НЕ сдвигается ------------------------------------------
 *
 * Сдвигалось: до первой смены человек в карауле не служил, и часы за те
 * сутки были не его. Держалось это на том, что названная дата — начало
 * службы в этом графике.
 *
 * Теперь человек называет ЛЮБУЮ свою смену, в том числе завтрашнюю, и о
 * начале службы приложение не знает ничего. Обрезать период по такой дате
 * значило бы выбросить из расчёта весь год до неё — то есть по ответу
 * «завтра я заступаю» показать пустой табель.
 *
 * --- Почему конец — завтра ------------------------------------------------
 *
 * Правая граница периода в этом расчёте ИСКЛЮЧАЮЩАЯ: `2026-02-01` значит
 * «по 31 января». Чтобы сегодняшние сутки вошли целиком, границей ставится
 * следующий день.
 */
export function liveBounds(
  bounds: { periodStart: IsoDate; periodEnd: IsoDate },
  today: IsoDate,
): { periodStart: IsoDate; periodEnd: IsoDate } {
  const start = bounds.periodStart;
  const tomorrow = addDays(today, 1);
  const end = tomorrow < bounds.periodEnd ? tomorrow : bounds.periodEnd;
  // Период, целиком лежащий в будущем, обрезать не во что: пусть остаётся
  // пустым отрезком в своём начале, а не отрицательным.
  return { periodStart: start, periodEnd: end < start ? start : end };
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
