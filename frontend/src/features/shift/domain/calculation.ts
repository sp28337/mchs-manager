/**
 * Расчёт нормы и переработки при суммированном учёте.
 *
 * --- Что здесь считается и зачем ----------------------------------------
 *
 * Ровно то, вокруг чего возникают споры с работодателем. Порядок такой:
 *
 * 1. НОРМА УЧЁТНОГО ПЕРИОДА — сколько часов человек должен отработать,
 *    если бы работал по пятидневке: недельная норма, делённая на пять, на
 *    число рабочих дней производственного календаря, минус по часу за
 *    каждый предпраздничный день (ст. 95 ТК РФ).
 *
 * 2. ИСКЛЮЧЕНИЕ ОТСУТСТВИЙ — из нормы вычитаются часы ПО ГРАФИКУ,
 *    пришедшиеся на отпуск, больничный и иное освобождение с сохранением
 *    места работы (письмо Роструда от 01.03.2010 № 550-6-1).
 *
 * 3. ПЕРЕРАБОТКА — то, что отработано сверх уменьшенной нормы.
 *
 * --- Ошибка, ради обнаружения которой всё это написано ------------------
 *
 * Пункт 2 нарушают двумя способами, и оба дают одинаковый результат — у
 * человека отнимают часы, которые он не должен:
 *
 * * норму оставляют полной, а из ФАКТА вычитают смены, попавшие в отпуск
 *   («минус 24 часа за смену»). Отпуск превращается в долг;
 * * норму оставляют полной и просто не отрабатывают отсутствие — тогда
 *   возникает недоработка, которой нет.
 *
 * Обе ошибки видны только тогда, когда норма и факт показаны раздельно и
 * рядом названа величина исключённых часов. Поэтому результат расчёта
 * несёт все три числа, а не одну итоговую разницу.
 *
 * --- Чего здесь нет -----------------------------------------------------
 *
 * Компенсации. Приказ МЧС России № 410 п. 14 прямо говорит: при
 * суммированном учёте ночные, выходные и праздничные часы В ПРЕДЕЛАХ
 * нормы дополнительным временем отдыха не компенсируются. Показывать их
 * как «положено сверху» значило бы обещать то, чего норма не даёт. Ночные
 * часы считаются и показываются — но как факт, а не как основание для
 * доплаты.
 */

import { Dec, ZERO, atLeastZero, type Decimal } from "./decimal";
import { addDays, type IsoDate } from "./plain-date";
import {
  NIGHT_HOURS_PER_SHIFT,
  SHIFT_DURATION_HOURS,
  SHIFT_START_HOUR,
  shiftDates,
  type AbsenceKind,
  type GuardCycle,
  type WeeklyNorm,
} from "./value-objects";

export const WORKING_DAYS_PER_WEEK = new Dec(5);

/** Ст. 95 ТК РФ: рабочий день накануне праздника короче на час. */
export const PRE_HOLIDAY_REDUCTION_HOURS = new Dec(1);

/** То, что даёт производственный календарь за период. */
export interface CalendarFacts {
  /**
   * Рабочие дни периода, ВКЛЮЧАЯ предпраздничные.
   *
   * Предпраздничный день — рабочий, сокращённый на час (ст. 95 ТК РФ), и
   * производственный календарь считает его среди рабочих: в апреле 2026
   * года 22 рабочих дня и 175 часов, то есть 22 × 8 − 1, а не 21 × 8.
   * Исключить его отсюда значило бы вычесть за него девять часов вместо
   * одного — по восемь часов нормы за каждый такой день в году.
   */
  readonly workingDays: number;

  /** Сколько из `workingDays` сокращены на час. */
  readonly preHolidayDays: number;
}

/**
 * Отсутствие с сохранением места службы или работы.
 *
 * Границы ВКЛЮЧИТЕЛЬНЫЕ — так их пишут в приказе об отпуске и в
 * больничном листе. Полуинтервалы, принятые в остальном коде, здесь были
 * бы источником ошибки на один день ровно там, где цена ошибки — сутки
 * чужого отдыха.
 */
