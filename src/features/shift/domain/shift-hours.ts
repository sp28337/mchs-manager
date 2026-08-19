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
 * Развод караула в 08:30, и половина часа в арифметике с целыми часами не
 * выражается. Минуты — целые, поэтому складываются точно; в часы результат
 * переводится один раз, в самом конце.
 */

import { Dec, type Decimal } from "./decimal";
import { addDays, type IsoDate } from "./plain-date";

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;

/** Продолжительность смены — 24 часа (Приказ № 308 п. 3, № 307 п. 8). */
export const SHIFT_MINUTES = MINUTES_PER_DAY;

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
 * Не константа: развод караула назначает подразделение, и приказы задают
 * только продолжительность — 24 часа, не включая время смены караулов
 * (№ 308 п. 3, № 307 п. 8). Зашить сюда одно значение значило бы выдать
 * чужой распорядок за всеобщий.
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
 * Возвращается один кусок, если смена начинается в полночь, и два во всех
 * остальных случаях. Второй кусок принадлежит СЛЕДУЮЩИМ суткам — именно из
 * него берутся часы, которые в табеле уходят на первое число следующего
 * месяца.
 */
export function splitShift(startedOn: IsoDate, startMinute: number): DayPart[] {
  const firstDayMinutes = MINUTES_PER_DAY - startMinute;
  const parts: DayPart[] = [
    {
      day: startedOn,
      minutes: firstDayMinutes,
      nightMinutes: nightWithin(startMinute, MINUTES_PER_DAY),
      isStart: true,
    },
  ];

  const tailMinutes = SHIFT_MINUTES - firstDayMinutes;
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
