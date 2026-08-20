import type { CSSProperties, ReactNode } from "react";

import { MonthGrid } from "@/features/shift/components/month-grid";
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
 * Месяц графика на первом экране посадочной страницы.
 *
 * --- Почему не картинка ---------------------------------------------------
 *
 * Здесь стоял снимок рабочего экрана в двух файлах — по одному на тему.
 * Снимок нельзя оживить, нельзя перекрасить под тему без грязи и нельзя
 * прочесть: его приходилось гасить, чтобы не спорил с текстом. Месяц,
 * собранный той же деталью, что и в расчёте (`MonthGrid`), решает всё
 * сразу: те же клетки, те же цвета, тот же контур, — и он следует теме
 * сам, читается на любой ширине и умеет появляться.
 *
 * --- Почему один месяц, а не четыре ---------------------------------------
 *
 * Четыре месяца по два в строке читались как таблица: четыре одинаковых
 * прямоугольника, между которыми глаз ищет разницу, которой нет. Один
 * месяц крупно — предмет: у него есть ближний край и дальний, и потому
 * есть объём.
 *
 * --- Как он выходит из прозрачности ---------------------------------------
 *
 * Плоскость наклонена в перспективе и уходит дальним краем ЗА текст.
 * Там, где она под словами, её нет совсем; ближе — она проступает мутным
 * пятном; ещё ближе — становится сеткой; у ближнего края стоит резко, до
 * последней цифры. Три средства работают вместе и в одном направлении:
 *
 * * ПЕРСПЕКТИВА даёт дальнему краю уйти вглубь, а не просто уменьшиться.
 * * МАСКА уводит дальний край в прозрачность плавно и без ступеней.
 * * ДЫМКА — второй экземпляр того же месяца, размытый целиком и видимый
 *   только в средней полосе. Размытие ОДНИМ слоем на весь месяц, а не у
 *   каждой клетки: у клеток размытие вылезает за их края, и месяц вместо
 *   цельной плашки распадается на сорок мохнатых квадратов.
 *
 * Направление глубины зависит от раскладки, и обе стороны честные: на
 * широком экране текст СЛЕВА, значит вглубь уходит левый край; на узком
 * месяц стоит ПОД текстом, и вглубь уходит верхний. Разметка отдаёт в CSS
 * оба порядка волны, а какой из них взять, решает медиазапрос.
 *
 * --- Как он появляется ----------------------------------------------------
 *
 * Сначала на месте месяца только скелет — буквы дней недели. Потом из
 * глубины наружу проходит волна, и клетки собираются по одной: приходят
 * из размытия, вспыхивают на подлёте и садятся на место. Когда сетка
 * собрана, над ней встают три числа.
 *
 * Порядок обязателен: числа — это ИТОГ сетки, и появиться раньше неё они
 * не могут, иначе получаются просто две картинки, приехавшие вместе.
 *
 * --- Почему индекс волны — переменная в разметке ---------------------------
 *
 * Задержка у каждой клетки своя, и вычислить её можно только там, где
 * известно место клетки. Правило CSS на каждое число означало бы четыре
 * десятка правил; `nth-child` не знает, в каком столбце его клетка.
 * Переменная в разметке — единственный способ передать в CSS ЧИСЛО, а не
 * оформление: сама анимация целиком описана в `globals.css`.
 *
 * --- Почему целиком `aria-hidden` -----------------------------------------
 *
 * Это пример, а не сведения о человеке: три с лишним десятка чисел и три
 * итога чужого года. Читалке они дали бы диктовку дат, из которой не
 * следует ничего, — а всё, что здесь показано, сказано рядом словами.
 */

/**
 * Месяц фрагмента.
 *
 * Год записан числом, а не взят от системных часов: страница собирается
 * заранее и раздаётся статикой, так что «текущий год» здесь означал бы
 * год сборки, — а он молча разошёлся бы с настоящим первого января.
 * Числа рядом относятся к тому же году.
 *
 * Май начинается с пятницы: в первой строке три дня, и у плашки месяца
 * есть уступ — тот самый скошенный угол, который делает её похожей на
 * страницу календаря, а не на прямоугольник.
 */
const YEAR = 2026;
const MONTH = 5;

/** Смена 1-го караула, от которой отсчитывается цикл «сутки через трое». */
const KNOWN_SHIFT = makeDate(YEAR, 3, 2);

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