export interface AbsencePeriod {
  readonly start: IsoDate;
  readonly endInclusive: IsoDate;
  readonly kind: AbsenceKind;
}

export function absenceCovers(absence: AbsencePeriod, day: IsoDate): boolean {
  return absence.start <= day && day <= absence.endInclusive;
}

/** Одна смена в расчёте. */
export interface ShiftRecord {
  readonly startedOn: IsoDate;
  readonly hours: Decimal;
  readonly nightHours: Decimal;
  readonly holidayHours: Decimal;
  readonly absenceKind: AbsenceKind | null;
}

/** Итог расчёта за учётный период. */
export interface PeriodCalculation {
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;

  readonly weeklyNorm: WeeklyNorm;
  readonly calendar: CalendarFacts;

  /** Норма периода без учёта отсутствий. */
  readonly baseNormHours: Decimal;

  /** Часы по графику, пришедшиеся на отсутствия. Вычитаются из нормы. */
  readonly excludedHours: Decimal;

  /** Норма к отработке: `baseNormHours − excludedHours`. */
  readonly normHours: Decimal;

  /** Фактически отработано. */
  readonly actualHours: Decimal;

  readonly nightHours: Decimal;
  readonly holidayHours: Decimal;

  readonly scheduledShifts: number;
  readonly workedShifts: number;
  readonly absentShifts: number;

  readonly shifts: readonly ShiftRecord[];

  /** Переработка. Ноль, если её нет, — отрицательной переработки не бывает. */
  readonly overtimeHours: Decimal;

  /** Недоработка. */
  readonly undertimeHours: Decimal;

  /**
   * Недоработка, которая получилась бы при НЕуменьшенной норме.
   *
   * Это не наш расчёт, а воспроизведение чужой ошибки: столько «долга»
   * увидит человек, если отсутствия из нормы не исключили. Величина нужна,
   * чтобы назвать цену расхождения — не «считают неверно», а «неверно на
   * столько-то часов».
   */
  readonly wrongNormUndertimeHours: Decimal;
}

/**
 * Норма периода по производственному календарю.
 *
 * `(недельная норма / 5) × рабочие дни − 1 час × предпраздничные дни`.
 *
 * Формула — общая для пятидневки и для сменного режима: при суммированном
 * учёте норма СМЕННИКА равна норме обычной пятидневки за тот же период
 * (ст. 104 ТК РФ). Это ровно то, что делает график «сутки через трое»
 * пригодным к проверке: часы в нём другие, а норма та же.
 */
export function baseNormHours(weekly: WeeklyNorm, calendar: CalendarFacts): Decimal {
  const daily = weekly.hours.dividedBy(WORKING_DAYS_PER_WEEK);
  return daily
    .times(calendar.workingDays)
    .minus(PRE_HOLIDAY_REDUCTION_HOURS.times(calendar.preHolidayDays));
}

/**
 * Часы смены, попадающие в полуинтервал `[periodStart, periodEnd)`.
 *
 * Смена начинается в 08:00 и идёт сутки, поэтому 16 её часов лежат в
 * сутках заступления, а 8 — в следующих. На границе месяца это
 * существенно: смена, заступившая 31 марта, даёт марту 16 часов, а апрелю
 * 8. Списывать все 24 на день заступления удобно, но неверно — и
 * расхождение с табелем работодателя возникло бы на ровном месте.
 */
function hoursInPeriod(
  startedOn: IsoDate,
  periodStart: IsoDate,
  periodEnd: IsoDate,
): Decimal {
  const firstDayHours = new Dec(24 - SHIFT_START_HOUR); // 08:00 -> 24:00
  const secondDayHours = SHIFT_DURATION_HOURS.minus(firstDayHours); // 00:00 -> 08:00

  let total = ZERO;
  if (periodStart <= startedOn && startedOn < periodEnd) {
    total = total.plus(firstDayHours);
  }
  const nextDay = addDays(startedOn, 1);
  if (periodStart <= nextDay && nextDay < periodEnd) {
    total = total.plus(secondDayHours);
  }
  return total;
}

