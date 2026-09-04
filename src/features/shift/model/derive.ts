/**
 * Связка «сохранённый профиль → расчёт периода».
 *
 * Тонкий слой между тем, что человек ввёл, и доменом, который считает.
 * Отдельно от домена, потому что домен ничего не знает про хранилище, и
 * отдельно от экранов, потому что экраны ничего не должны знать про
 * порядок вывода нормы.
 */

import { Dec, parseHours } from "../domain/decimal";
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
  type AccountingPeriodKind,
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
   * Чем заполнить своё поле, когда выбрана «Своя».
   *
   * Пустым его оставлять нельзя: пустое значит «своей нормы нет», и выбор
   * тут же откатился бы к сорока часам — человек нажал бы «Своя» и увидел
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
