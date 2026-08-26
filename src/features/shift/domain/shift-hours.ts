/**
 * Как суточная смена ложится на календарные сутки.
 *
 * --- Зачем отдельный модуль ----------------------------------------------
 *
 * Смена длится сутки, но начинается не в полночь, поэтому она всегда лежит
 * в ДВУХ календарных днях. Разложить её по ним нужно трижды и каждый раз
 * по-своему:
 *
 * * часы — по длине куска;
 * * ночные — по пересечению с окном 22:00-06:00 (ст. 96 ТК РФ);
 * * праздничные — по тому, праздничны ли сами эти сутки (ст. 112 ТК РФ).
 *
 * --- Ошибка, из-за которой это переписано --------------------------------
 *
 * Раньше ночные делились ПРОПОРЦИОНАЛЬНО длине куска: смене, отдавшей
 * месяцу 16 из 24 часов, начислялось 8 × 16/24 = 5,33 ночных. Физически в
 * этих 16 часах (с 08:30 до полуночи) ночных ровно два — с 22:00 до 24:00,
 * а остальные шесть лежат в следующих сутках. Пропорция давала числа,
 * которых на часах не существует, и месячный итог ночных расходился с
 * табелем на ровном месте.
 *
 * --- Почему в минутах ----------------------------------------------------
 *
 * Смена может начинаться в 08:30, и половина часа в арифметике с целыми
 * часами не выражается. Минуты — целые, поэтому складываются точно; в часы результат
 * переводится один раз, в самом конце.
 */

import { Dec, type Decimal } from "./decimal";
import { addDays, type IsoDate } from "./plain-date";

export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_HOUR = 60;

/** Продолжительность смены «сутки через трое» — 24 часа. */
export const SHIFT_MINUTES = MINUTES_PER_DAY;

/**
 * Продолжительность смены в часах — строкой, как её вводит человек.
 *
 * Строкой, а не числом, по той же причине, что и часы вызова: 7,5 при
 * первом же круге записи и чтения в JSON превращается в 7.499999999999999.
 * В минуты — целые и потому точные — переводится один раз, здесь.
 *
 * Ноль и всё, что не число, дают суточную смену: смена нулевой длины
 * означала бы график, в котором человек не работает вовсе, — это не
 * настройка, а поломка, и молча показывать её расчётом нельзя.
 */
