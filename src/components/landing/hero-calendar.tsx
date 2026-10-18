import type { CSSProperties } from "react";

import {
  ABSENCE_MARK,
  ABSENCE_TONE,
  ABSENCE_TONE_QUIET,
  CALLOUT_MARK,
  CALLOUT_TONE,
  SHIFT_TAIL_TONE,
  SHIFT_TONE,
} from "@/features/shift/components/day-marks";
import { MonthGrid } from "@/features/shift/components/month-grid";
import { MONTH_NAMES } from "@/features/shift/components/month-names";
import {
  addDays,
  dayOfMonth,
  daysBetween,
  datesOfMonth,
  weekday,
  type IsoDate,
} from "@/features/shift/domain/plain-date";
import { SHIFT_CYCLE_DAYS } from "@/features/shift/domain/value-objects";
import { cn } from "@/lib/utils/cn";

import { HeroFigures } from "./hero-figures";
import { HeroMarkedCell } from "./hero-marked-cell";
import { HeroMonthMeta } from "./hero-month-meta";
import { HeroPointer } from "./hero-pointer";
import {
  HERO_KNOWN_SHIFT,
  HERO_MARK_MS,
  HERO_MONTHS,
  HERO_SCRIPTS,
  HERO_YEAR,
  heroStagger,
  type HeroEvent,
  type HeroLayout,
} from "./hero-story";
import { cellWave, headWave, heroLastWave, letterWave } from "./hero-wave";

/**
 * Месяцы графика на первом экране посадочной страницы: четыре, а на узком — один.
 *
 * --- Почему не картинка ---------------------------------------------------
 *
 * Здесь стоял снимок рабочего экрана в двух файлах — по одному на тему.
 * Снимок нельзя оживить, нельзя перекрасить под тему без грязи и нельзя
 * прочесть: его приходилось гасить, чтобы не спорил с текстом. Месяцы,
 * собранные той же деталью, что и в расчёте (`MonthGrid`), решают всё
 * сразу: те же клетки, те же цвета, тот же контур, — и они следуют теме
 * сами, читаются на любой ширине и умеют жить.
 *
 * --- Почему четыре месяца, два на два -------------------------------------
 *
 * Сперва был один месяц крупно: у него есть ближний край и дальний, и потому
 * есть объём. Но показывал он не то, что человек увидит внутри. В расчёте это
 * сетка месяцев, у каждого над клетками свой итог — норма, факт, разница, — и
 * человек, пришедший с главной, искал одну страницу календаря и не находил её.
 *
 * Теперь первый экран собран так же: четыре месяца по два в строке, у каждого
 * шапка с названием и итогом, буквы дней недели, клетки с часами смены и
 * буквой «В» у свободных. Месяцы — июль, август, сентябрь, октябрь; почему
 * именно они — в `hero-story.ts`.
 *
 * --- Почему на узком экране один --------------------------------------------
 *
 * Ниже `md` плоскость не уходит вглубь, а стоит перед читателем — «видом с
 * фронта», — и на трёхстах точках четыре месяца дали бы клетку в полтора
 * десятка точек: цифру в ней не разобрать, а палец не разглядеть. Остаётся
 * один месяц, июль, и история разыгрывается на нём. Обе раскладки собраны в
 * разметке заранее, а какая видна, решает таблица стилей: так страница не
 * ждёт сценария и не мигает при повороте экрана.
 *
 * --- Что в них происходит ---------------------------------------------------
 *
 * Палец (`HeroPointer`) едет по месяцам, нажимает на сутки и ставит запись —
 * отпуск, больничный, вызов, отгул; сутки ложатся друг за другом, и числа над
 * сеткой и над каждым месяцем доходят до новых значений. Когда всё поставлено,
 * палец так же по очереди всё убирает — и круг начинается заново. Сам
 * рассказ, числа и сроки — в `hero-story.ts`; здесь только разметка.
 *
 * --- Как они выходят из прозрачности --------------------------------------
 *
 * Плоскость наклонена в перспективе и уходит дальним краем ЗА текст.
 * Там, где она под словами, её нет совсем; ближе — она проступает мутным
 * пятном; ещё ближе — становится сеткой; у ближнего края стоит резко, до
 * последней цифры. Три средства работают вместе и в одном направлении:
 *
 * * ПЕРСПЕКТИВА даёт дальнему краю уйти вглубь, а не просто уменьшиться.
 * * МАСКА уводит дальний край в прозрачность плавно и без ступеней.
 * * ДЫМКА — второй экземпляр тех же месяцев, размытый целиком и видимый
 *   только в средней полосе. Размытие ОДНИМ слоем на всю плоскость, а не у
 *   каждой клетки: у клеток размытие вылезает за их края, и месяц вместо
 *   цельной плашки распадается на сорок мохнатых квадратов.
 *
 * Направление глубины зависит от раскладки, и обе стороны честные: на
 * широком экране текст СЛЕВА, значит вглубь уходит левый край; на узком
 * месяцы стоят ПОД текстом, и вглубь уходит верхний.
 *
 * --- Как они появляются ----------------------------------------------------
 *
 * Сначала на месте месяцев ничего нет. Потом из глубины наружу проходит
 * волна, и клетки собираются по одной: приходят из размытия, вспыхивают на
 * подлёте и садятся на место. Когда сетка собрана, над ней встают три числа, и
 * только после этого выезжает палец.
 *
 * Порядок обязателен: числа — это ИТОГ сетки, и появиться раньше неё они
 * не могут, иначе получаются просто две картинки, приехавшие вместе.
 *
 * --- Почему индекс волны — переменная в разметке ---------------------------
 *
 * Задержка у каждой клетки своя, и вычислить её можно только там, где
 * известно место клетки. Правило CSS на каждое число означало бы полторы
 * сотни правил; `nth-child` не знает, в каком столбце его клетка.
 * Переменная в разметке — единственный способ передать в CSS ЧИСЛО, а не
 * оформление: сама анимация целиком описана в `globals.css`, а места в волне
 * считает `hero-wave.ts`.
 *
 * --- Почему целиком `aria-hidden` -----------------------------------------
 *
 * Это пример, а не сведения о человеке: сто двадцать с лишним чисел и
 * итоги чужого полугодия. Читалке они дали бы диктовку дат, из которой не
 * следует ничего, — а всё, что здесь показано, сказано рядом словами.
 */

