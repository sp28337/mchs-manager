/**
 * Производственный календарь: какие дни года рабочие.
 *
 * --- Почему он считается, а не хранится ---------------------------------
 *
 * Раньше календарь лежал в базе на сервере, куда его клал сид-скрипт. Но
 * почти весь он ВЫВОДИМ ИЗ ЗАКОНА: праздники ст. 112 ТК РФ — фиксированные
 * даты, выходные — суббота и воскресенье, предпраздничные — ст. 95, а
 * перенос выходного, совпавшего с праздником, задан ст. 112 ч. 2. Всё это
 * одинаково считается в любом браузере, и держать ради него сервер незачем.
 *
 * Побочное следствие важнее удобства: раз календарь считается на месте,
 * приложению больше не нужно ничего спрашивать у сервера, и персональные
 * данные никуда не уходят.
 *
 * Вручную набранная таблица на 365 строк — это, кроме прочего, ровно та
 * вещь, которая приобретает опечатку, замеченную только когда норма выйдет
 * неверной.
 *
 * --- Чего здесь принципиально нет ---------------------------------------
 *
 * Ежегодного постановления Правительства «О переносе выходных дней». Оно
 * из закона не выводится и меняется каждый год: именно оно переносит
 * новогодние выходные, попавшие внутрь каникул 1-8 января, на другие даты.
 * Приложение его не знает и не угадывает — вместо этого человек правит
 * календарь сам, глядя на выданный ему производственный календарь.
 *
 * Цена непроставленного переноса названа честно: `pendingTransfers` даёт
 * список новогодних дней, оставшихся без компенсирующего выходного, и
 * экран обязан это показать. Для 2026 года таких дней два, то есть годовая
 * норма без правки завышена на 16 часов.
 */

import {
  addDays,
  datesOfYear,
  isWeekend,
  makeDate,
  type IsoDate,
} from "./plain-date";

export type DayType = "working" | "weekend" | "holiday" | "pre_holiday";

/** ТК РФ ст. 112 ч. 1 — фиксированные даты, одинаковые каждый год. */
const STATUTORY_HOLIDAYS: readonly (readonly [number, number])[] = [
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], // новогодние + Рождество
  [2, 23], // День защитника Отечества
  [3, 8],  // Международный женский день
  [5, 1],  // Праздник Весны и Труда
  [5, 9],  // День Победы
  [6, 12], // День России
  [11, 4], // День народного единства
];

const NEW_YEAR_BLOCK_DAYS = 8;

/**
 * Постановление Правительства о переносе выходных дней — по годам.
 *
 * Перечислены ДНИ, СТАВШИЕ НЕРАБОЧИМИ: выходные, попавшие внутрь
 * новогодних каникул, переносятся на них. Из закона это не выводится и
 * меняется каждый год, поэтому таблица, а не правило.
 *
 * 2026 год: субботу 3 и воскресенье 4 января переносят на пятницу
 * 9 января и четверг 31 декабря. Оба дня размечаются как нерабочие
 * праздничные, и 31 декабря перестаёт быть предпраздничным — сокращать на
 * час нерабочий день незачем.
 *
 * На норму тип не влияет: и выходной, и праздничный одинаково не входят в
 * число рабочих дней. Различие видно в двух местах — в подписи клетки
 * календаря и в счётчике «праздничные часы», куда попадут часы смены,
 * пришедшейся на такой день.
 *
 * Год, которого здесь нет, честно считается неполным: `pendingTransfers`
 * назовёт непокрытые дни, а экран — цену молчания в часах.
 */
const DECREE_TRANSFERS: Record<number, readonly IsoDate[]> = {
  2026: ["2026-01-09", "2026-12-31"],
};

export function statutoryHolidays(year: number): Set<IsoDate> {
  return new Set(STATUTORY_HOLIDAYS.map(([month, day]) => makeDate(year, month, day)));
}

function newYearBlock(year: number): Set<IsoDate> {
  return new Set(
    Array.from({ length: NEW_YEAR_BLOCK_DAYS }, (_, index) => makeDate(year, 1, index + 1)),
  );
}

/**
 * Базовый календарь года по одному только закону.
 *
 * Порядок шагов существенен и повторяет порядок норм: сначала выходные по
 * дням недели, затем праздники поверх них, затем перенос по ст. 112 ч. 2,
 * и только в самом конце предпраздничные — иначе день, ставший выходным
 * при переносе, мог бы получить признак предпраздничного, которым он не
 * является.
 */
