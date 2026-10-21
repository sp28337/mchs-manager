import { formatHoursTrim, type Decimal } from "../domain/decimal";
import { addDays, monthIndex, weekday, year, type IsoDate } from "../domain/plain-date";
import {
  MINUTES_PER_DAY,
  minutesToHours,
  shiftStartMinute,
  spanMinutes,
  splitShift,
} from "../domain/shift-hours";
import type { StoredProfile } from "../storage/profile";
import { calculateFor, monthBounds, shiftOn, shiftSpanAt } from "./derive";

/**
 * График, каким он ляжет на календарь, — для окна «Создать график».
 *
 * Человек отвечает на вопросы анкеты, не видя ни одного числа, и главное, что
 * ему нужно узнать до нажатия на кнопку: тот ли это график. «1|3» — слова, а
 * сетка с зелёными сутками через трое — то, что он узнаёт глазами, потому что
 * именно такая висит у него на работе. Поэтому окно рисует ближайшие недели по
 * его ответам, и они перестраиваются при каждой правке.
 *
 * --- Откуда берутся смены -------------------------------------------------------
 *
 * Не из своей арифметики, а у тех же функций, что и расчёт (`shiftOn`,
 * `shiftSpanAt`, `splitShift`): сутки, которые окно покажет сменой, и сутки,
 * которые расчёт посчитает сменой, обязаны совпасть до одних. Предпросмотр, в
 * котором цикл строится «чуть иначе», хуже отсутствующего.
 *
 * --- Какое окно времени ----------------------------------------------------------
 *
 * Пять недель с понедельника нынешней: сегодня видно, а впереди — достаточно,
 * чтобы разглядеть ритм любого из цикличных графиков (у «1|4» это шесть смен, у
 * «5|2» — двадцать пять). Не месяц: у месяца неровные края, а ритм читается
 * одинаково с любого числа.
 */

export const PREVIEW_WEEKS = 5;

/** Какими сутки видны: заступление, продолжение смены с прошлых суток или свободные. */
export type PreviewKind = "start" | "tail" | "free";

export interface PreviewCell {
  readonly day: IsoDate;
  readonly kind: PreviewKind;
  /** Часы смены в этих сутках; у свободных — пустая строка. */
  readonly hours: string;
  readonly today: boolean;
}

/** Первое число окна — понедельник той недели, в которой сегодня. */
export function previewFirstDay(today: IsoDate): IsoDate {
  return addDays(today, -weekday(today));
}

/** Минуты смены на сутках `day`, а не на сменах, что от них начинаются. */
function minutesOnDay(profile: StoredProfile, day: IsoDate): { own: number; tail: number } {
  const split = (from: IsoDate) => {
    const span = shiftSpanAt(profile, from);
    const length = spanMinutes(span);
    return length === null ? [] : splitShift(from, shiftStartMinute(span.startsAt), length);
  };

  const own = shiftOn(profile, day) ? (split(day)[0]?.minutes ?? 0) : 0;

  // Хвост смены, начатой накануне: суточная с восьми утра отдаёт вторым
  // суткам шестнадцать часов из двадцати четырёх.
  const previous = addDays(day, -1);
  const tail = shiftOn(profile, previous)
    ? (split(previous).find((part) => part.day === day)?.minutes ?? 0)
    : 0;

  return { own, tail };
}

export function previewCells(
  profile: StoredProfile,
  today: IsoDate,
  weeks: number = PREVIEW_WEEKS,
): PreviewCell[] {
  const first = previewFirstDay(today);

  return Array.from({ length: weeks * 7 }, (_, index) => {
    const day = addDays(first, index);
    const { own, tail } = minutesOnDay(profile, day);
    const minutes = own + tail;
    const kind: PreviewKind = own > 0 ? "start" : tail > 0 ? "tail" : "free";

    return {
      day,
      kind,
      hours: minutes > 0 ? formatHoursTrim(minutesToHours(Math.min(minutes, MINUTES_PER_DAY))) : "",
      today: day === today,
    };
  });
}

/** Итог месяца, в котором сегодня, — тот же расчёт, что и полоса итога в графике. */
export interface PreviewTotals {
  /** 0–11: по нему берётся название месяца. */
  readonly month: number;
  readonly norm: string;
  readonly actual: string;
  /** Модуль разницы: знак передаёт `under`. */
  readonly balance: string;
  readonly under: boolean;
  readonly over: boolean;
}

export function previewTotals(profile: StoredProfile, today: IsoDate): PreviewTotals {
  const month = monthIndex(today);
  const { periodStart, periodEnd } = monthBounds(year(today), month);
  const calculation = calculateFor(profile, periodStart, periodEnd);

  const under = calculation.undertimeHours.greaterThan(0);
  const balance: Decimal = under ? calculation.undertimeHours : calculation.overtimeHours;

  return {
    month,
    norm: formatHoursTrim(calculation.normHours),
    actual: formatHoursTrim(calculation.actualHours),
    balance: formatHoursTrim(balance),
    under,
    over: !under && balance.greaterThan(0),
  };
}
