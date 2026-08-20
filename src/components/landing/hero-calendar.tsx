import type { CSSProperties, ReactNode } from "react";

import { MonthGrid } from "@/features/shift/components/month-grid";
import { MONTH_NAMES } from "@/features/shift/components/month-names";
import {
  addDays,
  dayOfMonth,
  daysBetween,
  datesOfMonth,
  makeDate,
  weekday,
  type IsoDate,
} from "@/features/shift/domain/plain-date";
import { SHIFT_CYCLE_DAYS } from "@/features/shift/domain/value-objects";
import { cn } from "@/lib/utils/cn";

/**
 * Четыре месяца графика на первом экране посадочной страницы.
 *
 * --- Почему не картинка ---------------------------------------------------
 *
 * Здесь стоял снимок рабочего экрана в двух файлах — по одному на тему.
 * Снимок нельзя оживить, нельзя перекрасить под тему без грязи и нельзя
 * прочесть: его приходилось гасить, чтобы не спорил с текстом. Сетка,
 * собранная той же деталью, что и в расчёте (`MonthGrid`), решает всё
 * сразу: она честная — те же клетки, те же цвета, тот же контур месяца, —
 * следует теме сама и умеет появляться.
 *
 * --- Как она появляется ---------------------------------------------------
 *
 * Сначала на месте месяцев только скелет: названия и буквы дней недели.
 * Потом по нему проходит волна, и клетки собираются по одной — по
 * диагонали, из левого верхнего угла первого месяца в правый нижний
 * четвёртого. Каждая приходит из размытия, вспыхивает на подлёте и
 * садится на место. Когда сетка собрана, над ней встают три числа.
 *
 * Порядок обязателен: числа — это ИТОГ сетки, и появиться раньше неё они
 * не могут, иначе получаются просто две картинки, приехавшие вместе.
 *
 * Волна считается по месту клетки, а не по номеру дня: индекс = столбец +
 * строка, плюс сдвиг месяца. Поэтому фронт идёт ровной диагональю через
 * все четыре месяца, а не месяц за месяцем.
 *
 * --- Почему целиком `aria-hidden` -----------------------------------------
 *
 * Это пример, а не сведения о человеке: полторы сотни чисел и три итога
 * чужого года. Читалке они дали бы двухминутную диктовку дат, из которой
 * не следует ничего, — а всё, что здесь показано, сказано рядом словами.
 *
 * --- Почему индекс волны — переменная в разметке ---------------------------
 *
 * Задержка у каждой из полутора сотен клеток своя, и вычислить её можно
 * только там, где известно место клетки. Правило CSS на каждое число
 * означало бы полторы сотни правил; `nth-child` не знает, в каком месяце
 * его клетка. Переменная в разметке — единственный способ передать в CSS
 * ЧИСЛО, а не оформление: сама анимация целиком описана в `globals.css`.
 */

/**
 * Год и месяцы фрагмента.
 *
 * Год записан числом, а не взят от системных часов: страница собирается
 * заранее и раздаётся статикой, так что «текущий год» здесь означал бы
 * год сборки, — а он молча разошёлся бы с настоящим первого января.
 * Числа рядом относятся к тому же году.
 *
 * Месяцы — весна и начало лета: в них есть и майские праздники, и
 * обычные недели, то есть год выглядит как год, а не как ровная гребёнка.
 */
const YEAR = 2026;
const MONTHS = [3, 4, 5, 6];

/** Смена 1-го караула, от которой отсчитывается цикл «сутки через трое». */
const KNOWN_SHIFT = makeDate(YEAR, 3, 2);

/** Столбцов и строк в месяце — на них раскладывается диагональ волны. */
const COLUMNS = 7;
const ROWS = 6;

/** Сутки заступления и их продолжение: 24 часа делятся датой полуночи. */
const SHIFT_START_HOURS = 16;
const SHIFT_TAIL_HOURS = 8;

function isShiftStart(day: IsoDate): boolean {
  const delta = daysBetween(KNOWN_SHIFT, day);
  return ((delta % SHIFT_CYCLE_DAYS) + SHIFT_CYCLE_DAYS) % SHIFT_CYCLE_DAYS === 0;
}