export function statutoryCalendar(year: number): Map<IsoDate, DayType> {
  const holidays = statutoryHolidays(year);
  const newYear = newYearBlock(year);

  // 1. Основа: выходные по дням недели, остальное рабочее.
  const types = new Map<IsoDate, DayType>(
    datesOfYear(year).map((day) => [day, isWeekend(day) ? "weekend" : "working"] as const),
  );

  // 2. Праздники перекрывают основу.
  for (const holiday of holidays) types.set(holiday, "holiday");

  // 3. Ст. 112 ч. 2 — выходной, совпавший с нерабочим праздничным днём,
  //    переносится на следующий рабочий день. Для новогодних каникул это
  //    правило НЕ применяется: перенос оттуда задаёт постановление.
  for (const holiday of [...holidays].sort()) {
    if (newYear.has(holiday) || !isWeekend(holiday)) continue;
    let cursor = addDays(holiday, 1);
    while (types.get(cursor) !== "working") {
      cursor = addDays(cursor, 1);
      if (cursor.slice(0, 4) !== String(year)) break;
    }
    if (types.get(cursor) === "working") types.set(cursor, "weekend");
  }

  // 4. Постановление о переносе выходных, если год в таблице. Ставится ДО
  //    предпраздничных: перенесённый выходной не может быть заодно
  //    предпраздничным рабочим днём.
  for (const day of DECREE_TRANSFERS[year] ?? []) {
    if (types.has(day)) types.set(day, "holiday");
  }

  // 5. Ст. 95 — РАБОЧИЙ день непосредственно перед нерабочим праздничным
  //    короче на час. Считается только от праздников, никогда от
  //    перенесённых выходных; 31 декабря смотрит через границу года.
  const nextNewYear = makeDate(year + 1, 1, 1);
  for (const [day, type] of [...types]) {
    if (type !== "working") continue;
    const following = addDays(day, 1);
    if (holidays.has(following) || following === nextNewYear) {
      types.set(day, "pre_holiday");
    }
  }

  return types;
}

/**
 * Новогодние выходные, оставшиеся без компенсирующего выходного дня.
 *
 * Столько дней в году приложение считает рабочими сверх официального
 * календаря, пока человек не внесёт перенос. Каждый такой день — 8 часов
 * лишней нормы.
 */
export function pendingTransfers(year: number): IsoDate[] {
  // Перенос известен — недостачи нет. Сравнивается количество, а не сами
  // даты: постановление вправе перенести выходной куда угодно, но число
  // нерабочих дней в году оно сохраняет.
  const decreed = DECREE_TRANSFERS[year] ?? [];
  const inside = [...newYearBlock(year)].filter(isWeekend).sort();
  return decreed.length >= inside.length ? [] : inside.slice(decreed.length);
}

/** Откуда взят тип дня. Человек должен различать закон и свою правку. */
export type DaySource = "statutory" | "override";

export interface CalendarDay {
  readonly day: IsoDate;
  readonly dayType: DayType;
  readonly source: DaySource;
}

/**
 * Календарь года с наложенными правками человека.
 *
 * Правка выигрывает всегда: базовый календарь — это закон без
 * постановления о переносах, а человек держит перед глазами настоящий
 * производственный календарь и знает точнее.
 */
export function calendarWithOverrides(
  year: number,
  overrides: ReadonlyMap<IsoDate, DayType>,
): CalendarDay[] {
  return [...statutoryCalendar(year)].map(([day, dayType]) => {
    const override = overrides.get(day);
    return override === undefined
      ? { day, dayType, source: "statutory" as const }
      : { day, dayType: override, source: "override" as const };
  });
}

export interface CalendarFactsForPeriod {
  readonly workingDays: number;
  readonly preHolidayDays: number;
  readonly holidays: Set<IsoDate>;
  /** Сами рабочие дни, а не только их число: по ним считается, сколько
   *  нормы приходится на отпуск. */
  readonly workingDaySet: Set<IsoDate>;
  readonly preHolidayDaySet: Set<IsoDate>;
}

/**
 * Что даёт календарь за полуинтервал `[periodStart, periodEnd)`.
 *
 * Предпраздничный день попадает И в рабочие, И в предпраздничные:
 * производственный календарь считает его рабочим, просто сокращённым на
 * час (ст. 95 ТК РФ). Исключить его из рабочих значило бы вычесть за него
 * девять часов вместо одного.
 *
 * Период может пересекать границу года — полугодие и год у людей с первой
 * сменой в начале января не пересекают, но месяц декабрь-январь при ручном
 * выборе пересечь может, — поэтому календарь берётся по всем затронутым
 * годам, а не по одному.
 */
export function calendarFactsFor(
  periodStart: IsoDate,
  periodEnd: IsoDate,
  overridesByYear: ReadonlyMap<number, ReadonlyMap<IsoDate, DayType>>,
): CalendarFactsForPeriod {
  let workingDays = 0;
  let preHolidayDays = 0;
  const holidays = new Set<IsoDate>();
  const workingDaySet = new Set<IsoDate>();
  const preHolidayDaySet = new Set<IsoDate>();

  const firstYear = Number(periodStart.slice(0, 4));
  // `periodEnd` исключающая: период, кончающийся 1 января, последнего года
  // не захватывает, и строить для него календарь незачем.
  const lastYear = Number(addDays(periodEnd, -1).slice(0, 4));

  for (let year = firstYear; year <= lastYear; year += 1) {
    const overrides = overridesByYear.get(year) ?? new Map<IsoDate, DayType>();
    for (const { day, dayType } of calendarWithOverrides(year, overrides)) {
      if (day < periodStart || day >= periodEnd) continue;
      if (dayType === "working" || dayType === "pre_holiday") {
        workingDays += 1;
        workingDaySet.add(day);
      }
      if (dayType === "pre_holiday") {
        preHolidayDays += 1;
        preHolidayDaySet.add(day);
      }
      if (dayType === "holiday") holidays.add(day);
    }
  }

  return { workingDays, preHolidayDays, holidays, workingDaySet, preHolidayDaySet };
}
