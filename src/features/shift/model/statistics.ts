import { Dec, ZERO, type Decimal } from "../domain/decimal";
import type { AbsenceKind } from "../domain/value-objects";
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

export interface Statistics {
  readonly year: number;
  readonly months: readonly MonthStat[];
  /** Год целиком — тем же расчётом, а не суммой месяцев. */
  readonly total: PeriodCalculation;
  readonly absences: readonly AbsenceStat[];
  /**
   * Накопленный баланс на конец каждого месяца.
   *
   * Копится он сложением МЕСЯЧНЫХ балансов, а не пересчётом года по кусок:
   * двенадцать точек — это ровно двенадцать месячных расчётов, уже
   * сделанных, и лишняя дюжина вызовов ради того же числа не нужна.
   * Пустые месяцы линию не двигают.
   */
  readonly running: readonly Decimal[];
  /** Есть ли вообще что показывать: хоть один непустой месяц. */
  readonly any: boolean;
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

export function statisticsOf(profile: StoredProfile, today = todayIso()): Statistics {
  const year = profile.accountingYear;
  const whole = bounds(profile, statutoryBounds(year, "year", 0), today);
  const total = calculateFor(profile, whole.periodStart, whole.periodEnd);

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

  return {
    year,
    months,
    total,
    absences: absencesOf(total),
    running,
    any: months.some((it) => !it.empty),
  };
}

/** Наибольшее из чисел — мерка высоты для столбцов. Ноль не годится в делители. */
export function peakOf(values: readonly Decimal[]): Decimal {
  let top = ZERO;
  for (const value of values) if (value.greaterThan(top)) top = value;
  return top.isZero() ? new Dec(1) : top;
}
