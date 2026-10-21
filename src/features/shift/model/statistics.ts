import { Dec, ZERO, type Decimal } from "../domain/decimal";
import type {
  AbsenceKind,
  AccountingPeriodKind,
  CalloutKind,
} from "../domain/value-objects";
import type { PeriodCalculation } from "../domain/calculation";
import { addDays, daysBetween, todayIso, type IsoDate } from "../domain/plain-date";
import type { StoredProfile } from "../storage/profile";
import {
  calculateFor,
  countedBounds,
  liveBounds,
  monthBounds,
  statutoryBounds,
} from "./derive";

/**
 * Учётный период, разложенный по месяцам, — то, из чего собрана статистика.
 *
 * --- Почему выбранный период, а не всегда год ----------------------------
 *
 * Сначала статистика считала год всегда, какой бы период ни стоял на
 * экране: казалось, что ход переработки по трём точкам квартала — не ход.
 * На деле человек, выбравший квартал, спрашивает статистику о квартале —
 * о том же отрезке, за который полоса наверху показывает норму и
 * переработку, — и годовые числа под квартальной полосой читались как
 * ошибка: два ответа на один вопрос, и разные.
 *
 * Поэтому отрезок у статистики тот же, что у полосы: доля года из шапки
 * (`part`) в учётном году профиля (`accountingYear`). Месяцы — только те,
 * что в неё входят, а накопленный баланс — от её начала.
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
 * полоса наверху. За год это тринадцать вызовов на открытие окна
 * — и они на нём не сказываются: замером окно статистики открывается
 * БЫСТРЕЕ окна настроек (230 мс против 287 на обычной скорости и 1084
 * против 1399 при вчетверо замедленном процессоре). Всё это время — само
 * появление окна и отрисовка, а не счёт.
 *
 * --- Что делает «Онлайн» --------------------------------------------------
 *
 * Обрезает период сегодняшним днём — тем же `liveBounds`, что и везде. Месяцы
 * после сегодняшнего от этого становятся пустыми отрезками, и это не
 * «ноль часов», а «ещё не наступил»: столбца у них нет вовсе, а ход
 * накопления на них обрывается. Показать будущему месяцу норму без факта
 * значило бы нарисовать провал там, где просто не наступило время.
 */

/**
 * Доля учётного года — год, полугодие или квартал — с номером внутри года.
 * Та же пара, что выбирается кнопкой периода в шапке.
 */
export interface PeriodPart {
  readonly kind: AccountingPeriodKind;
  readonly index: number;
}

/** Год целиком — то, что статистика считает, пока долю не выбрали. */
export const WHOLE_YEAR: PeriodPart = { kind: "year", index: 0 };

/** Сколько месяцев в доле такого вида. */
function monthsOf(kind: AccountingPeriodKind): number {
  return kind === "quarter" ? 3 : kind === "half_year" ? 6 : 12;
}

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
 * Заметка к событию: своя у записи или дневная.
 *
 * Их две породы, и различать их надо. У отпуска заметка лежит в самой
 * записи (`note`) и относится ко всему отрезку — «за дежурство 3 января».
 * Дневная (`dayNotes`) привязана к суткам и бывает нужна и там, где не
 * отмечено ничего; попав внутрь отрезка, она объясняет уже не весь отрезок,
 * а один его день. Поэтому у дневной стоит её дата, а у своей — `null`: в
 * перечне на несколько суток день назвать придётся, иначе заметка повиснет
 * непонятно к чему.
 */
export interface EventNote {
  readonly day: IsoDate | null;
  readonly text: string;
}

/**
 * Одна запись сверх графика — как её внесли.
 *
 * --- Почему запись, а не вид -------------------------------------------------
 *
 * Сложенные по видам часы отвечают на вопрос «сколько всего», и он второй.
 * Первый — «когда это было»: человек спорит не с числом, а с конкретным
 * выходом, у которого есть дата, распоряжение и его собственная пометка о
 * том, за что его вызвали. Строка «Вызов — 4 дня, 32 ч» на этот вопрос не
 * отвечает вовсе, а четыре даты с заметками отвечают.
 */
export interface CalloutEntry {
  readonly id: string;
  readonly kind: CalloutKind;
  /** Отрезок, уже обрезанный годом: запись вправе выходить за его край. */
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly days: number;
  readonly hours: Decimal;
  readonly notes: readonly EventNote[];
}

