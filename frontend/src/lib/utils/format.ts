/**
 * Форматирование дат, часов и периодов.
 *
 * Один модуль на всё приложение по той же причине, по которой один
 * словарь статусов: разошедшиеся форматы дают экраны, где один и тот же
 * период выглядит по-разному, и человек тратит внимание на сверку вместо
 * работы.
 *
 * --- Верхняя граница периода исключающая -------------------------------
 *
 * Во всём API `[start, end)`: март — это `2026-03-01`…`2026-04-01`.
 * Человеку показывается «март 2026 г.» или «по 31.03.2026». Показать
 * «по 1 апреля» значило бы заставить каждого пользователя держать в
 * голове соглашение о полуинтервалах.
 */

const MONTH_YEAR = new Intl.DateTimeFormat("ru-RU", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const SHORT_DATE = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC" });

/** ISO-дата (`2026-03-01`) как UTC-полночь — без сдвига часовым поясом. */
function atUtcMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

/** Последний ВКЛЮЧЁННЫЙ день периода. */
export function inclusiveEnd(exclusiveEnd: string): Date {
  const date = atUtcMidnight(exclusiveEnd);
  date.setUTCDate(date.getUTCDate() - 1);
  return date;
}

export function formatDate(isoDate: string): string {
  return SHORT_DATE.format(atUtcMidnight(isoDate));
}

/**
 * Период человеческим языком. Ровный месяц называется месяцем — так его
 * называют и в приказе.
 */
export function formatPeriod(periodStart: string, periodEnd: string): string {
  const start = atUtcMidnight(periodStart);
  const last = inclusiveEnd(periodEnd);

  const wholeMonth =
    start.getUTCDate() === 1 &&
    start.getUTCMonth() === last.getUTCMonth() &&
    start.getUTCFullYear() === last.getUTCFullYear() &&
    last.getUTCDate() ===
      new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0)).getUTCDate();

  if (wholeMonth) return MONTH_YEAR.format(start);
  return `${SHORT_DATE.format(start)} — ${SHORT_DATE.format(last)}`;
}

/**
 * Момент времени в НАЗВАННОМ часовом поясе.
 *
 * Пояс — обязательный параметр, и это осознанно. Суточное дежурство,
 * показанное в поясе смотрящего, противоречит расчёту: ночные часы
 * считаются в поясе ПОДРАЗДЕЛЕНИЯ (ТК РФ ст. 96), и табельщик в Москве,
 * открывший табель владивостокской части, увидел бы смену, начавшуюся
 * «в час ночи», и 8 ночных часов рядом — числа, которые не сходятся.
 *
 * Пока `Timesheet` не несёт пояса подразделения (несёт только
 * `HoursBreakdown`, полем `computedInTimeZone`), вызывающий передаёт то,
 * что знает, и пояс печатается рядом со временем. Названный пояс не
 * делает число верным, но делает его проверяемым.
 */
export function formatMoment(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/** Часы с двумя знаками — как в табеле. */
export function formatHours(value: number | undefined): string {
  return (value ?? 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Пояс браузера — честное умолчание там, где пояс подразделения неизвестен. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