/** Смена, от которой отсчитывается цикл «сутки через трое». */
const KNOWN_SHIFT = HERO_KNOWN_SHIFT;

/** Сутки начала смены и их продолжение: 24 часа делятся датой полуночи. */
const SHIFT_START_HOURS = "16";
const SHIFT_TAIL_HOURS = "8";

/**
 * Свободные сутки — «В», как в самом расчёте.
 *
 * Под числом в клетке стоит вторая строка: часы смены. У свободных суток
 * часов нет, и строка была пустой — в сетке получались дырки там, где на
 * рабочем экране стоит буква. Пустое место при этом не означало ничего:
 * человек видел не «выходной», а недорисованную клетку.
 */
const FREE_DAY_MARK = "В";

function isShiftStart(day: IsoDate): boolean {
  const delta = daysBetween(KNOWN_SHIFT, day);
  return ((delta % SHIFT_CYCLE_DAYS) + SHIFT_CYCLE_DAYS) % SHIFT_CYCLE_DAYS === 0;
}

/**
 * Вид суток, накрытых записью, — тот же, что на графике.
 *
 * В полную силу — только сутки заступления на смену; продолжение и свободные
 * сутки внутри записи — вполголоса (`ABSENCE_TONE_QUIET`): цвет тот же,
 * плотность меньше. Вызов — свой цвет и своя буква, и он один на все сутки.
 * Тот, кто выучил это на главной, найдёт то же в расчёте.
 */
function overlayOf(event: HeroEvent, start: boolean): { tone: string; mark: string } {
  if (event.kind === "callout") {
    return { tone: CALLOUT_TONE, mark: CALLOUT_MARK };
  }
  const tone = start ? ABSENCE_TONE[event.kind] : ABSENCE_TONE_QUIET[event.kind];
  return { tone, mark: ABSENCE_MARK[event.kind] };
}

const isoOf = (month: number, date: number) =>
  `${HERO_YEAR}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}` as IsoDate;