export function HeroCalendar({
  figures,
  className,
}: {
  figures: readonly HeroFigure[];
  className?: string;
}) {
  const days = datesOfMonth(YEAR, MONTH);
  const first = days[0];
  if (first === undefined) return null;

  const offset = weekday(first);
  const rows = Math.ceil((offset + days.length) / 7);

  const month = (
    <MonthGrid
      joined
      days={days}
      renderDay={(day, corners) => {
        const slot = offset + daysBetween(first, day);
        const start = isShiftStart(day);
        const tail = isShiftStart(addDays(day, -1));

        return (
          <Cell
            corners={corners}
            wave={wave(slot % 7, Math.floor(slot / 7))}
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

  // Волна доходит до ближнего угла — числа ждут её конца. Задержка
  // считается здесь, а не подбирается в CSS на глаз: смени месяц, и она
  // пересчитается сама. Из двух порядков берётся более долгий.
  const lastWave = Math.max(wave(6, rows - 1).x, wave(6, rows - 1).y);

  return (
    <div aria-hidden className={cn("hero-cal select-none", className)}>
      <dl
        className="hero-cal__figures relative z-10 mb-5 flex flex-wrap gap-2 lg:ml-[18%]"
        style={vars({ "--i": lastWave })}
      >
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

      {/* Сцена задаёт перспективу, плоскость — наклон. Точка схода одна на
          весь блок и стоит там, где стоит читатель: у ближнего края.

          Слоёв два, и это один и тот же месяц. Нижний размыт целиком и
          показан только в средней полосе — там, где сетка ещё не в
          фокусе. Верхний резкий и проявляется ближе к читателю. В полосе,
          где видны оба, размытый просвечивает сквозь недобравший
          плотности резкий, и переход выходит непрерывным.

          Почему не `backdrop-filter` одним слоем: маска его в Chromium не
          ограничивает, когда родитель повёрнут в трёх измерениях, — и
          размытым оказывается весь месяц целиком, до последней клетки. */}
      <div className="hero-cal__stage">
        <div
          className={cn(
            // Клетка должна остаться клеткой календаря, а не квадратом с
            // мелкой цифрой посреди: кегль внутри задан в `em` и растёт
            // вместе с ней, но на планшете месяц во всю ширину даёт
            // клетку в сотню точек — и число в ней теряется. Поэтому в
            // одноколоночной раскладке ширина ограничена, а на широком
            // экране её держит колонка.
            "hero-cal__plane max-w-104 sm:max-w-120 lg:max-w-none",
            "text-base sm:text-lg lg:text-xl xl:text-2xl",
          )}
        >
          <div className="hero-cal__layer hero-cal__layer--haze">{month}</div>
          <div className="hero-cal__layer hero-cal__layer--sharp">{month}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Два порядка волны для клетки: вдоль ширины и вдоль высоты.
 *
 * Волна идёт из глубины наружу, а глубина на широком и узком экране
 * разная. Оба числа считаются здесь, выбор между ними — в CSS.
 */
function wave(column: number, row: number): { x: number; y: number } {
  return { x: column * 2 + row, y: row * 2 + column };
}

function vars(style: Record<string, number>): CSSProperties {
  return style as CSSProperties;
}

/**
 * Клетка суток — та же, что в расчёте: плашка месяца снизу, вид суток
 * сверху. Разделены они не ради красоты: сомкнутый месяц держит форму
 * внешним контуром, и скругления углов принадлежат плашке, а цвет смены —
 * тому, что внутри неё.
 */
function Cell({
  corners,
  wave: index,
  tone,
  mark,
  children,
}: {
  corners: string;
  wave: { x: number; y: number };
  tone: string;
  mark: number | null;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("hero-cal__cell bg-paper-raised", corners)}
      style={vars({ "--ix": index.x, "--iy": index.y })}
    >
      <div
        className={cn(
          "flex aspect-square w-full flex-col items-center justify-center leading-tight",
          tone,
        )}
      >
        <span className="font-mono text-[1em]">{children}</span>
        {/* Пустая строка вместо пропуска: без неё число в клетке без смены
            стоит по центру, а в клетке со сменой — выше, и ряд чисел идёт
            волной. */}
        <span className="font-mono text-[0.7em]">{mark ?? " "}</span>
      </div>
    </div>
  );
}