export interface HeroFigure {
  value: string;
  caption: string;
  /** Итог, ради которого страницу открыли: он один набран цветом сверки. */
  verify?: boolean;
}

export function HeroCalendar({ figures }: { figures: readonly HeroFigure[] }) {
  // Волна доходит до правого нижнего угла последнего месяца — числа ждут
  // её конца. Задержка считается здесь, а не подбирается в CSS на глаз:
  // измени раскладку месяцев, и она пересчитается сама.
  const lastWave = waveBase(MONTHS.length - 1) + (COLUMNS - 1) + (ROWS - 1);

  return (
    <div aria-hidden className="select-none">
      <dl className="hero-cal__figures mb-4 flex flex-wrap gap-2" style={delay(lastWave)}>
        {figures.map((figure) => (
          <div
            key={figure.caption}
            className="min-w-24 flex-1 rounded-xl bg-paper-raised px-4 py-2.5"
          >
            <dd
              className={cn(
                "font-mono text-xl leading-none sm:text-2xl",
                figure.verify ? "font-medium text-verify" : "text-ink",
              )}
            >
              {figure.value}
            </dd>
            <dt className="mt-1.5 text-[11px] leading-tight text-ink-muted">
              {figure.caption}
            </dt>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-[9px] sm:gap-x-6 sm:text-[11px] lg:text-[10px] xl:text-[11px]">
        {MONTHS.map((month, order) => (
          <Month key={month} month={month} base={waveBase(order)} />
        ))}
      </div>
    </div>
  );
}

/** Сдвиг волны для месяца по его месту в сетке 2×2. */
function waveBase(order: number): number {
  const row = Math.floor(order / 2);
  const column = order % 2;
  return column * (COLUMNS + 1) + row * (ROWS + 1);
}

function delay(wave: number): CSSProperties {
  return { "--i": wave } as CSSProperties;
}

function Month({ month, base }: { month: number; base: number }) {
  const days = datesOfMonth(YEAR, month);
  const first = days[0];
  if (first === undefined) return null;
  const offset = weekday(first);

  return (
    <MonthGrid
      joined
      title={
        <span className="hero-cal__title" style={delay(base)}>
          {MONTH_NAMES[month - 1]}
        </span>
      }
      days={days}
      renderDay={(day, corners) => {
        const slot = offset + daysBetween(first, day);
        const start = isShiftStart(day);
        const tail = isShiftStart(addDays(day, -1));

        return (
          <Cell
            corners={corners}
            wave={base + (slot % COLUMNS) + Math.floor(slot / COLUMNS)}
            tone={
              start
                ? "rounded-md border border-verify/25 bg-verify/30 text-verify"
                : tail
                  ? "rounded-md border border-verify/15 bg-verify/5 text-verify"
                  : "text-ink-faint"
            }
            mark={start ? SHIFT_START_HOURS : tail ? SHIFT_TAIL_HOURS : null}
          >
            {dayOfMonth(day)}
          </Cell>
        );
      }}
    />
  );
}

/**
 * Клетка суток — та же, что в расчёте: плашка месяца снизу, вид суток
 * сверху. Разделены они не ради красоты: сомкнутый месяц держит форму
 * внешним контуром, и скругления углов принадлежат плашке, а цвет смены —
 * тому, что внутри неё.
 */
function Cell({
  corners,
  wave,
  tone,
  mark,
  children,
}: {
  corners: string;
  wave: number;
  tone: string;
  mark: number | null;
  children: ReactNode;
}) {
  return (
    <div className={cn("hero-cal__cell bg-paper-raised", corners)} style={delay(wave)}>
      <div
        className={cn(
          "flex aspect-square w-full flex-col items-center justify-center leading-tight",
          tone,
        )}
      >
        <span className="font-mono text-[1em]">{children}</span>
        {/* Пустая строка вместо пропуска: без неё число в клетке без смены
            стоит по центру, а в клетке со сменой — выше, и ряд чисел идёт
            волной.

            Уже на 360 точках часы уходят совсем: клетка там 18 точек в
            стороне, и две строки в ней слипаются. Форма графика — где
            смены, где просветы — читается и без часов. */}
        <span className="font-mono text-[0.75em] max-[359px]:hidden">{mark ?? " "}</span>
      </div>
    </div>
  );
}