function HeroMonth({
  layout,
  month,
  index,
}: {
  layout: HeroLayout;
  month: number;
  index: number;
}) {
  const days = datesOfMonth(HERO_YEAR, month);
  const first = days[0]!;
  const offset = weekday(first);
  const events = HERO_SCRIPTS[layout].events.filter((event) => event.month === month);

  return (
    <MonthGrid
      joined
      title={MONTH_NAMES[month - 1]}
      meta={<HeroMonthMeta layout={layout} index={index} />}
      // Подпись растёт вместе с клеткой: кегль плоскости считается от её
      // ширины, а подпись — доля от него, в тех же пропорциях, что в расчёте
      // (14 и 11 точек при клетке в 11,7).
      titleClassName="text-[1.2em]"
      metaClassName="text-[0.94em]"
      // Шапка приходит вместе с клетками, а не стоит с первого кадра.
      headProps={{ className: "hero-cal__cell", style: vars(headWave(layout, index)) }}
      days={days}
      // Буквы дней недели собираются вместе с клетками, а не стоят с
      // первого кадра. Их место в волне — на строку ВЫШЕ первой.
      weekdayProps={(column) => ({
        className: "hero-cal__cell text-[0.85em]",
        style: vars(letterWave(layout, index, column)),
      })}
      // Пустые клетки — вместе со всеми: сами они ничего не показывают, но
      // держат строку, и приходить им положено тем же фронтом, что и
      // соседним числам.
      padProps={(slot) => ({
        className: "hero-cal__cell",
        style: vars(cellWave(layout, index, slot)),
      })}
      renderDay={(day, corners) => {
        const slot = offset + daysBetween(first, day);
        const start = isShiftStart(day);
        const tail = isShiftStart(addDays(day, -1));
        const date = dayOfMonth(day);
        const tone = start
          ? cn("rounded-md border", SHIFT_TONE)
          : tail
            ? cn("rounded-md border", SHIFT_TAIL_TONE)
            : "text-ink-faint";
        const mark = start ? SHIFT_START_HOURS : tail ? SHIFT_TAIL_HOURS : FREE_DAY_MARK;

        // Сутки, которые палец когда-нибудь накроет записью, — отдельная
        // клетка, подписанная на свою запись; остальные — статика.
        const event = events.find((item) => item.days.includes(date));
        if (event !== undefined) {
          const overlay = overlayOf(event, start);
          return (
            <HeroMarkedCell
              layout={layout}
              eventId={event.id}
              order={event.days.indexOf(date)}
              stagger={heroStagger(event.days.length)}
              day={isoOf(month, date)}
              corners={corners}
              wave={cellWave(layout, index, slot)}
              tone={tone}
              mark={mark}
              overlay={overlay.tone}
              overlayMark={overlay.mark}
            >
              {date}
            </HeroMarkedCell>
          );
        }

        return (
          <Cell corners={corners} wave={cellWave(layout, index, slot)} tone={tone} mark={mark}>
            {date}
          </Cell>
        );
      }}
    />
  );
}

/**
 * Плоскость одной раскладки: числа сверху, месяцы под ними, палец поверх.
 *
 * Широкая и узкая — две отдельные плоскости, а не одна, что перестраивается: у
 * них разные месяцы, разные числа над ними и разная история. Какая из них видна,
 * решает таблица стилей по ширине окна (`className`), а часы истории (`HeroPointer`
 * и остальные подписчики) идут только у той, что на экране.
 */
