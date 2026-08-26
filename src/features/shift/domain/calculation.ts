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
import { addDays, datesInRange, type IsoDate } from "./plain-date";
import {
  DEFAULT_SHIFT_START,
  minutesToHours,
  shiftStartMinute,
  splitShift,
  shiftMinutes,
  MINUTES_PER_HOUR,
} from "./shift-hours";
import {
  ABSENCE_REDUCES_NORM,
  shiftDates,
  type AbsenceKind,
  type CalloutKind,
  type ShiftCycle,
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
 * Отсутствие с сохранением места работы.
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

/**
 * Вызов помимо своей смены: соревнования, сбор, резерв, мероприятие,
 * выборы.
 *
 * Часы задаются на сутки, а не на весь период: вызов на трёхдневный сбор —
 * это три раза по столько-то часов, и человек знает эту цифру из
 * распоряжения. Просить его перемножить в уме значило бы получить в
 * расчёте округление вместо факта.
 */
export interface CalloutPeriod {
  readonly start: IsoDate;
  readonly endInclusive: IsoDate;
  readonly kind: CalloutKind;
  readonly hoursPerDay: Decimal;
}

/** Одна смена в расчёте. Часы — только те, что попали в период. */
export interface ShiftRecord {
  readonly startedOn: IsoDate;
  readonly hours: Decimal;
  readonly nightHours: Decimal;
  readonly holidayHours: Decimal;
  readonly absenceKind: AbsenceKind | null;
}

/**
 * Часы, пришедшиеся на одни календарные сутки.
 *
 * Смена лежит в двух днях, и месячный итог обязан считаться по СУТКАМ, а
 * не по дате начала: иначе смене, начавшейся 31 марта, март получал
 * бы все 24 часа, хотя 8,5 из них отработаны 1 апреля. У человека при
 * таком счёте расходится с табелем и месячная сумма, и число ночных.
 */
export interface DayRecord {
  readonly day: IsoDate;
  readonly hours: Decimal;
  readonly nightHours: Decimal;
  readonly holidayHours: Decimal;
  /** Заступление в этих сутках, а не продолжение смены с прошлых. */
  readonly isShiftStart: boolean;
  readonly absenceKind: AbsenceKind | null;
  /** Куда вызывали в эти сутки помимо своей смены. */
  readonly calloutKind?: CalloutKind | null;
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

  /**
   * Те же часы, но разложенные по календарным суткам периода.
   *
   * Из этого строится график: месячный итог — сумма суток месяца, и он
   * сходится с тем, что видно в клетках.
   */
  readonly days: readonly DayRecord[];

  /**
   * ВСЕ сутки периода, накрытые освобождением, и чем именно.
   *
   * --- Зачем это отдельно от `days` ----------------------------------------
   *
   * `days` — часы, а у отпуска в выходной по графику часов нет: сутки,
   * попавшие в отпуск между сменами, в `days` не появляются вовсе. На
   * графике из-за этого отпуск с 1 по 5 показывался одной клеткой — той,
   * где стояла смена, — и человек видел «смена попала в отпуск» вместо
   * «отпуск идёт по пятое». Границы отпуска, то есть ровно то, о чём
   * спорят, на экране не было.
   *
   * Сюда же класть нулевые часы нельзя: `days` складывают, и запись «ноль
   * часов, отпуск» пришлось бы отличать от настоящих суток в каждом
   * месте, где по ним идёт счёт.
   *
   * Правило накрытия одно на всё приложение (`absenceCovers`), и второй
   * его копии в разметке быть не должно: разойдись они на день — и
   * нарисованный отпуск перестанет совпадать с посчитанным.
   */
  readonly absentDays: ReadonlyMap<IsoDate, AbsenceKind>;

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

export interface CalculatePeriodInput {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  cycle: ShiftCycle;
  weekly: WeeklyNorm;
  calendar: CalendarFacts;
  absences: readonly AbsencePeriod[];
  /** Вызовы помимо графика. Их часы прибавляются к отработанному. */
  callouts?: readonly CalloutPeriod[];
  holidayDays: ReadonlySet<IsoDate>;
  /**
   * Рабочие дни производственного календаря в периоде, включая
   * предпраздничные. По ним считается, сколько НОРМЫ приходится на
   * отсутствие.
   */
  workingDays: ReadonlySet<IsoDate>;
  /** Из них сокращённые на час (ст. 95 ТК РФ). */
  preHolidayDays: ReadonlySet<IsoDate>;
  /**
   * Время начала смены, «ЧЧ:ММ».
   *
   * От него зависит, как смена делится между сутками, а значит — месячные
   * итоги и число ночных на стыке месяцев.
   */
  shiftStartTime?: string;
  /**
   * Продолжительность смены в часах, строкой.
   *
   * Зависит от графика: сутки через трое — 24, два через два — 12,
   * пятидневка — 8. Умолчание суточное, тот график, с которого приложение
   * начиналось.
   */
  shiftDurationHours?: string;
}

/**
 * На сколько суток раньше периода начинается просмотр смен.
 *
 * Смена, начавшаяся накануне, отдаёт периоду свой хвост — с полуночи до
 * развода. Число вынесено сюда, потому что по нему же строится множество
 * рабочих дней календаря для пятидневки: разойдись они — и первый день
 * периода терял бы смену.
 */
export const SCAN_LEAD_DAYS = 1;

/**
 * Полный расчёт периода по графику смен.
 *
 * `periodEnd` — исключающая граница, как во всём коде. `holidayDays` —
 * нерабочие праздничные дни календаря: часы, пришедшиеся на них,
 * считаются и показываются отдельно.
 */
export function calculatePeriod({
  periodStart,
  periodEnd,
  cycle,
  weekly,
  calendar,
  absences,
  callouts = [],
  holidayDays,
  workingDays,
  preHolidayDays,
  shiftStartTime = DEFAULT_SHIFT_START,
  shiftDurationHours,
}: CalculatePeriodInput): PeriodCalculation {
  const startMinute = shiftStartMinute(shiftStartTime);
  const durationMinutes = shiftMinutes(shiftDurationHours);

  const shifts: ShiftRecord[] = [];
  const days: DayRecord[] = [];
  let excluded = ZERO;
  let actual = ZERO;
  let nightTotal = ZERO;
  let holidayTotal = ZERO;

  // Просмотр начинается на СУТКИ РАНЬШЕ периода: смена, начавшаяся
  // накануне, отдаёт периоду свой хвост (с полуночи до развода). Начинать
  // ровно с `periodStart` значило бы терять его у каждого месяца, чей
  // первый день — вторые сутки чужой смены.
  //
  // Раньше просмотр обрезался ещё и первой сменой года: цикл объявлялся на
  // год, и достраивать его назад значило выдумать смену, которой в графике
  // нет. Теперь человек называет ЛЮБУЮ свою смену, и цикл от неё
  // продолжается в обе стороны — обрезать не по чему и не за чем.
  const scanFrom = addDays(periodStart, -SCAN_LEAD_DAYS);
  const calendarDriven = cycle.pattern?.source === "calendar";

  for (const startedOn of shiftDates(cycle, scanFrom, periodEnd)) {
    // Отсутствие определяется по дате ЗАСТУПЛЕНИЯ, а не по каждым суткам:
    // в отпуск человека отпускают со смены, и смена, начавшаяся до
    // отпуска, дорабатывается целиком.
    const absence = absences.find((item) => absenceCovers(item, startedOn));
    const kind = absence ? absence.kind : null;

    // Предпраздничный день короче на час (ст. 95 ТК РФ) — но только там,
    // где смена и есть рабочий день календаря. У сменных графиков
    // предпраздничное сокращение к суточной смене не применяется: она идёт
    // как идёт, а час учитывается нормой периода.
    //
    // Без этой поправки у пятидневки появлялась бы переработка из ничего:
    // норма вычитает за предпраздничный день час, а факт его не вычитал —
    // и год заканчивался лишними часами, которых человек не работал.
    const shiftMinutesHere =
      calendarDriven && preHolidayDays.has(startedOn)
        ? Math.max(0, durationMinutes - MINUTES_PER_HOUR)
        : durationMinutes;

    const inPeriod = splitShift(startedOn, startMinute, shiftMinutesHere).filter(
      (part) => periodStart <= part.day && part.day < periodEnd,
    );
    if (inPeriod.length === 0) continue;

    let shiftHours = ZERO;
    let shiftNight = ZERO;
    let shiftHoliday = ZERO;

    for (const part of inPeriod) {
      const hours = minutesToHours(part.minutes);
      const night = minutesToHours(part.nightMinutes);
      // Праздничные — по тому, праздничны ли САМИ эти сутки (ст. 112 ТК
      // РФ). Смена, начавшаяся 8 марта и кончившаяся 9-го, даёт
      // праздничными только свою первую часть.
      const holiday = holidayDays.has(part.day) ? hours : ZERO;

      days.push({
        day: part.day,
        hours,
        nightHours: night,
        holidayHours: holiday,
        isShiftStart: part.isStart,
        absenceKind: kind,
      });

      shiftHours = shiftHours.plus(hours);
      shiftNight = shiftNight.plus(night);
      shiftHoliday = shiftHoliday.plus(holiday);
    }

    shifts.push({
      startedOn,
      hours: shiftHours,
      nightHours: shiftNight,
      holidayHours: shiftHoliday,
      absenceKind: kind,
    });

    if (kind === null) {
      actual = actual.plus(shiftHours);
      nightTotal = nightTotal.plus(shiftNight);
      holidayTotal = holidayTotal.plus(shiftHoliday);
    }
  }

  // Из нормы вычитаются часы ПО НОРМЕ, пришедшиеся на отсутствие, а не
  // часы по графику смен (письмо Роструда от 01.03.2010 № 550-6-1).
  //
  // Разница не тонкость. Норма считается по пятидневке (ст. 104 ТК РФ),
  // поэтому за каждый рабочий день отпуска из неё уходит 8 часов при
  // сорокачасовой неделе — независимо от того, была ли в этот день смена и
  // сколько она длилась. Вычитать по 24 часа за каждую попавшую в отпуск
  // смену значило бы снимать больше, чем в норме за эти дни было: на две
  // недели отпуска у сменщика приходится 3-4 смены (72-96 часов), а нормы
  // за те же дни — 10 рабочих дней по 8, то есть 80.
  //
  // Ошибка в эту сторону занижает норму, а заниженная норма выдумывает
  // переработку так же охотно, как завышенная её прячет.
  const dailyNorm = weekly.hours.dividedBy(WORKING_DAYS_PER_WEEK);
  for (const day of workingDays) {
    if (day < periodStart || day >= periodEnd) continue;
    // Отгул норму не уменьшает: он расплачивается уже накопленной
    // переработкой, а не освобождает от неё.
    const covering = absences.find((item) => absenceCovers(item, day));
    if (!covering || !ABSENCE_REDUCES_NORM[covering.kind]) continue;
    excluded = excluded.plus(dailyNorm);
    if (preHolidayDays.has(day)) excluded = excluded.minus(PRE_HOLIDAY_REDUCTION_HOURS);
  }

  // Вызовы. Это исполнение обязанностей, то есть служебное время
  // (ст. 54 ФЗ-141, ст. 91 ТК РФ): часы идут в ОТРАБОТАННОЕ и норму не
  // трогают. Ночные по ним не считаются — распоряжение о вызове задаёт
  // число часов, а не время суток, и раскладывать их по часам было бы
  // выдумкой.
  for (const callout of callouts) {
    let cursor = callout.start > periodStart ? callout.start : periodStart;
    while (cursor <= callout.endInclusive && cursor < periodEnd) {
      actual = actual.plus(callout.hoursPerDay);
      days.push({
        day: cursor,
        hours: callout.hoursPerDay,
        nightHours: ZERO,
        holidayHours: holidayDays.has(cursor) ? callout.hoursPerDay : ZERO,
        isShiftStart: false,
        absenceKind: null,
        calloutKind: callout.kind,
      });
      if (holidayDays.has(cursor)) {
        holidayTotal = holidayTotal.plus(callout.hoursPerDay);
      }
      cursor = addDays(cursor, 1);
    }
  }

  days.sort((left, right) => left.day.localeCompare(right.day));

  // Накрытые сутки — по календарю, а не по сменам: отпуск идёт подряд, и
  // выходные по графику внутри него — такой же отпуск, как день со сменой.
  const absentDays = new Map<IsoDate, AbsenceKind>();
  for (const day of datesInRange(periodStart, periodEnd)) {
    const covering = absences.find((item) => absenceCovers(item, day));
    if (covering) absentDays.set(day, covering.kind);
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
    days,
    absentDays,
    overtimeHours: atLeastZero(actual.minus(norm)),
    undertimeHours: atLeastZero(norm.minus(actual)),
    wrongNormUndertimeHours: atLeastZero(base.minus(actual)),
  };
}