export interface CalculatePeriodInput {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  cycle: GuardCycle;
  weekly: WeeklyNorm;
  calendar: CalendarFacts;
  absences: readonly AbsencePeriod[];
  holidayDays: ReadonlySet<IsoDate>;
}

/**
 * Полный расчёт периода по графику караула.
 *
 * `periodEnd` — исключающая граница, как во всём коде. `holidayDays` —
 * нерабочие праздничные дни календаря: часы, пришедшиеся на них,
 * считаются и показываются отдельно, хотя при суммированном учёте в
 * пределах нормы отдельной компенсации не дают (Приказ № 410 п. 14).
 */
export function calculatePeriod({
  periodStart,
  periodEnd,
  cycle,
  weekly,
  calendar,
  absences,
  holidayDays,
}: CalculatePeriodInput): PeriodCalculation {
  const shifts: ShiftRecord[] = [];
  let excluded = ZERO;
  let actual = ZERO;
  let nightTotal = ZERO;
  let holidayTotal = ZERO;

  // Просмотр начинается на СУТКИ РАНЬШЕ периода: смена, заступившая
  // накануне, отдаёт периоду свои последние 8 часов (с 00:00 до 08:00).
  // Начинать ровно с `periodStart` значило бы терять их у каждого месяца,
  // чей первый день — второй день чужой смены.
  //
  // Но не раньше первой смены года: цикл объявлен человеком на год, и
  // достраивать его в прошлый год значило бы выдумать смену, которой в
  // этом графике нет.
  const dayBefore = addDays(periodStart, -1);
  const scanFrom = dayBefore > cycle.firstShiftDate ? dayBefore : cycle.firstShiftDate;

  for (const startedOn of shiftDates(cycle, scanFrom, periodEnd)) {
    const hours = hoursInPeriod(startedOn, periodStart, periodEnd);
    if (hours.isZero()) continue;

    const absence = absences.find((item) => absenceCovers(item, startedOn));

    // Ночные и праздничные часы считаются пропорционально той части
    // смены, что попала в период: иначе смена на стыке месяцев дала бы 8
    // ночных часов дважды.
    const share = hours.dividedBy(SHIFT_DURATION_HOURS);
    const night = NIGHT_HOURS_PER_SHIFT.times(share);

    const nextDay = addDays(startedOn, 1);
    let holiday = ZERO;
    if (holidayDays.has(startedOn)) {
      holiday = holiday.plus(24 - SHIFT_START_HOUR);
    }
    if (holidayDays.has(nextDay)) {
      holiday = holiday.plus(SHIFT_DURATION_HOURS.minus(24 - SHIFT_START_HOUR));
    }

    shifts.push({
      startedOn,
      hours,
      nightHours: night,
      holidayHours: holiday,
      absenceKind: absence ? absence.kind : null,
    });

    if (absence === undefined) {
      actual = actual.plus(hours);
      nightTotal = nightTotal.plus(night);
      holidayTotal = holidayTotal.plus(holiday);
    } else {
      excluded = excluded.plus(hours);
    }
  }

  const base = baseNormHours(weekly, calendar);
  // Норма не уходит в минус: длительное отсутствие может перекрыть период
  // целиком, и отрицательная норма означала бы, что человек обязан
  // «недоработать».
  const norm = atLeastZero(base.minus(excluded));

  const worked = shifts.filter((shift) => shift.absenceKind === null).length;

  return {
    periodStart,
    periodEnd,
    weeklyNorm: weekly,
    calendar,
    baseNormHours: base,
    excludedHours: excluded,
    normHours: norm,
    actualHours: actual,
    nightHours: nightTotal,
    holidayHours: holidayTotal,
    scheduledShifts: shifts.length,
    workedShifts: worked,
    absentShifts: shifts.length - worked,
    shifts,
    overtimeHours: atLeastZero(actual.minus(norm)),
    undertimeHours: atLeastZero(norm.minus(actual)),
    wrongNormUndertimeHours: atLeastZero(base.minus(actual)),
  };
}
