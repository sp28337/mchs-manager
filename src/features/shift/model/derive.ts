/**
 * Связка «сохранённый профиль → расчёт периода».
 *
 * Тонкий слой между тем, что человек ввёл, и доменом, который считает.
 * Отдельно от домена, потому что домен ничего не знает про хранилище, и
 * отдельно от экранов, потому что экраны ничего не должны знать про
 * порядок вывода нормы.
 */

import { Dec, parseHours, type Decimal } from "../domain/decimal";
import {
  calculatePeriod,
  SCAN_LEAD_DAYS,
  type AbsencePeriod,
  type CalloutPeriod,
  type PeriodCalculation,
} from "../domain/calculation";
import { statutoryCalendar, calendarFactsFor, type DayType } from "../domain/production-calendar";
import { addDays, type IsoDate } from "../domain/plain-date";
import {
  resolveSchedulePattern,
  type SchedulePattern,
} from "../domain/schedule-pattern";
import {
  ACCOUNTING_PERIODS,
  deriveWeeklyNorm,
  onShiftCycle,
  weeklyNormGroundOf,
  weeklyNormGroundToFacts,
  type AbsenceKind,
  type AccountingPeriodKind,
  type CalloutKind,
  type WeeklyNorm,
  type WeeklyNormGround,
  type WeeklyNormInput,
} from "../domain/value-objects";
import {
  MINUTES_PER_HOUR,
  shiftMinutes,
  spanMinutes,
  spanFrom,
  type ShiftSpan,
} from "../domain/shift-hours";
import {
  overridesOf,
  shiftOverridesOf,
  shiftTimesOf,
  type StoredProfile,
} from "../storage/profile";

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
    // Строка из профиля разбирается ЗДЕСЬ, на границе с доменом: домен
    // считает числами и о том, что часы где-то лежат строкой, знать не
    // должен. Мусор и пустое дают `null` — то есть «своей нормы нет».
    customHours: profile.weeklyNormHours === null ? null : parseHours(profile.weeklyNormHours),
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
  /**
   * Чем заполнить своё поле, когда выбрано «Настроить».
   *
   * Пустым его оставлять нельзя: пустое значит «своей нормы нет», и выбор
   * тут же откатился бы к сорока часам — человек нажал бы «Настроить» и увидел
   * прежнее. Поэтому поле открывается с той нормой, что действует сейчас:
   * её и правят.
   */
  hours = "",
): Pick<
  StoredProfile,
  "workingConditions" | "disabilityGroupIorII" | "weeklyNormHours"
