import { daysBetween, type IsoDate } from "../domain/plain-date";
import { monthBounds } from "./derive";

/**
 * Лента периода: где в году стоят события.
 *
 * Статистика отвечает на вопрос «из чего вышло» перечнями, и перечень не
 * показывает главного для года: КАК события лежат относительно друг друга. Два
 * отпуска и больничный между ними — три строки, а на ленте видно, что с мая по
 * август человека почти не было на работе, а осень отработана без перерыва.
 *
 * Здесь только арифметика ленты — какую долю ширины занимает отрезок, — и она
 * отдельно от рисунка затем, что ошибиться в ней тихо: сдвиг на сутки не виден
 * глазом, а событие в июне оказывается в июле.
 *
 * --- Ось -------------------------------------------------------------------
 *
 * Сутки, а не месяцы: у февраля двадцать восемь суток, у июля тридцать одна, и
 * ровные двенадцать долей по ширине растянули бы короткие месяцы и сжали
 * длинные. Событие на пятнадцатое число должно стоять посередине месяца, а не
 * там, где оно окажется после выравнивания.
 */

export interface Timeline {
  /** Первые сутки ленты. */
  readonly start: IsoDate;
  /** Сутки после последних: так же, как у `monthBounds`, конец не включается. */
  readonly end: IsoDate;
  readonly days: number;
  /** Начало каждого месяца ленты: подпись и тонкая черта. Доля ширины, 0–100. */
  readonly months: readonly { readonly month: number; readonly left: number }[];
  /** Где сегодня, если оно внутри ленты. */
  readonly today: number | null;
}

/** Отрезок на ленте: левый край и ширина, в долях ширины от 0 до 100. */
export interface Span {
  readonly left: number;
  readonly width: number;
}

/**
 * Лента на месяцы одного года — те, что входят в выбранную долю периода
 * (квартал, полугодие, год). Месяцы идут подряд: доля года другой не бывает.
 */
export function timelineOf(
  year: number,
  months: readonly number[],
  today: IsoDate,
): Timeline {
  const first = months[0] ?? 0;
  const last = months.at(-1) ?? first;
  const start = monthBounds(year, first).periodStart;
  const end = monthBounds(year, last).periodEnd;
  const days = Math.max(1, daysBetween(start, end));

  const at = (day: IsoDate) => (daysBetween(start, day) / days) * 100;
  const inside = daysBetween(start, today) >= 0 && daysBetween(today, end) > 0;

  return {
    start,
    end,
    days,
    months: months.map((month) => ({
      month,
      left: at(monthBounds(year, month).periodStart),
    })),
    // Сегодняшние сутки — середина их доли: черта стоит посреди суток, а не
    // на границе с вчерашними.
    today: inside ? ((daysBetween(start, today) + 0.5) / days) * 100 : null,
  };
}

/**
 * Где на ленте стоит отрезок `from`—`to` (оба включительно).
 *
 * Запись вправе выходить за ленту — отпуск, начатый в конце июня, на ленте
 * квартала с июля, — и тогда она обрезается по краю, а не пропадает. Лежащая
 * целиком вне ленты — `null`: рисовать нечего.
 */
export function spanOn(timeline: Timeline, from: IsoDate, to: IsoDate): Span | null {
  const lastDay = daysBetween(timeline.start, to);
  const firstDay = daysBetween(timeline.start, from);
  // `lastDay` — номер последних суток, а не их число: от него до начала
  // ленты на сутки меньше, чем суток в отрезке.
  if (lastDay < 0 || firstDay >= timeline.days) return null;

  const left = Math.max(0, firstDay);
  const right = Math.min(timeline.days, lastDay + 1);
  if (right <= left) return null;

  return {
    left: (left / timeline.days) * 100,
    width: ((right - left) / timeline.days) * 100,
  };
}
