/**
 * Даты по-русски: ДД.ММ.ГГГГ.
 *
 * --- Почему свой разбор, а не `Intl` и `Date` ---------------------------
 *
 * Показывать через `Intl` можно, а вот ВВОДИТЬ — нет, и именно ввод здесь
 * главный: человек вносит отпуска и больничные, глядя в приказ, где дата
 * написана как «01.03.2026». Нативный `<input type="date">` показывает
 * формат по настройкам браузера, а не по языку страницы, поэтому у многих
 * он выглядит как `mm/dd/yyyy` — американский порядок в русском
 * интерфейсе. Перепутать в нём 03.01 и 01.03 не просто легко, а
 * естественно, и цена ошибки — две недели чужого отпуска в расчёте.
 *
 * Разбор идёт по строке, без `Date`: `new Date("01.03.2026")` в разных
 * браузерах даёт разное, а иногда и `Invalid Date` — на такой основе
 * ввод дат строить нельзя.
 */

import { daysInYear, makeDate, type IsoDate } from "./plain-date";

const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const MONTHS_NOMINATIVE = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

/** `2026-03-01` → `01.03.2026`. */
export function formatDateRu(iso: IsoDate): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** `2026-03-02` → `2 марта` — когда год ясен из окружения. */
export function formatDayMonthRu(iso: IsoDate): string {
  const month = MONTHS_GENITIVE[Number(iso.slice(5, 7)) - 1] ?? "";
  return `${Number(iso.slice(8, 10))} ${month}`;
}

/** `2026-03-01` → `1 марта 2026 г.` — для связного текста, а не таблиц. */
export function formatDateLongRu(iso: IsoDate): string {
  const month = MONTHS_GENITIVE[Number(iso.slice(5, 7)) - 1] ?? "";
  return `${Number(iso.slice(8, 10))} ${month} ${iso.slice(0, 4)} г.`;
}

/**
 * Период человеческим языком. Верхняя граница у нас исключающая, а
 * человеку показывается последний ВКЛЮЧЁННЫЙ день: «по 1 апреля» заставило
 * бы каждого держать в голове соглашение о полуинтервалах.
 *
 * Ровный месяц называется месяцем — так его называют и в приказе.
 */
export function formatPeriodRu(periodStart: IsoDate, periodEnd: IsoDate): string {
  const lastIncluded = shiftBack(periodEnd);

  const startsMonth = periodStart.slice(8, 10) === "01";
  const sameMonth = periodStart.slice(0, 7) === lastIncluded.slice(0, 7);
  if (startsMonth && sameMonth && isLastDayOfMonth(lastIncluded)) {
    const month = MONTHS_NOMINATIVE[Number(periodStart.slice(5, 7)) - 1] ?? "";
    return `${month} ${periodStart.slice(0, 4)}`;
  }
  return `${formatDateRu(periodStart)} — ${formatDateRu(lastIncluded)}`;
}

function shiftBack(iso: IsoDate): IsoDate {
  const day = Number(iso.slice(8, 10));
  const month = Number(iso.slice(5, 7));
  const year = Number(iso.slice(0, 4));
  if (day > 1) return makeDate(year, month, day - 1);
  if (month > 1) return makeDate(year, month - 1, daysInMonth(year, month - 1));
  return makeDate(year - 1, 12, 31);
}

export function daysInMonth(year: number, month1: number): number {
  if (month1 === 2) return daysInYear(year) === 366 ? 29 : 28;
  return [4, 6, 9, 11].includes(month1) ? 30 : 31;
}

function isLastDayOfMonth(iso: IsoDate): boolean {
  return (
    Number(iso.slice(8, 10)) ===
    daysInMonth(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)))
  );
}

/**
 * Разбор того, что человек напечатал.
 *
 * Принимается и `01.03.2026`, и `1.3.2026`, и `01032026` — люди набирают
 * дату по-разному, и отвергать верно понятое из-за пропущенной точки
 * значит спорить с человеком о форме там, где смысл однозначен.
 *
 * Не принимается несуществующая дата: `31.02.2026` — это опечатка, и
 * молча превратить её в 3 марта (как сделал бы `Date`) значит подставить
 * в расчёт день, которого человек не вводил.
 */
export function parseDateRu(input: string): IsoDate | null {
  const text = input.trim();
  if (text === "") return null;

  // Два разных случая, и различает их наличие разделителей. Без них
  // позиции жёсткие («01032026»), с ними — нет: «1.3.2026» человек пишет
  // ровно так же охотно, как «01.03.2026».
  const parts = text.split(/\D+/).filter((part) => part !== "");
  let day: number;
  let month: number;
  let year: number;

  if (parts.length === 3) {
    const [d, m, y] = parts as [string, string, string];
    if (d.length > 2 || m.length > 2 || y.length !== 4) return null;
    [day, month, year] = [Number(d), Number(m), Number(y)];
  } else if (parts.length === 1 && parts[0]!.length === 8) {
    const digits = parts[0]!;
    day = Number(digits.slice(0, 2));
    month = Number(digits.slice(2, 4));
    year = Number(digits.slice(4, 8));
  } else {
    return null;
  }

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (year < 1900 || year > 2200) return null;

  return makeDate(year, month, day);
}

/**
 * Подстановка точек по ходу набора.
 *
 * Без неё человек либо печатает точки сам, либо получает `01032026` и не
 * видит, где ошибся. Маска ставится только вперёд и никогда не удаляет
 * введённое: иначе стирание символа боролось бы с подстановкой.
 */
export function maskDateRu(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)];
  return parts.filter((part) => part !== "").join(".");
}