function HeroPlane({ layout, className }: { layout: HeroLayout; className: string }) {
  const script = HERO_SCRIPTS[layout];
  const wide = layout === "wide";

  const months = (
    // Просвет между месяцами и между строками — те же, что у сетки в расчёте
    // (`gap-x-6 gap-y-5` при кегле 11,7), только в `em` плоскости: растёт
    // вместе с ней.
    <div
      className={cn(
        "grid items-start gap-x-[1.9em] gap-y-[1.6em]",
        wide ? "grid-cols-2" : "grid-cols-1",
      )}
    >
      {HERO_MONTHS[layout].map((month, index) => (
        <HeroMonth key={month} layout={layout} month={month} index={index} />
      ))}
    </div>
  );

  return (
    // Шаг волны у раскладок разный: клеток в узкой втрое меньше, и тот же шаг
    // собрал бы её втрое быстрее — а сборка должна занимать три четверти секунды
    // на любой.
    <div
      className={cn("hero-cal__stage flex justify-center", className)}
      style={{ "--cal-step": `${script.waveStepMs}ms` } as CSSProperties}
    >
      {/* Сцена задаёт перспективу, плоскость — наклон. Точка схода одна на
          весь блок и стоит там, где стоит читатель: у ближнего края.

          Числа лежат В ТОЙ ЖЕ плоскости, что и месяцы, и наклонены вместе
          с ней: они не подпись рядом с картинкой, а лист, положенный
          поверх календаря. Маска дальнего края на них не распространяется
          — они целиком в ближней, резкой части.

          Слоёв месяцев два, и это одни и те же месяцы. Нижний размыт
          целиком и показан только в средней полосе — там, где сетка ещё
          не в фокусе. Верхний резкий и проявляется ближе к читателю. В
          полосе, где видны оба, размытый просвечивает сквозь недобравший
          плотности резкий, и переход выходит непрерывным.

          Почему не `backdrop-filter` одним слоем: маска его в Chromium не
          ограничивает, когда родитель повёрнут в трёх измерениях, — и
          размытым оказывается весь месяц целиком, до последней клетки. */}
      <div
        className={cn(
          "hero-cal__plane",
          // Широкая — вся колонка. Узкая стоит перед читателем и уже её на
          // седьмую часть: во всю ширину телефона клетка выходила крупной и
          // оттого тесной. С 360 точек, не раньше: на 320 плоскость и так
          // впритык.
          wide ? "w-full" : "w-[88%] max-w-104 max-[359px]:w-full sm:max-w-128",
        )}
      >
        <HeroFigures
          layout={layout}
          className="hero-cal__figures mb-5 sm:mb-7"
          style={vars({ "--i": heroLastWave(layout) })}
        />

        <div className="hero-cal__box">
          <div className={cn("hero-cal__stack hero-cal__months", !wide && "hero-cal__months--single")}>
            <div className="hero-cal__layer hero-cal__layer--haze">{months}</div>
            <div className="hero-cal__layer hero-cal__layer--sharp">{months}</div>
          </div>
          {/* Палец — над обоими слоями, в той же плоскости. */}
          <HeroPointer layout={layout} />
        </div>
      </div>
    </div>
  );
}

export function HeroCalendar({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("hero-cal select-none flex flex-col justify-center", className)}
      // Длительность появления отметки уходит в CSS отсюда: в сценарии на ней
      // построено всё расписание, и записать её вторым числом в правиле
      // значило бы завести второй источник той же величины.
      style={{ "--mark-ms": HERO_MARK_MS } as CSSProperties}
    >
      {/* Порог — `md`, тот же, что у раскладки всего первого экрана и у часов
          истории (`hero-story-store.ts`). */}
      <HeroPlane layout="wide" className="max-md:hidden" />
      <HeroPlane layout="narrow" className="md:hidden" />
    </div>
  );
}

function vars(style: object): CSSProperties {
  return style as CSSProperties;
}

/**
 * Клетка суток, на которую записей не ляжет, — та же, что в расчёте: плашка
 * месяца снизу, вид суток сверху. Разделены они не ради красоты: сомкнутый
 * месяц держит форму внешним контуром, и скругления углов принадлежат плашке, а
 * цвет смены — тому, что внутри неё.
 *
 * Клетка с записью — своя, клиентская (`HeroMarkedCell`): та же разметка, но
 * подписанная на историю.
 */
function Cell({
  corners,
  wave,
  tone,
  mark,
  children,
}: {
  corners: string;
  wave: { "--ix": number; "--iy": number };
  tone: string;
  mark: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("hero-cal__cell relative bg-paper-raised lit-tile", corners)}
      style={vars(wave)}
    >
      <div
        className={cn(
          "flex aspect-square w-full flex-col items-center justify-center leading-tight",
          tone,
        )}
      >
        <span className="font-mono text-[1em]">{children}</span>
        {/* Вторая строка есть у каждой клетки: часы смены или «В». Без
            неё число в клетке без смены стояло бы по центру, а в клетке
            со сменой — выше, и ряд чисел пошёл бы волной. */}
        <span className="font-mono text-[0.7em]">{mark}</span>
      </div>
    </div>
  );
}
