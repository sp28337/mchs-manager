import { Dec, ZERO, type Decimal } from "../domain/decimal";
import type { AbsenceKind, CalloutKind } from "../domain/value-objects";
import type { PeriodCalculation } from "../domain/calculation";
import { todayIso, type IsoDate } from "../domain/plain-date";
import type { StoredProfile } from "../storage/profile";
import {
  calculateFor,
  countedBounds,
  liveBounds,
  monthBounds,
  statutoryBounds,
} from "./derive";

/**
 * Год, разложенный по месяцам, — то, из чего собрана статистика.
 *
 * --- Почему год, а не выбранный период ------------------------------------
 *
 * На рабочем экране период выбирается — квартал, полугодие, месяц, — и
 * первое желание было считать статистику по нему же. Но статистика
 * отвечает на другой вопрос, чем полоса с числами наверху. Полоса говорит
 * «сколько СЕЙЧАС», и период у неё — то, за что человек в эту минуту
 * спорит. Статистика говорит «как ШЛО», и меньше года ей нечего показать:
 * ход переработки по трём точкам квартала — это не ход, а три числа,
 * которые и так стоят в таблице.
 *
 * Год здесь тот же, что у профиля (`accountingYear`), — то есть тот, за
 * который человек ведёт учёт. Второго выбора года заводить не пришлось: он
 * уже есть в окне периода и меняется там.
 *
 * --- Почему месяцы считаются каждый сам по себе ---------------------------
 *
 * Разложить годовой расчёт по месяцам сложением его суток было бы дешевле,
 * но неверно: норма считается ПО ОТРЕЗКУ (ст. 104 ТК РФ) — рабочие дни
 * внутри него на недельную норму, — и сумма двенадцати месячных норм не
 * обязана совпадать с годовой. Расхождение мелкое и всё же настоящее, а
 * приложение существует ради того, чтобы числа сходились с приказом.
 *
 * Поэтому каждый месяц — свой вызов расчёта, ровно тот же, каким считается
 * полоса наверху при выбранном месяце. Тринадцать вызовов на открытие окна
 * — и они на нём не сказываются: замером окно статистики открывается
 * БЫСТРЕЕ окна настроек (230 мс против 287 на обычной скорости и 1084
 * против 1399 при вчетверо замедленном процессоре). Всё это время — само
 * появление окна и отрисовка, а не счёт.
 *
 * --- Что делает «Онлайн» --------------------------------------------------
 *
 * Обрезает год сегодняшним днём — тем же `liveBounds`, что и везде. Месяцы
 * после сегодняшнего от этого становятся пустыми отрезками, и это не
 * «ноль часов», а «ещё не наступил»: столбца у них нет вовсе, а ход
 * накопления на них обрывается. Показать будущему месяцу норму без факта
 * значило бы нарисовать провал там, где просто не наступило время.
 */

/** Один месяц года: всё, что о нём знает расчёт. */
export interface MonthStat {
  /** Ноль — январь. */
  readonly month: number;
  /** Отрезок пуст: месяц раньше начала отсчёта или ещё не наступил. */
  readonly empty: boolean;
  readonly normHours: Decimal;
  readonly baseNormHours: Decimal;
  readonly excludedHours: Decimal;
  readonly actualHours: Decimal;
  readonly nightHours: Decimal;
  readonly holidayHours: Decimal;
  readonly workedShifts: number;
  readonly scheduledShifts: number;
  readonly absentShifts: number;
  /** Факт минус норма, со знаком: плюс — переработка, минус — недоработка. */
  readonly balance: Decimal;
}

/** Один вид освобождения за год. */
export interface AbsenceStat {
  readonly kind: AbsenceKind;
  /** Сколько суток года он накрыл. */
  readonly days: number;
  /**
   * Во сколько он обошёлся норме. `null` — вид, который её не уменьшает
   * (отгул): у него этой величины нет, и ноль сказал бы о нём неправду.
   */
  readonly hours: Decimal | null;
}

/**
 * Один вид работы помимо графика за год.
 *
 * Парой к `AbsenceStat` и по той же причине: освобождения отвечают на
 * вопрос «почему норма меньше», вызовы — «откуда взялись часы сверх неё».
 * Человек, спорящий о переработке, спрашивает и то и другое, а до сих пор
 * вызовы были видны только россыпью клеток на сетке да строками в перечне
 * правок — сложить их в число приходилось самому.
 */