> {
  const facts = weeklyNormGroundToFacts(ground);
  return {
    workingConditions: facts.conditions,
    disabilityGroupIorII: facts.disabilityGroupIorII,
    // Выбрано основание из закона — своя норма снимается: иначе она
    // продолжала бы перебивать выбранное, и список показывал бы одно, а
    // расчёт считал другое.
    weeklyNormHours: ground === "custom" ? hours : null,
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
  const overrides = overridesByYear(profile);
  const facts = calendarFactsFor(periodStart, periodEnd, overrides);

  // Отдельный, СДВИНУТЫЙ НАЗАД просмотр календаря — для графиков, которые
  // строятся по нему (пятидневка). Он шире периода ровно на то, на сколько
  // расчёт заглядывает назад: смена, начавшаяся накануне, отдаёт периоду
  // свой хвост, и без этих суток первое число месяца теряло бы её.
  //
  // Расширять сами `facts` нельзя: по ним считается НОРМА, и лишние сутки
  // добавили бы к ней чужой рабочий день.
  const scheduleFacts = calendarFactsFor(
    addDays(periodStart, -SCAN_LEAD_DAYS),
    periodEnd,
    overrides,
  );

  return calculatePeriod({
    periodStart,
    periodEnd,
    cycle: {
      // Хранилище зовёт это поле `firstShiftDate` с тех пор, когда
      // спрашивали именно первую смену года. Смысл теперь другой — любая
      // известная смена, — но переименовывать ключ значило бы сломать
      // сохранённые файлы профилей ради названия.
      knownShiftDate: profile.firstShiftDate,
      pattern: patternOfProfile(profile),
      workingDays: scheduleFacts.workingDaySet,
      overrides: shiftOverridesOf(profile),
    },
    weekly: weeklyNormOf(profile),
    calendar: { workingDays: facts.workingDays, preHolidayDays: facts.preHolidayDays },
    absences: absencePeriodsOf(profile),
    callouts: calloutPeriodsOf(profile),
    holidayDays: facts.holidays,
    workingDays: facts.workingDaySet,
    preHolidayDays: facts.preHolidayDaySet,
    shiftStartTime: profile.shiftStartTime,
    shiftDurationHours: profile.shiftDurationHours,
    shiftSpans: shiftTimesOf(profile),
  });
}


/**
 * Итог одного месяца — та же норма, тот же факт и та же разница, что в
 * полосе итога наверху, только за месяц.
 */
export interface MonthTotal {
  readonly normHours: Decimal;
  readonly actualHours: Decimal;
  readonly overtimeHours: Decimal;
  readonly undertimeHours: Decimal;
}

/**
 * Итоги месяцев отрезка — для подписи над каждым месяцем сетки.
 *
 * --- Почему расчётом, а не суммой клеток -----------------------------------
 *
 * Факт месяца можно сложить из суток, а норму — нельзя: она не лежит в
 * клетках, её выводят из производственного календаря, недельной нормы и
 * отсутствий (ст. 104 ТК РФ), и отпуск в середине месяца уменьшает её на
 * свои часы. Повторить этот вывод в разметке значило бы завести второе
 * правило нормы рядом с первым — и однажды они бы разошлись. Поэтому
 * каждый месяц считается тем же `calculateFor`, что и полоса наверху:
 * правило одно, меняется только отрезок.
 *
 * --- Какой отрезок у месяца ------------------------------------------------
 *
 * Пересечение месяца с отрезком сетки: месяц на краю периода (начало
 * отсчёта в середине марта) считается с того же числа, что и сам период.
 * В режиме «Онлайн» (`upcoming`) месяц обрезается сегодняшним днём — это
 * итог на сегодня, тот же, что в полосе. Месяца, целиком лежащего после
 * сегодня, в итогах нет вовсе: «норма 160, факт 0, недоработка 160» над
 * месяцем, который ещё не наступил, было бы неправдой.
 *
 * --- Почему разницы месяцев не складываются в разницу периода --------------
 *
 * И не должны. Переработка периода — это факт периода против нормы
 * периода, и недоработка марта гасится переработкой апреля. Над месяцем
 * стоит разница ЭТОГО месяца: где набежало и где не добрал. Сами нормы и
 * факты месяцев при этом складываются ровно в норму и факт периода —
 * это проверено тестом.
 *
 * Ключ — `2026-03`: год и месяц, как они стоят в датах.
 */
export function monthTotalsFor(
  profile: StoredProfile,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  upcoming: IsoDate | null,
): ReadonlyMap<string, MonthTotal> {
  const totals = new Map<string, MonthTotal>();
  const end = upcoming !== null && upcoming < periodEnd ? upcoming : periodEnd;

  let cursor = periodStart;
  while (cursor < end) {
    const year = Number(cursor.slice(0, 4));
    const month = Number(cursor.slice(5, 7)) - 1;
    const next = monthBounds(year, month).periodEnd;
    const monthEnd = next < end ? next : end;

    const calculation = calculateFor(profile, cursor, monthEnd);
    totals.set(cursor.slice(0, 7), {
      normHours: calculation.normHours,
      actualHours: calculation.actualHours,
      overtimeHours: calculation.overtimeHours,
      undertimeHours: calculation.undertimeHours,
    });

    cursor = next;
  }

  return totals;
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
 * в конце. А человек ведёт учёт СЕЙЧАС: ему нужно знать, сколько
 * переработки набежало к сегодняшнему дню, — иначе весь расчёт до декабря
 * показывает норму, которую он ещё не должен был отработать, и «недоработку»
 * в сотни часов.
 *
 * --- Почему начало НЕ сдвигается ------------------------------------------
 *
 * Сдвигалось: до первой смены человек в этом графике не работал, и часы
 * за те сутки были не его. Держалось это на том, что названная дата —
 * начало работы по графику.
 *
 * Теперь человек называет ЛЮБУЮ свою смену, в том числе завтрашнюю, и о
 * начале работы приложение не знает ничего. Обрезать период по такой дате
 * значило бы выбросить из расчёта весь год до неё — то есть по ответу
 * «завтра я на смене» показать пустой график.
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

/**
 * Границы, обрезанные началом отсчёта: раньше него человек здесь не работал.
 *
 * --- Зачем ----------------------------------------------------------------
 *
 * Учётный период установлен работодателем и начинается с января независимо
 * от того, когда человека приняли. Тому, кто устроился в августе, экран
 * показывал годовую норму — полторы тысячи часов, из которых его только
 * четыреста, — и «недоработку» на всю разницу. Число, заведомо неверное,
 * стояло первым и крупнее всех.
 *
 * Обрезается ИМЕННО НАЧАЛО, и обрезается сам отрезок, а не итог: норма
 * считается по рабочим дням внутри отрезка (ст. 104 ТК РФ), и «посчитать
 * год и вычесть лишнее» дало бы другое число — не то, которое стоит в
 * приказе.
 *
 * --- Почему конец не трогается --------------------------------------------
 *
 * Приложение не знает об увольнении и знать не должно: спор идёт о том,
 * что уже отработано, и человек, ушедший в сентябре, смотрит на свой год
 * ровно так же, как работающий. Ограничить «по сегодня» — отдельный
 * вопрос, и на него отвечает «Онлайн».
 *
 * --- Что бывает, если отрезок весь раньше начала --------------------------
 *
 * Пустой отрезок, а не отрицательный: январь у того, кто устроился в
 * августе, — это ноль суток, и так он и показывается. Врать про него нечем,
 * а сетка и полоса итога умеют быть пустыми.
 */
export function countedBounds(
  bounds: { periodStart: IsoDate; periodEnd: IsoDate },
  countFrom: IsoDate | null,
): { periodStart: IsoDate; periodEnd: IsoDate } {
  if (countFrom === null || countFrom <= bounds.periodStart) return bounds;
  return {
    periodStart: countFrom < bounds.periodEnd ? countFrom : bounds.periodEnd,
    periodEnd: bounds.periodEnd,
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


/**
 * График профиля, собранный целиком.
 *
 * Одно место, где опознание из профиля превращается в график: у своего
 * цикла числа лежат отдельными полями, и собрать его из одной строки
 * нельзя. Всё остальное приложение зовёт эту функцию, а не разбирает
 * профиль само.
 */
export function patternOfProfile(profile: StoredProfile): SchedulePattern {
  return resolveSchedulePattern(
    profile.schedulePattern,
    profile.customWorkDays,
    profile.customRestDays,
  );
}

/**
 * Приходится ли на эти сутки смена ПО ГРАФИКУ, без правок человека.
 *
 * Один ответ на два разных вопроса, и в этом весь смысл: у цикличных
 * графиков смену задаёт цикл вокруг названной даты, у пятидневки —
 * производственный календарь вместе с правками человека. Спрашивать об
 * этом в двух местах по-разному значило бы однажды получить два разных
 * ответа: в окне дня одно, в расчёте другое.
 *
 * Календарь берётся ПО ГОДУ САМИХ СУТОК, а не по учётному году профиля:
 * период может пересечь границу года, и декабрьский день соседнего года
 * иначе достался бы чужому календарю.
 */
export function scheduledByPattern(profile: StoredProfile, day: IsoDate): boolean {
  const pattern = patternOfProfile(profile);
  if (pattern.source !== "calendar") {
    return onShiftCycle(profile.firstShiftDate, day, pattern);
  }
  const dayType = dayTypeAt(profile, day);
  return dayType === "working" || dayType === "pre_holiday";
}

/**
 * Есть ли смена в этих сутках — по графику и с правками человека.
 *
 * Тот же вопрос, что задаёт себе расчёт, и ответ на него обязан быть один:
 * окно дня, сетка и расчёт спрашивают об одном и том же дне.
 */
export function shiftOn(profile: StoredProfile, day: IsoDate): boolean {
  const override = profile.shiftOverrides[day];
  if (override === "shift") return true;
  if (override === "off") return false;
  return scheduledByPattern(profile, day);
}

/**
 * Вид этих суток по производственному календарю, с поправками человека.
 *
 * Календарь берётся ПО ГОДУ САМИХ СУТОК: период может пересечь границу
 * года, и декабрьский день соседнего года иначе достался бы чужому
 * календарю.
 */
export function dayTypeAt(profile: StoredProfile, day: IsoDate): DayType {
  const lawful = statutoryCalendar(Number(day.slice(0, 4))).get(day) ?? "working";
  return profile.calendarOverrides[day] ?? lawful;
}

/**
 * Часы смены на этих сутках ПО ГРАФИКУ — то, от чего человек отсчитывает.
 *
 * Считается на конкретные сутки, а не на график вообще, из-за
 * предпраздничного часа: у графиков, которые строятся по
 * производственному календарю, смена накануне праздника короче на час
 * (ст. 95 ТК РФ), и расчёт это делает сам. Покажи окно дня в такие сутки
 * обычные восемь часов — и человек, ничего не трогая, увидел бы в поле
 * одно, а в клетке другое.
 */
export function scheduleSpanAt(profile: StoredProfile, day: IsoDate): ShiftSpan {
  const minutes = shiftMinutes(profile.shiftDurationHours);
  const shortened =
    patternOfProfile(profile).source === "calendar" && dayTypeAt(profile, day) === "pre_holiday";
  return spanFrom(
    profile.shiftStartTime,
    shortened ? Math.max(0, minutes - MINUTES_PER_HOUR) : minutes,
  );
}

/** Часы смены на этих сутках: названные человеком или, если он молчит, по графику. */
export function shiftSpanAt(profile: StoredProfile, day: IsoDate): ShiftSpan {
  return profile.shiftTimes[day] ?? scheduleSpanAt(profile, day);
}

/** Названы ли часы этой смены человеком, а не взяты из графика. */
export function hasOwnShiftTime(profile: StoredProfile, day: IsoDate): boolean {
  return profile.shiftTimes[day] !== undefined;
}

/**
 * Часы одной смены: со скольки и до скольки человек её отработал.
 *
 * --- Почему совпадение с графиком не хранится ------------------------------
 *
 * Тот же приём, что у правок календаря и переносов смен: в профиле лежит
 * только то, что человек утверждает ВОПРЕКИ расчёту. Запиши сюда часы,
 * совпавшие с графиком, — и они зажили бы своей жизнью: поправь потом
 * начало смены в настройках, и все прежние «подтверждения» остались бы
 * прежними, молча удерживая часть года на старом распорядке. Человек при
 * этом уверен, что поменял всё разом.
 *
 * `null` снимает названные часы: смена возвращается к графику.
 */
export function withShiftTimeAt(
  profile: StoredProfile,
  day: IsoDate,
  span: ShiftSpan | null,
): StoredProfile {
  const shiftTimes = { ...profile.shiftTimes };
  const schedule = scheduleSpanAt(profile, day);
  if (
    span === null ||
    spanMinutes(span) === null ||
    (span.startsAt === schedule.startsAt && span.endsAt === schedule.endsAt)
  ) {
    delete shiftTimes[day];
  } else {
    shiftTimes[day] = { startsAt: span.startsAt, endsAt: span.endsAt };
  }
  return { ...profile, shiftTimes };
}

/**
 * Правка графика на одни сутки: смена или выходной.
 *
 * --- Почему совпадение с циклом не хранится ------------------------------
 *
 * Правка называет ИСКЛЮЧЕНИЕ. Сказать «здесь смена» там, где смена и так
 * по циклу, значит не сказать ничего — а запись осталась бы и однажды
 * зажила своей жизнью: сдвинь человек известную смену на день, и старые
 * «подтверждения» цикла превратятся в чужие смены посреди года.
 *
 * Поэтому выбор, совпавший с циклом, СНИМАЕТ правку. Тот же приём, что у
 * производственного календаря: в профиле лежит только то, что человек
 * утверждает вопреки расчёту.
 */
export function withShiftAt(
  profile: StoredProfile,
  day: IsoDate,
  shift: boolean,
): StoredProfile {
  const shiftOverrides = { ...profile.shiftOverrides };
  if (scheduledByPattern(profile, day) === shift) {
    delete shiftOverrides[day];
  } else {
    shiftOverrides[day] = shift ? "shift" : "off";
  }
  // Снятая смена уносит с собой и свои часы. Часы описывают смену, а не
  // сутки: оставь их здесь — и они пролежат до тех пор, пока смена в эти
  // сутки не вернётся, чтобы тогда молча приписать ей чужой распорядок.
  const shiftTimes = { ...profile.shiftTimes };
  if (!shift) delete shiftTimes[day];
  return { ...profile, shiftOverrides, shiftTimes };
}

/**
 * Перенос смены: снять с одних суток и поставить на другие.
 *
 * Одним действием, а не двумя правками подряд: перенос — это одно
 * событие («смену отдали на седьмое»), и в профиле он обязан оказаться
 * целиком или никак. Двумя вызовами промежуточное состояние — график без
 * смены — попадало бы в хранилище и в расчёт.
 */
export function withShiftMoved(
  profile: StoredProfile,
  from: IsoDate,
  to: IsoDate,
): StoredProfile {
  if (from === to) return profile;
  // Часы переезжают вместе со сменой. «Смену отдали на седьмое» — это та же
  // смена, и если человек уже сказал, что отработал её с восьми до
  // одиннадцати вечера, переносом это знание не отменяется.
  const carried = profile.shiftTimes[from] ?? null;
  const moved = withShiftAt(withShiftAt(profile, from, false), to, true);
  return carried === null ? moved : withShiftTimeAt(moved, to, carried);
}

/**
 * Отметить или снять вид суток одним нажатием.
 *
 * --- Зачем отдельно от срока -----------------------------------------------
 *
 * Кольцо вокруг клетки (`day-ring.tsx`) отвечает на «что было в этот день»
 * одним движением, и день у него ровно один. Срок — отдельный разговор, и
 * заходит он следом, своим окном: до какого числа отпуск, сколько часов
 * вызов. Но то, что длится, ставится только по «Готово» в этом окне
 * (`withAbsenceSpan`, `withCalloutSpan`); нажатием по дню отмечается лишь то,
 * что не длится, и снимается всё.
 *
 * Поэтому здесь самый простой случай: включить на эти сутки и выключить.
 * Снятие уносит запись, накрывающую эти сутки, целиком. Отпуск с первого по
 * четырнадцатое, снятый шестого, исчезает весь: человек сказал, что отпуска
 * в этот день не было, а резать чужой период надвое за него приложение не
 * вправе — для этого есть окно с датой окончания.
 */
export function withAbsenceToggled(
  profile: StoredProfile,
  day: IsoDate,
  kind: AbsenceKind,
): StoredProfile {
  const covering = profile.absences.find(
    (item) => item.kind === kind && item.startsOn <= day && day <= item.endsOn,
  );
  if (covering !== undefined) {
    return {
      ...profile,
      absences: profile.absences.filter((item) => item.id !== covering.id),
    };
  }
  return {
    ...profile,
    absences: [
      ...profile.absences,
      { id: crypto.randomUUID(), kind, startsOn: day, endsOn: day },
    ],
  };
}

/** То же для работы помимо графика. Часы — обычная смена, правятся в окне. */
export function withCalloutToggled(
  profile: StoredProfile,
  day: IsoDate,
  kind: CalloutKind,
  hoursPerDay: string,
): StoredProfile {
  // Снимается ЛЮБОЙ выход сверх графика в этих сутках, а не только того же
  // вида.
  // ---------------------------------------------------------------------
  // Видов вызова в данных шесть, но отмечают теперь один: остальные пять
  // остались от прежней разметки и встречаются только в старых профилях.
  // Ищи мы по виду — человек, нажав «Вызов» на дне со старыми
  // «Соревнованиями», не снял бы их, а поставил бы рядом второй выход: в
  // сутках стало бы два вызова вместо одного, и часы сложились бы дважды.
  //
  // Поэтому нажатие снимает то, что в сутках есть, каким бы видом оно ни
  // было записано. Сам вид при этом не переписывается: пока запись стоит,
  // она остаётся собой — и в подписи клетки, и в перечне изменений.
  const covering = profile.callouts.find(
    (item) => item.startsOn <= day && day <= item.endsOn,
  );
  if (covering !== undefined) {
    return {
      ...profile,
      callouts: profile.callouts.filter((item) => item.id !== covering.id),
    };
  }
  return {
    ...profile,
    callouts: [
      ...profile.callouts,
      { id: crypto.randomUUID(), kind, startsOn: day, endsOn: day, hoursPerDay },
    ],
  };
}

/**
 * Заметка к суткам.
 *
 * Пустая не хранится: иначе профиль обрастал бы пустыми строками на каждом
 * дне, который человек когда-либо открывал.
 */
export function withNoteAt(
  profile: StoredProfile,
  day: IsoDate,
  text: string,
): StoredProfile {
  const dayNotes = { ...profile.dayNotes };
  if (text.trim() === "") delete dayNotes[day];
  else dayNotes[day] = text.trim();
  return { ...profile, dayNotes };
}

/**
 * Сколько всего человек внёс в график: отсутствия, вызовы, переносы и
 * отмены смен, свои часы, виды дней, начало отсчёта, заметки.
 *
 * Ровно столько строк в перечне «События» (`changes-list.tsx`) — это число
 * и сверяется тестом, чтобы счёт в окне сохранения и перечень не разошлись.
 * Пустое «начало отсчёта» не в счёт: это умолчание, а не правка.
 */
export function changeCountOf(profile: StoredProfile): number {
  return (
    profile.absences.length +
    profile.callouts.length +
    Object.keys(profile.shiftOverrides).length +
    Object.keys(profile.shiftTimes).length +
    Object.keys(profile.calendarOverrides).length +
    Object.keys(profile.dayNotes).length +
    (profile.countFrom === null ? 0 : 1)
  );
}

/**
 * Докуда длится отметка: срок у записи, накрывающей эти сутки.
 *
 * Срок у записи, которая в графике уже стоит, продлевается — той же
 * самой записью, а не второй рядом.
 * Открыв середину отпуска с первого по четырнадцатое и назвав двадцатое,
 * человек меняет ЭТОТ отпуск: у него остаются и опознаватель, и дата
 * начала, которая может быть раньше открытых суток. Вторая запись удвоила
 * бы отпуск.
 */
export function withAbsenceUntil(
  profile: StoredProfile,
  day: IsoDate,
  kind: AbsenceKind,
  endsOn: IsoDate,
): StoredProfile {
  return {
    ...profile,
    absences: profile.absences.map((item) =>
      item.kind === kind && item.startsOn <= day && day <= item.endsOn
        ? { ...item, endsOn }
        : item,
    ),
  };
}

/** То же для работы помимо графика — вместе с часами в сутки. */
export function withCalloutUntil(
  profile: StoredProfile,
  day: IsoDate,
  kind: CalloutKind,
  endsOn: IsoDate,
  hoursPerDay: string,
): StoredProfile {
  return {
    ...profile,
    callouts: profile.callouts.map((item) =>
      item.kind === kind && item.startsOn <= day && day <= item.endsOn
        ? { ...item, endsOn, hoursPerDay }
        : item,
    ),
  };
}

/**
 * Поставить отсутствие сразу со сроком — одним действием, когда срок назван.
 *
 * --- Зачем, если есть `withAbsenceToggled` + `withAbsenceUntil` -------------
 *
 * Отметка длящегося события не ложится в график, пока человек не нажал
 * «Готово» в окне срока (`day-ring.tsx`): до этого расчёт не меняется, а
 * крестик окна отменяет выбор, не оставляя следа. Значит, запись рождается
 * уже со своим концом — не «на сутки, а потом продлить».
 *
 * Действие НЕ переключатель, в отличие от `withAbsenceToggled`: если на эти
 * сутки запись того же вида уже стоит (профиль успел измениться, пока окно
 * было открыто), она продлевается, а не снимается. Окно «Готово» не должно
 * стирать то, что есть.
 *
 * Конец раньше начала — опечатка, а не срок: остаются одни сутки, как в
 * `withAbsenceEnd`.
 */
export function withAbsenceSpan(
  profile: StoredProfile,
  day: IsoDate,
  kind: AbsenceKind,
  endsOn: IsoDate,
): StoredProfile {
  const end = endsOn < day ? day : endsOn;
  const covers = (item: { kind: AbsenceKind; startsOn: IsoDate; endsOn: IsoDate }) =>
    item.kind === kind && item.startsOn <= day && day <= item.endsOn;
  if (profile.absences.some(covers)) {
    return withAbsenceUntil(profile, day, kind, end);
  }
  return {
    ...profile,
    absences: [
      ...profile.absences,
      { id: crypto.randomUUID(), kind, startsOn: day, endsOn: end },
    ],
  };
}

/** То же для работы сверх графика — со своими часами в сутки. */
export function withCalloutSpan(
  profile: StoredProfile,
  day: IsoDate,
  kind: CalloutKind,
  endsOn: IsoDate,
  hoursPerDay: string,
): StoredProfile {
  const end = endsOn < day ? day : endsOn;
  // Как и в `withCalloutToggled`, «уже стоит» — любой выход сверх графика в
  // этих сутках, каким бы видом он ни был записан: второй рядом удвоил бы
  // часы. Продлевается он под своим видом.
  const existing = profile.callouts.find(
    (item) => item.startsOn <= day && day <= item.endsOn,
  );
  if (existing !== undefined) {
    return withCalloutUntil(profile, day, existing.kind, end, hoursPerDay);
  }
  return {
    ...profile,
    callouts: [
      ...profile.callouts,
      { id: crypto.randomUUID(), kind, startsOn: day, endsOn: end, hoursPerDay },
    ],
  };
}

/**
 * Подвинуть границу уже записанного события — по его номеру.
 *
 * --- Зачем номер, если есть день -------------------------------------------
 *
 * `withAbsenceUntil` ищет запись по суткам и виду: так её находит перечень
 * видов у дня, которому известен день под курсором и больше ничего. Перечень внесённых
 * изменений (`changes-list.tsx`) знает другое — саму запись, — и искать её
 * заново по дню было бы не просто лишним, а неверным: двух отпусков подряд
 * с одной датой начала приложение не запрещает, и поиск по дню поправил бы
 * не тот.
 *
 * Дата раньше начала не принимается: событие, кончающееся прежде, чем
 * началось, — это не срок, а опечатка. Вместо неё остаётся начало, то есть
 * «одни сутки»; так же поступает и поле даты, которому назначен `min`.
 */
export function withAbsenceEnd(
  profile: StoredProfile,
  id: string,
  endsOn: IsoDate,
): StoredProfile {
  return {
    ...profile,
    absences: profile.absences.map((item) =>
      item.id === id
        ? { ...item, endsOn: endsOn < item.startsOn ? item.startsOn : endsOn }
        : item,
    ),
  };
}

/** То же для работы сверх графика — со своими часами в сутки. */
export function withCalloutEnd(
  profile: StoredProfile,
  id: string,
  endsOn: IsoDate,
  hoursPerDay: string,
): StoredProfile {
  return {
    ...profile,
    callouts: profile.callouts.map((item) =>
      item.id === id
        ? {
            ...item,
            endsOn: endsOn < item.startsOn ? item.startsOn : endsOn,
            hoursPerDay,
          }
        : item,
    ),
  };
}

/**
 * Вид дня в производственном календаре — одним нажатием.
 *
 * Совпал с законом — правка снимается: в профиле лежит только то, что
 * человек утверждает ВОПРЕКИ ст. 112 и 95 ТК РФ, и «ваших правок» должно
 * быть ровно столько, сколько он готов отстаивать. Тот же довод, что у
 * правок графика (`withShiftAt`) и у окна дня.
 */
export function withDayTypeAt(
  profile: StoredProfile,
  day: IsoDate,
  type: DayType,
): StoredProfile {
  const lawful = statutoryCalendar(profile.accountingYear).get(day) ?? "working";
  const calendarOverrides = { ...profile.calendarOverrides };
  if (type === lawful) delete calendarOverrides[day];
  else calendarOverrides[day] = type;
  return { ...profile, calendarOverrides };
}