/** Одна запись освобождения — как её внесли. Парой к `CalloutEntry`. */
export interface AbsenceEntry {
  readonly id: string;
  readonly kind: AbsenceKind;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly days: number;
  readonly notes: readonly EventNote[];
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
  /** Доля года, за которую посчитано всё остальное. */
  readonly part: PeriodPart;
  /** Период целиком — тем же расчётом, а не суммой месяцев. */
  readonly total: PeriodCalculation;
  readonly absences: readonly AbsenceStat[];
  readonly callouts: readonly CalloutStat[];
  /**
   * Те же события, но поимённо: каждая внесённая запись своей строкой.
   *
   * Лежат в итоге профиля, а не только в полной статистике, потому что их
   * показывает и свод по всем: строка человека в нём раскрывается в его
   * вызовы и отпуска по одному. Расчёта они не стоят — это перебор записей
   * профиля с обрезкой по году, — и держать ради них второй, более
   * дорогой вызов было бы незачем.
   */
  readonly calloutEntries: readonly CalloutEntry[];
  readonly absenceEntries: readonly AbsenceEntry[];
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

/**
 * Записи, попавшие в год, — с обрезкой по его краям.
 *
 * --- Почему обрезка здесь, а не «как внесли» ---------------------------------
 *
 * Запись живёт своей жизнью: сбор с 28 декабря по 4 января лежит в двух
 * годах сразу, и расчёт берёт из него ровно те сутки, что попали в отрезок
 * (`calculation.ts`). Перечень обязан говорить то же самое — иначе строка
 * назовёт пять суток там, где в часы года вошло четверо, и человек пойдёт
 * искать несуществующую ошибку. Запись, не попавшая в год ни одним днём, из
 * перечня уходит совсем.
 *
 * --- Заметки -----------------------------------------------------------------
 *
 * Своя заметка записи идёт первой и без даты — она про весь отрезок.
 * Дневные собираются по суткам отрезка, в их порядке, и каждая помнит свой
 * день: на записи в неделю «подменял Петрова» без даты бесполезно.
 */
function clip(
  record: { readonly startsOn: string; readonly endsOn: string },
  span: { periodStart: IsoDate; periodEnd: IsoDate },
): { from: IsoDate; to: IsoDate; days: number } | null {
  const from = (record.startsOn > span.periodStart
    ? record.startsOn
    : span.periodStart) as IsoDate;
  // Конец отрезка исключающий, а запись названа последним своим днём:
  // сравнивать их напрямую нельзя.
  const last = addDays(span.periodEnd, -1);
  const to = (record.endsOn < last ? record.endsOn : last) as IsoDate;
  if (from > to) return null;
  return { from, to, days: daysBetween(from, to) + 1 };
}

function notesOf(
  profile: StoredProfile,
  own: string | null | undefined,
  from: IsoDate,
  to: IsoDate,
): EventNote[] {
  const notes: EventNote[] = [];
  if (own !== null && own !== undefined && own.trim() !== "") {
    notes.push({ day: null, text: own.trim() });
  }
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const text = profile.dayNotes[day];
    if (text !== undefined && text.trim() !== "") {
      notes.push({ day, text: text.trim() });
    }
  }
  return notes;
}

function calloutEntriesOf(
  profile: StoredProfile,
  span: { periodStart: IsoDate; periodEnd: IsoDate },
): CalloutEntry[] {
  const entries: CalloutEntry[] = [];

  for (const it of profile.callouts) {
    const cut = clip(it, span);
    if (cut === null) continue;
    entries.push({
      id: it.id,
      kind: it.kind,
      ...cut,
      // Часы — те же, что взял расчёт: столько-то в сутки на каждые
      // попавшие в год сутки (`calculation.ts`).
      hours: new Dec(it.hoursPerDay).times(cut.days),
      notes: notesOf(profile, null, cut.from, cut.to),
    });
  }

  // По дате, а не по часам: перечень отвечает на вопрос «когда это было»,
  // и год в нём читают по порядку. Одна дата на двоих разводится видом —
  // чтобы порядок не менялся от перерисовки к перерисовке.
  return entries.sort(
    (a, b) => a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind),
  );
}

function absenceEntriesOf(
  profile: StoredProfile,
  span: { periodStart: IsoDate; periodEnd: IsoDate },
): AbsenceEntry[] {
  const entries: AbsenceEntry[] = [];

  for (const it of profile.absences) {
    const cut = clip(it, span);
    if (cut === null) continue;
    entries.push({
      id: it.id,
      kind: it.kind,
      ...cut,
      notes: notesOf(profile, it.note, cut.from, cut.to),
    });
  }

  return entries.sort((a, b) => a.from.localeCompare(b.from));
}

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
 * Итог периода одного профиля — одним расчётом.
 *
 * Год берётся у самого профиля (`accountingYear`), а не задаётся снаружи:
 * у каждого профиля он свой, и перечень, посчитавший их все по году
 * открытого, показал бы шесть чужих лет под одной шапкой. Доля года
 * (`part`) — общая: её выбирают кнопкой в шапке, и свод по всем
 * профилям считает каждому ту же долю его собственного года.
 */
export function totalsOf(
  profile: StoredProfile,
  today = todayIso(),
  part: PeriodPart = WHOLE_YEAR,
): ProfileTotals {
  const year = profile.accountingYear;
  const whole = bounds(profile, statutoryBounds(year, part.kind, part.index), today);
  const total = calculateFor(profile, whole.periodStart, whole.periodEnd);
  const callouts = calloutsOf(total);

  return {
    year,
    part,
    total,
    absences: absencesOf(total),
    callouts,
    calloutEntries: calloutEntriesOf(profile, whole),
    absenceEntries: absenceEntriesOf(profile, whole),
    calloutHours: callouts.reduce((sum, it) => sum.plus(it.hours), ZERO),
    balance: total.actualHours.minus(total.normHours),
    any: whole.periodStart < whole.periodEnd,
  };
}

export function statisticsOf(
  profile: StoredProfile,
  today = todayIso(),
  part: PeriodPart = WHOLE_YEAR,
): Statistics {
  const year = profile.accountingYear;
  const totals = totalsOf(profile, today, part);

  const months: MonthStat[] = [];
  const running: Decimal[] = [];
  let carried = ZERO;

  // Только месяцы выбранной доли, и баланс копится от её начала.
  const first = part.index * monthsOf(part.kind);
  for (let month = first; month < first + monthsOf(part.kind); month += 1) {
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