export interface CalloutStat {
  readonly kind: CalloutKind;
  /** Сколько суток года он накрыл. */
  readonly days: number;
  /** Сколько часов принёс в отработанное. */
  readonly hours: Decimal;
}

/**
 * Год одного профиля в числах — без разбивки по месяцам.
 *
 * Отдельно от `Statistics` затем, что перечень профилей считает ровно это
 * и по одному расчёту на профиль. Полная статистика стоит тринадцати
 * вызовов, и на десятке профилей вышло бы сто тридцать — ради колонки
 * «Норма» в таблице, где месяцы не показаны вовсе.
 */
export interface ProfileTotals {
  readonly year: number;
  /** Год целиком — тем же расчётом, а не суммой месяцев. */
  readonly total: PeriodCalculation;
  readonly absences: readonly AbsenceStat[];
  readonly callouts: readonly CalloutStat[];
  /** Сумма часов всех вызовов: то, что отработано помимо своего графика. */
  readonly calloutHours: Decimal;
  /** Факт минус норма, со знаком: плюс — переработка, минус — недоработка. */
  readonly balance: Decimal;
  /**
   * Есть ли вообще что показывать.
   *
   * Отрезок года непуст — то есть год начался, а начало отсчёта его не
   * съело. Проверка одна на итог и на месяцы нарочно: месяц лежит внутри
   * года, и «год пуст, а месяц в нём нет» — состояние, которого быть не
   * может.
   */
  readonly any: boolean;
}

export interface Statistics extends ProfileTotals {
  readonly months: readonly MonthStat[];
  /**
   * Накопленный баланс на конец каждого месяца.
   *
   * Копится он сложением МЕСЯЧНЫХ балансов, а не пересчётом года по кусок:
   * двенадцать точек — это ровно двенадцать месячных расчётов, уже
   * сделанных, и лишняя дюжина вызовов ради того же числа не нужна.
   * Пустые месяцы линию не двигают.
   */
  readonly running: readonly Decimal[];
}

/**
 * Освобождения — по видам: сколько суток и во сколько обошлось норме.
 *
 * --- Сутки --------------------------------------------------------------
 *
 * Берутся из `absentDays`, где лежат ВСЕ накрытые сутки, включая выходные
 * между сменами: человек спрашивает «сколько дней отпуска», а не «сколько
 * смен в отпуске».
 *
 * --- Часы ---------------------------------------------------------------
 *
 * Берутся готовыми у расчёта (`excludedByKind`), а не складываются здесь
 * из смен. Складывать их здесь и значило бы завести второе правило: из
 * нормы уходят не часы смен, попавших в отпуск, а часы ПО НОРМЕ за
 * рабочие дни внутри него (письмо Роструда от 01.03.2010 № 550-6-1), и
 * отгул из неё не уходит вовсе. Собранная по сменам сумма на живом годе
 * разошлась с нормой на девять часов и приписала отгулу двадцать четыре,
 * которых он никогда не снимал.
 *
 * Поэтому у отгула здесь `null`, а не ноль: ноль значил бы «сняло нисколько
 * часов», а верно — «эта величина к нему не относится».
 */
function absencesOf(total: PeriodCalculation): AbsenceStat[] {
  const days = new Map<AbsenceKind, number>();
  for (const kind of total.absentDays.values()) {
    days.set(kind, (days.get(kind) ?? 0) + 1);
  }

  return [...days.entries()]
    .map(([kind, count]) => ({
      kind,
      days: count,
      hours: total.excludedByKind.get(kind) ?? null,
    }))
    // От крупного к мелкому: перечень читают, чтобы увидеть, что съело
    // норму, и отпуск на месяц обязан стоять выше отгула на сутки.
    .sort((a, b) => b.days - a.days || a.kind.localeCompare(b.kind));
}

/**
 * Вызовы — по видам: сколько суток и сколько часов.
 *
 * Считается по `days`, а не по записям профиля, и это не лишний труд:
 * запись вызова — это отрезок дат с часами НА СУТКИ, и её часть может
 * лежать за границей года. Расчёт уже разложил её по суткам отрезка и
 * обрезал по его краям; пересчитывать то же самое здесь значило бы завести
 * второе правило обрезки, которое однажды разойдётся с первым.
 *
 * Виды при этом сохранены все шесть, хотя в клетке у них давно один код
 * («Р», см. `day-marks.ts`): в клетке места на слово нет, а здесь есть
 * целая строка — и «Соревнования» человеку сказать можно.
 */