export function shiftMinutes(hours: string | undefined): number {
  const parsed = Number(String(hours ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return MINUTES_PER_DAY;
  // Смена длиннее суток разложилась бы на трое суток, а расчёт разбирает
  // двое: дальше суток не пускаем.
  return Math.min(Math.round(parsed * MINUTES_PER_HOUR), MINUTES_PER_DAY);
}

/**
 * Ночное время — с 22:00 до 06:00 (ч. 1 ст. 96 ТК РФ).
 *
 * Внутри суток это два отрезка, а не один: ночь пересекает полночь.
 */
const NIGHT_WINDOWS: readonly (readonly [number, number])[] = [
  [0, 6 * MINUTES_PER_HOUR],
  [22 * MINUTES_PER_HOUR, MINUTES_PER_DAY],
];

/**
 * Время начала смены как «ЧЧ:ММ».
 *
 * Не константа: время начала смены назначает работодатель, и у одних это
 * восемь утра, у других половина девятого. Зашить сюда одно значение
 * значило бы выдать чужой распорядок за всеобщий.
 */
export const DEFAULT_SHIFT_START = "08:00";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** «08:30» → 510 минут от полуночи. */
export function parseTimeOfDay(value: string): number | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
}

export function shiftStartMinute(value: string | undefined): number {
  return (
    parseTimeOfDay(value ?? DEFAULT_SHIFT_START) ??
    parseTimeOfDay(DEFAULT_SHIFT_START) ??
    0
  );
}

/**
 * Часы одной смены, названные человеком: со скольки и до скольки.
 *
 * --- Зачем это поверх графика ----------------------------------------------
 *
 * График задаёт смену одинаковой: начало из настроек, продолжительность
 * оттуда же. Так оно и есть — пока речь о графике. Но спор с
 * работодателем идёт не о графике, а об отработанном: заступил в восемь, а
 * сдал в одиннадцать, потому что смена не пришла; подменял полсмены;
 * отпустили в шесть. Приложение, которое такие сутки показывает
 * «по графику», в этом споре бесполезно — оно повторяет ту самую цифру,
 * которую человек и оспаривает.
 *
 * --- Почему промежутком, а не продолжительностью ---------------------------
 *
 * Продолжительность у смены уже есть — общая, в настройках. Спросить её же
 * ещё раз на конкретных сутках значило бы получить ответ «сколько-то
 * часов» и потерять то, из чего он взялся. А человек помнит именно
 * границы: «с восьми до двадцати трёх», — и из них же он читает свой
 * рапорт и табель.
 *
 * Границы важны и расчёту: от начала зависит, как смена ложится на двое
 * суток, а от того, куда попал каждый кусок, — ночные часы (ст. 96 ТК РФ) и
 * то, в каком месяце эти часы окажутся. Продолжительность одна на это не
 * отвечает.
 */
export interface ShiftSpan {
  /** «ЧЧ:ММ» — во сколько заступил. */
  readonly startsAt: string;
  /** «ЧЧ:ММ» — во сколько сдал. Раньше начала значит «следующим утром». */
  readonly endsAt: string;
}

/**
 * Сколько минут между этими часами.
 *
 * Конец раньше начала — обычное дело, а не ошибка: смена с двадцати ноль-ноль
 * до восьми утра переваливает за полночь. Поэтому счёт идёт по кругу
 * суток, и «раньше» значит «назавтра».
 *
 * Совпадение конца с началом — ровно сутки, а не ноль. «С восьми до
 * восьми» — то, как называют суточное дежурство; смены же нулевой длины не
 * бывает вовсе, и понять эти часы как ноль значило бы стереть человеку
 * сутки работы за то, что он назвал их привычным образом.
 *
 * `null` — если часы не разобрались: это ответ «времени здесь нет», и
 * подставлять вместо него какое-то своё нельзя.
 */
export function spanMinutes(span: ShiftSpan): number | null {
  const from = parseTimeOfDay(span.startsAt);
  const to = parseTimeOfDay(span.endsAt);
  if (from === null || to === null) return null;
  const length = (to - from + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return length === 0 ? MINUTES_PER_DAY : length;
}

/** Часы смены по графику — то, из чего собирается умолчание для суток. */
export function spanOfSchedule(startsAt: string, durationMinutes: number): ShiftSpan {
  const from = shiftStartMinute(startsAt);
  const to = (from + durationMinutes) % MINUTES_PER_DAY;
  const clock = (minute: number) =>
    `${String(Math.floor(minute / MINUTES_PER_HOUR)).padStart(2, "0")}:` +
    `${String(minute % MINUTES_PER_HOUR).padStart(2, "0")}`;
  return { startsAt: clock(from), endsAt: clock(to) };
}

/** Часть смены, пришедшаяся на одни календарные сутки. */
export interface DayPart {
  readonly day: IsoDate;
  /** Минуты смены в этих сутках. */
  readonly minutes: number;
  readonly nightMinutes: number;
  /** Начинается ли смена в этих сутках (а не продолжается с прошлых). */
  readonly isStart: boolean;
}

function overlap(from: number, to: number, windowFrom: number, windowTo: number): number {
  return Math.max(0, Math.min(to, windowTo) - Math.max(from, windowFrom));
}

function nightWithin(from: number, to: number): number {
  return NIGHT_WINDOWS.reduce(
    (sum, [windowFrom, windowTo]) => sum + overlap(from, to, windowFrom, windowTo),
    0,
  );
}

/**
 * Смена, разложенная по календарным суткам.
 *
 * Второй кусок появляется, только если смена ПЕРЕВАЛИВАЕТ за полночь, —
 * именно из него берутся часы, которые в табеле уходят на первое число
 * следующего месяца. Суточная смена переваливает всегда, кроме начала
 * ровно в полночь; двенадцатичасовая с восьми утра не переваливает вовсе,
 * а с восьми вечера — переваливает.
 *
 * Продолжительность приходит извне: она зависит от графика и от того, что
 * человек указал в настройках. Умолчание — сутки, тот график, с которого
 * приложение начиналось.
 */
export function splitShift(
  startedOn: IsoDate,
  startMinute: number,
  durationMinutes: number = SHIFT_MINUTES,
): DayPart[] {
  const firstDayMinutes = Math.min(durationMinutes, MINUTES_PER_DAY - startMinute);
  const parts: DayPart[] = [
    {
      day: startedOn,
      minutes: firstDayMinutes,
      nightMinutes: nightWithin(startMinute, startMinute + firstDayMinutes),
      isStart: true,
    },
  ];

  const tailMinutes = durationMinutes - firstDayMinutes;
  if (tailMinutes > 0) {
    parts.push({
      day: addDays(startedOn, 1),
      minutes: tailMinutes,
      nightMinutes: nightWithin(0, tailMinutes),
      isStart: false,
    });
  }
  return parts;
}

export function minutesToHours(minutes: number): Decimal {
  return new Dec(minutes).dividedBy(MINUTES_PER_HOUR);
}
