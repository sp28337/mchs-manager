/**
 * Календарная дата без времени и без часового пояса.
 *
 * --- Почему строка, а не `Date` -----------------------------------------
 *
 * `Date` — это момент времени, а не дата. `new Date("2026-03-01")` даёт
 * полночь UTC, и в часовом поясе восточнее Гринвича `getDate()` вернёт
 * второе марта. Расчёт нормы весь состоит из «в каких сутках лежит этот
 * час», и ошибка на сутки здесь — это 8 часов нормы или целая смена.
 *
 * Поэтому дата хранится как `YYYY-MM-DD`, а вся арифметика идёт через
 * номер дня от эпохи — целое число, с которым нельзя ошибиться на
 * часовой пояс, потому что часового пояса в нём нет.
 *
 * Строковое представление к тому же сравнивается лексикографически:
 * `"2026-03-01" < "2026-03-02"` верно всегда, и это свойство используется
 * в проверках попадания в период.
 */

/** Дата в формате `YYYY-MM-DD`. */
export type IsoDate = string;

const MS_PER_DAY = 86_400_000;

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Номер суток от 1970-01-01. Целое, поэтому арифметика точная. */
export function toEpochDay(iso: IsoDate): number {
  const match = ISO_PATTERN.exec(iso);
  if (!match) throw new RangeError(`Не дата в формате YYYY-MM-DD: ${iso}`);
  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day)) / MS_PER_DAY;
}

export function fromEpochDay(epochDay: number): IsoDate {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(iso) + days);
}

/** Сколько суток от `from` до `to`; отрицательно, если `to` раньше. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/**
 * День недели: 0 — понедельник, 6 — воскресенье.
 *
 * Нумерация как в Python (`date.weekday()`), а не как в JavaScript, где
 * неделя начинается с воскресенья. Перенос считался по первой, и менять
 * её здесь значило бы сдвинуть все выходные на день.
 */
export function weekday(iso: IsoDate): number {
  return (((toEpochDay(iso) + 3) % 7) + 7) % 7;
}

export function isWeekend(iso: IsoDate): boolean {
  return weekday(iso) >= 5;
}

export function year(iso: IsoDate): number {
  return Number(iso.slice(0, 4));
}

/** Месяц, 0-11 — как в `Date.getUTCMonth()`, чтобы индексировать названия. */
export function monthIndex(iso: IsoDate): number {
  return Number(iso.slice(5, 7)) - 1;
}

export function dayOfMonth(iso: IsoDate): number {
  return Number(iso.slice(8, 10));
}

export function makeDate(y: number, month1: number, day: number): IsoDate {
  return `${String(y).padStart(4, "0")}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInYear(y: number): number {
  return isLeapYear(y) ? 366 : 365;
}

/** Все даты года по порядку. */
export function datesOfYear(y: number): IsoDate[] {
  const start = toEpochDay(makeDate(y, 1, 1));
  return Array.from({ length: daysInYear(y) }, (_, index) => fromEpochDay(start + index));
}

/** Даты полуинтервала `[start, end)`. */
export function datesInRange(start: IsoDate, end: IsoDate): IsoDate[] {
  const first = toEpochDay(start);
  const count = toEpochDay(end) - first;
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => fromEpochDay(first + index));
}

export function todayIso(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}
