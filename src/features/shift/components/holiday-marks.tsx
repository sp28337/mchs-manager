import {
  Coffee,
  Flag,
  Flower2,
  Handshake,
  Medal,
  PartyPopper,
  Shield,
  Sprout,
  Snowflake,
  Star,
  type LucideIcon,
} from "lucide-react";

import { addDays, type IsoDate } from "../domain/plain-date";
import {
  calendarWithOverrides,
  type DaySource,
  type DayType,
} from "../domain/production-calendar";

/**
 * Значок праздника в правом верхнем углу клетки дня.
 *
 * --- Что показывается -------------------------------------------------------
 *
 * Праздничные дни производственного календаря (ст. 112 ТК РФ) — с учётом
 * правок человека: день, отмеченный праздничным вручную, получает значок так
 * же, как законный. Рабочие, выходные и предпраздничные дни значка не носят —
 * они и так различаются цветом клетки.
 *
 * Значок называет САМ праздник, а не просто «праздник вообще»: снежинка у
 * новогодних дней, звезда у Рождества, щит у Дня защитника Отечества, цветок
 * у 8 Марта, росток у Праздника Весны и Труда, медаль у Дня Победы, флаг у
 * Дня России, рукопожатие у Дня народного единства. Праздник, которого нет в
 * законе (день, помеченный вручную), получает хлопушку, а нерабочий день,
 * который дало постановление о переносе («по закону» это рабочий день, на
 * который перенесли отдых), — чашку: праздником он не является, и называть
 * его так значило бы соврать.
 *
 * Название праздника — ещё и в подписи клетки: значок мелкий и читается как
 * образ, а не как слово, и незрячему читателю он недоступен вовсе.
 *
 * --- Почему значок не двигает ничего ---------------------------------------
 *
 * Он положен поверх клетки (`position: absolute`, `.holiday-mark` в
 * `globals.css`), а не вставлен в её строки: число и подпись стоят там, где
 * стояли, а клетки сетки остаются теми же по размеру до точки. Из-за этого же
 * его можно спрятать, когда места мало: на мелком масштабе он перекрыл бы число
 * (`.holiday-mark` обращается в ноль по ширине месяца), и никто не сдвинется.
 *
 * Модуль без `"use client"`: ни состояния, ни эффектов — только данные и
 * разметка, и клетки обоих видов — графика смен и календаря года — берут отсюда
 * одно и то же.
 */

export interface HolidayMark {
  icon: LucideIcon;
  /** Название праздника — для подписи клетки. */
  title: string;
}

/** Закон ст. 112 ТК РФ ч. 1: даты те же каждый год. */
const FIXED: Readonly<Record<string, HolidayMark>> = {
  "01-01": { icon: Snowflake, title: "Новый год" },
  "01-02": { icon: Snowflake, title: "Новогодние каникулы" },
  "01-03": { icon: Snowflake, title: "Новогодние каникулы" },
  "01-04": { icon: Snowflake, title: "Новогодние каникулы" },
  "01-05": { icon: Snowflake, title: "Новогодние каникулы" },
  "01-06": { icon: Snowflake, title: "Новогодние каникулы" },
  "01-07": { icon: Star, title: "Рождество Христово" },
  "01-08": { icon: Snowflake, title: "Новогодние каникулы" },
  "02-23": { icon: Shield, title: "День защитника Отечества" },
  "03-08": { icon: Flower2, title: "Международный женский день" },
  "05-01": { icon: Sprout, title: "Праздник Весны и Труда" },
  "05-09": { icon: Medal, title: "День Победы" },
  "06-12": { icon: Flag, title: "День России" },
  "11-04": { icon: Handshake, title: "День народного единства" },
};

/** День, отмеченный праздничным вручную, а в законе такого числа нет. */
const OTHER: HolidayMark = { icon: PartyPopper, title: "Праздничный день" };

/** Выходной по постановлению о переносе: нерабочий, но не праздник. */
const TRANSFERRED: HolidayMark = { icon: Coffee, title: "Выходной по переносу" };

/**
 * Значок праздника для суток — или `null`, если сутки не праздничные.
 *
 * Вид суток приходит снаружи, уже с правками человека (`dayTypeAt`,
 * `CalendarDay.dayType`): здесь решается только, КАКОЙ значок.
 */
export function holidayMarkAt(
  day: IsoDate,
  type: DayType,
  source: DaySource = "statutory",
): HolidayMark | null {
  if (type !== "holiday") return null;
  return FIXED[day.slice(5)] ?? (source === "override" ? OTHER : TRANSFERRED);
}

/**
 * Значки праздников всех суток отрезка `[periodStart, periodEnd)`.
 *
 * Календарь берётся ПО ГОДУ САМИХ СУТОК: отрезок может пересечь границу года,
 * и декабрьский день не должен достаться чужому календарю. Правки человека
 * накладываются поверх закона — так же, как при расчёте нормы
 * (`calendarWithOverrides`), и значок не расходится с числами над сеткой.
 *
 * Карта строится один раз на отрезок, а не по запросу на каждые сутки: один
 * запрос — это календарь года целиком, а клеток в сетке — до трёхсот шестидесяти.
 */
export function holidayMarksFor(
  periodStart: IsoDate,
  periodEnd: IsoDate,
  overrides: Readonly<Record<string, DayType>>,
): ReadonlyMap<IsoDate, HolidayMark> {
  const marks = new Map<IsoDate, HolidayMark>();
  const byDay = new Map(Object.entries(overrides) as [IsoDate, DayType][]);
  const firstYear = Number(periodStart.slice(0, 4));
  // Конец отрезка исключающий: отрезок, кончающийся 1 января, последнего года
  // не захватывает.
  const lastYear = Number(addDays(periodEnd, -1).slice(0, 4));
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (const { day, dayType, source } of calendarWithOverrides(year, byDay)) {
      const mark = holidayMarkAt(day, dayType, source);
      if (mark !== null) marks.set(day, mark);
    }
  }
  return marks;
}

/** Сам значок — угловая метка клетки. */
export function HolidayIcon({ mark }: { mark: HolidayMark }) {
  const Icon = mark.icon;
  return (
    <span aria-hidden className="holiday-mark">
      <Icon />
    </span>
  );
}