function calloutsOf(total: PeriodCalculation): CalloutStat[] {
  const byKind = new Map<CalloutKind, { days: number; hours: Decimal }>();
  for (const day of total.days) {
    const kind = day.calloutKind;
    if (!kind) continue;
    const at = byKind.get(kind) ?? { days: 0, hours: ZERO };
    byKind.set(kind, { days: at.days + 1, hours: at.hours.plus(day.hours) });
  }

  return [...byKind.entries()]
    .map(([kind, it]) => ({ kind, days: it.days, hours: it.hours }))
    // От крупного к мелкому — по ЧАСАМ, а не по суткам: у вызовов сутки
    // разной цены (шесть часов и двадцать четыре), и перечень читают,
    // чтобы увидеть, что принесло часы.
    .sort((a, b) => b.hours.comparedTo(a.hours) || a.kind.localeCompare(b.kind));
}

const EMPTY_MONTH = {
  empty: true,
  normHours: ZERO,
  baseNormHours: ZERO,
  excludedHours: ZERO,
  actualHours: ZERO,
  nightHours: ZERO,
  holidayHours: ZERO,
  workedShifts: 0,
  scheduledShifts: 0,
  absentShifts: 0,
  balance: ZERO,
} as const;

/** Границы отрезка, обрезанные и началом отсчёта, и сегодняшним днём. */
function bounds(
  profile: StoredProfile,
  raw: { periodStart: IsoDate; periodEnd: IsoDate },
  today: IsoDate,
) {
  const counted = countedBounds(raw, profile.countFrom);
  return profile.liveMode ? liveBounds(counted, today) : counted;
}

/**
 * Итог года одного профиля — одним расчётом.
 *
 * Год берётся у самого профиля (`accountingYear`), а не задаётся снаружи:
 * у каждого профиля он свой, и перечень, посчитавший их все по году
 * открытого, показал бы шесть чужих лет под одной шапкой.
 */
export function totalsOf(
  profile: StoredProfile,
  today = todayIso(),
): ProfileTotals {
  const year = profile.accountingYear;
  const whole = bounds(profile, statutoryBounds(year, "year", 0), today);
  const total = calculateFor(profile, whole.periodStart, whole.periodEnd);
  const callouts = calloutsOf(total);

  return {
    year,
    total,
    absences: absencesOf(total),
    callouts,
    calloutHours: callouts.reduce((sum, it) => sum.plus(it.hours), ZERO),
    balance: total.actualHours.minus(total.normHours),
    any: whole.periodStart < whole.periodEnd,
  };
}

export function statisticsOf(profile: StoredProfile, today = todayIso()): Statistics {
  const year = profile.accountingYear;
  const totals = totalsOf(profile, today);

  const months: MonthStat[] = [];
  const running: Decimal[] = [];
  let carried = ZERO;

  for (let month = 0; month < 12; month += 1) {
    const span = bounds(profile, monthBounds(year, month), today);
    if (span.periodStart >= span.periodEnd) {
      months.push({ month, ...EMPTY_MONTH });
      running.push(carried);
      continue;
    }

    const it = calculateFor(profile, span.periodStart, span.periodEnd);
    const balance = it.actualHours.minus(it.normHours);
    carried = carried.plus(balance);
    months.push({
      month,
      empty: false,
      normHours: it.normHours,
      baseNormHours: it.baseNormHours,
      excludedHours: it.excludedHours,
      actualHours: it.actualHours,
      nightHours: it.nightHours,
      holidayHours: it.holidayHours,
      workedShifts: it.workedShifts,
      scheduledShifts: it.scheduledShifts,
      absentShifts: it.absentShifts,
      balance,
    });
    running.push(carried);
  }

  return { ...totals, months, running };
}

/** Наибольшее из чисел — мерка высоты для столбцов. Ноль не годится в делители. */
export function peakOf(values: readonly Decimal[]): Decimal {
  let top = ZERO;
  for (const value of values) if (value.greaterThan(top)) top = value;
  return top.isZero() ? new Dec(1) : top;
}
