"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Рисунки статистики: столбцы по месяцам и ход баланса.
 *
 * --- Почему свои, а не библиотека -----------------------------------------
 *
 * Страницы отдаются статикой и рассчитаны на телефон в караульном
 * помещении. Любая рисовальная библиотека — это сотня-другая килобайт на
 * то, чего здесь нужно ровно два вида: столбики за двенадцать месяцев и
 * ломаная через ноль. Оба рисуются десятком тегов, зато следуют теме,
 * лампе и кеглю страницы без единой подгонки.
 *
 * --- Почему поле меряется, а не задано числом -----------------------------
 *
 * Сперва у `viewBox` были свои единицы — 720 на 220, — и браузер ужимал
 * весь рисунок под ширину окна. На настольном экране это работало, а на
 * телефоне 720 единиц ложились в 302 точки: подпись в 11 единиц выходила
 * ростом в четыре с половиной точки. Не мелкой — нечитаемой.
 *
 * Поэтому ширина СНИМАЕТСЯ с коробки, и `viewBox` равен ей: единица
 * рисунка — это точка экрана. Тогда всё, что задано числами, задано в том
 * же, в чём написаны правила: подпись 11 точек и на телефоне 11 точек,
 * столбец не толще 24, линия ровно 2.
 *
 * --- Почему норма — черта, а не второй столбец ----------------------------
 *
 * Она и была вторым столбцом, и на настольном экране читалась. Но столбцов
 * при этом двенадцать пар, и на телефоне на пару остаётся двадцать точек:
 * два столбика по четыре точки с просветом между ними — это уже не
 * столбцы, а рябь.
 *
 * Дело, впрочем, не только в тесноте. Норма и факт — не две равноправные
 * величины: норма это МЕРКА, к которой факт примеряют, и вопрос у рисунка
 * один — дотянул или перерос. Черта поперёк столбца отвечает на него
 * прямо, и отвечает одинаково на любой ширине.
 *
 * --- Остальные правила, которым здесь всё подчинено -----------------------
 *
 * * Ось одна. Двух шкал на одном поле не бывает нигде: другая величина —
 *   это другой рисунок, а не вторая ось справа. Поэтому ночные часы
 *   считаются отдельно, а не подсаживаются к норме.
 * * Метка не на каждом столбце. Число подписано у крайней точки хода и у
 *   наведённого месяца; остальные читаются по оси и по таблице внизу окна.
 * * Цвет несут ТОЛЬКО столбцы и линии. Подписи, оси и легенда набраны
 *   чернилами: светлый цвет столбца в роли текста нечитаем, а
 *   принадлежность показывает цветная плашка РЯДОМ со словом.
 * * Сетка волосяная и сплошная: пунктир на осях читается как данные.
 * * У каждого рисунка есть таблица (внизу окна). Это не запасной путь для
 *   читалки, а обязательство: зелёный на светлой бумаге даёт 2,9:1 —
 *   меньше положенных трёх, — и без доступного другим способом числа такой
 *   цвет ставить нельзя.
 *
 * --- Наведение ------------------------------------------------------------
 *
 * Есть у обоих рисунков и работает одинаково: цель наведения — вся колонка
 * месяца во всю высоту поля, а не сам столбик. В столбик высотой в три
 * точки (месяц, где отработано почти ничего) пальцем не попасть, а в
 * колонку — нельзя не попасть. С клавиатуры то же самое: колонки
 * проходятся табуляцией.
 */

/** Поля вокруг поля рисунка, точками. Левое — под подписи оси. */
const PAD = { top: 18, right: 8, bottom: 24, left: 40 };
/** Высота поля: на узком экране ниже — там его прокручивают пальцем. */
const HEIGHT = { narrow: 190, wide: 230 };
const NARROW = 520;

/** Толще этого столбец не бывает: «не заполнять гнездо целиком». */
const MAX_BAR = 24;
/** Доля колонки, которую занимает столбец; остаток — воздух. */
const BAR_FILL = 0.62;

export interface Column {
  /** Подпись под столбцом: «янв». */
  readonly label: string;
  /** Полное имя для наведения и читалки: «Январь». */
  readonly title: string;
  /** Высота столбца. `null` — месяца ещё не было. */
  readonly value: number | null;
  /** Черта-мерка поперёк столбца, если она у рисунка есть. */
  readonly target?: number | null;
  /** Строки всплывающей подписи: своё у каждого рисунка. */
  readonly readout: readonly { readonly what: string; readonly value: string }[];
}

/** Ключ легенды: заливка — у столбцов, штрих — у мерок и линий. */
export interface Key {
  readonly name: string;
  readonly colour: string;
  readonly shape: "bar" | "tick";
}

/**
 * Ширина коробки, снятая с неё же.
 *
 * До первого замера отдаётся настольная ширина, а не ноль: рисунок с
 * нулевой шириной успел бы мигнуть пустым полем.
 */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const node = box.current;
    if (node === null) return;
    const watch = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  return [box, width];
}

/**
 * Округление верха шкалы до круглого числа.
 *
 * Ось подписана двумя-тремя делениями, и делить на них 187,5 нельзя:
 * получаются «62,5 / 125 / 187,5» — числа, которые читатель складывает в
 * уме вместо того, чтобы смотреть на рисунок.
 */
function niceTop(peak: number): number {
  if (peak <= 0) return 1;
  const step = Math.pow(10, Math.floor(Math.log10(peak)));
  for (const factor of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const candidate = step * factor;
    if (candidate >= peak) return candidate;
  }
  return step * 10;
}

function Legend({ keys }: { keys: readonly Key[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
      {keys.map((it) => (
        <li key={it.name} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "inline-block",
              it.shape === "bar" ? "size-2.5 rounded-xs" : "h-0.5 w-3.5 rounded-full",
            )}
            style={{ background: it.colour }}
          />
          {it.name}
        </li>
      ))}
    </ul>
  );
}

/**
 * Всплывающая подпись.
 *
 * Она не решает: всё, что в ней написано, лежит и в таблице внизу окна.
 * Поэтому она не окно и не требует закрытия — просто плашка, идущая за
 * наведением и за фокусом.
 *
 * Стоит она в потоке НАД рисунком, а не поверх него: на телефоне рисунок
 * шириной в экран, и плашка поверх закрывала бы ровно тот столбец, ради
 * которого её открыли. Место под неё держится всегда — иначе рисунок
 * прыгал бы вниз при каждом наведении.
 */
function Readout({ column, keys }: { column: Column | null; keys: readonly Key[] }) {
  return (
    <div
      aria-live="polite"
      className={cn(
        "flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-2 py-1 text-xs",
        column === null ? "opacity-0" : "bg-paper-sunken",
      )}
    >
      {column === null ? null : (
        <>
          <span className="font-medium">{column.title}</span>
          {column.readout.map((row, index) => (
            <span key={row.what} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ background: keys[index]?.colour ?? "currentColor" }}
              />
              {/* Число впереди слова: серию читатель уже знает, ему нужно
                  число. В легенде порядок обратный. */}
              <span className="font-mono tabular-nums">{row.value}</span>
              <span className="text-ink-muted">{row.what}</span>
            </span>
          ))}
        </>
      )}
    </div>
  );
}

/** Общая обвязка: заголовок, пояснение, легенда, подпись наведения. */
function Frame({
  title,
  note,
  keys,
  hovered,
  children,
}: {
  title: string;
  note?: ReactNode;
  keys: readonly Key[];
  hovered: Column | null;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide">
          {title}
        </h3>
        {note ? <p className="text-xs text-ink-muted">{note}</p> : null}
      </div>
      {/* Легенда — только при двух ключах и больше: у одной серии коробка
          с единственной плашкой пересказывает заголовок. */}
      {keys.length > 1 ? <Legend keys={keys} /> : null}
      <Readout column={hovered} keys={keys} />
      {children}
    </section>
  );
}

/**
 * Прозрачные цели наведения во всю высоту поля — по одной на месяц.
 *
 * Они же задают порядок обхода с клавиатуры, поэтому у каждой своё имя,
 * собранное из тех же строк, что и всплывающая подпись.
 */
function Hits({
  columns,
  band,
  left,
  top,
  height,
  onPick,
}: {
  columns: readonly Column[];
  band: number;
  left: number;
  top: number;
  height: number;
  onPick: (index: number | null) => void;
}) {
  return (
    <g>
      {columns.map((column, index) => (
        <rect
          key={column.label}
          x={left + index * band}
          y={top}
          width={band}
          height={height}
          fill="transparent"
          tabIndex={0}
          role="button"
          aria-label={`${column.title}: ${column.readout
            .map((row) => `${row.what} ${row.value}`)
            .join(", ")}`}
          className="cursor-default outline-none focus-visible:fill-ink/5"
          onPointerEnter={() => onPick(index)}
          onPointerLeave={() => onPick(null)}
          onFocus={() => onPick(index)}
          onBlur={() => onPick(null)}
        />
      ))}
    </g>
  );
}

/** Подписи месяцев под полем. Через одну, когда все не помещаются. */
function MonthLabels({
  columns,
  band,
  left,
  baseline,
  every,
  hover,
}: {
  columns: readonly Column[];
  band: number;
  left: number;
  baseline: number;
  every: number;
  hover: number | null;
}) {
  return (
    <g aria-hidden>
      {columns.map((column, index) =>
        index % every === 0 || hover === index ? (
          <text
            key={column.label}
            x={left + index * band + band / 2}
            y={baseline}
            textAnchor="middle"
            className={cn("text-[11px]", hover === index ? "fill-ink" : "fill-ink-faint")}
          >
            {column.label}
          </text>
        ) : null,
      )}
    </g>
  );
}

/**
 * Столбцы по месяцам, с меркой поперёк или без неё.
 */
export function ColumnChart({
  title,
  note,
  columns,
  bar,
  target,
  format,
}: {
  title: string;
  note?: ReactNode;
  columns: readonly Column[];
  /** Ключ самих столбцов. */
  bar: Key;
  /** Ключ мерки, если у рисунка она есть. */
  target?: Key;
  format: (value: number) => string;
}) {
  const [box, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const labelId = useId();

  const narrow = width < NARROW;
  const height = narrow ? HEIGHT.narrow : HEIGHT.wide;
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;

  const top = niceTop(
    Math.max(
      0,
      ...columns.map((column) => Math.max(column.value ?? 0, column.target ?? 0)),
    ),
  );
  const band = innerW / columns.length;
  const barWidth = Math.min(MAX_BAR, band * BAR_FILL);
  // Мерка шире столбца ровно настолько, чтобы её концы выступали: черта
  // вровень с ним сливалась бы с его вершиной, когда факт равен норме.
  const tickWidth = Math.min(band - 2, barWidth + 8);
  const at = (value: number) => PAD.top + innerH - (value / top) * innerH;
  // На узком экране двенадцать подписей встают в 20 точек каждая и
  // сливаются: остаются каждая вторая и наведённая.
  const every = narrow ? 2 : 1;

  const keys = target ? [bar, target] : [bar];

  return (
    <Frame
      title={title}
      note={note}
      keys={keys}
      hovered={hover === null ? null : (columns[hover] ?? null)}
    >
      <div ref={box}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          className="max-w-full"
          role="img"
          aria-labelledby={labelId}
          onPointerLeave={() => setHover(null)}
        >
          <title id={labelId}>{title}</title>

          <g aria-hidden>
            {[0, top / 2, top].map((value) => (
              <g key={value}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={at(value)}
                  y2={at(value)}
                  className="stroke-rule"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={at(value)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-ink-faint text-[11px] tabular-nums"
                >
                  {format(value)}
                </text>
              </g>
            ))}
          </g>

          {columns.map((column, index) => {
            const centre = PAD.left + index * band + band / 2;
            const dim = hover !== null && hover !== index;
            return (
              <g key={column.label} className={cn(dim && "opacity-35")}>
                {column.value === null ? null : (
                  <rect
                    x={centre - barWidth / 2}
                    y={at(column.value)}
                    width={barWidth}
                    height={Math.max(0, PAD.top + innerH - at(column.value))}
                    // Скругление только у вершины — низ сидит на оси:
                    // столбец растёт от неё, и круглое основание отрывало
                    // бы его от собственного нуля.
                    rx={4}
                    style={{ fill: bar.colour }}
                  />
                )}
                {column.target === null || column.target === undefined ? null : (
                  <line
                    x1={centre - tickWidth / 2}
                    x2={centre + tickWidth / 2}
                    y1={at(column.target)}
                    y2={at(column.target)}
                    style={{ stroke: target?.colour }}
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                )}
              </g>
            );
          })}

          <MonthLabels
            columns={columns}
            band={band}
            left={PAD.left}
            baseline={height - 7}
            every={every}
            hover={hover}
          />

          <Hits
            columns={columns}
            band={band}
            left={PAD.left}
            top={PAD.top}
            height={innerH}
            onPick={setHover}
          />
        </svg>
      </div>
    </Frame>
  );
}

/**
 * Ход накопленного баланса: ломаная через ноль.
 *
 * Знак здесь — главное, и он показан ДВАЖДЫ: цветом (тот же зелёный и тот
 * же сигнальный, какими подписан итог наверху рабочего экрана) и
 * положением относительно нулевой черты. Второго довольно самого по себе:
 * даже там, где цвета неразличимы, «выше черты» и «ниже черты» перепутать
 * нельзя.
 */
export function BalanceChart({
  title,
  note,
  columns,
  format,
  over,
  under,
}: {
  title: string;
  note?: ReactNode;
  columns: readonly Column[];
  format: (value: number) => string;
  /** Цвет переработки и цвет недоработки — переменными темы. */
  over: string;
  under: string;
}) {
  const [box, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const labelId = useId();
  const clipId = useId();

  const narrow = width < NARROW;
  const height = narrow ? HEIGHT.narrow : HEIGHT.wide;
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;

  const values = columns.map((column) => column.value ?? 0);

  /**
   * Шкала НЕ симметрична вокруг нуля.
   *
   * Симметричной она и была, и на живом годе это выглядело так: линия весь
   * год выше нуля, а половина поля под ней пустая. Пустота эта не «место,
   * куда линия могла бы уйти», а просто выброшенная половина рисунка — то
   * же самое, что нарисовать вдвое мельче.
   *
   * Сторона, в которую линия не уходила, остаётся РОВНО нулём, а не
   * округляется: `niceTop` не умеет отдавать ноль (он делитель у
   * столбцов), и без этой проверки у года без недоработки под нулевой
   * чертой появлялось деление «−1» — прямо поверх нуля.
   */
  const peak = Math.max(...values);
  const dip = Math.min(...values);
  const hi = peak > 0 ? niceTop(peak) : 0;
  const lo = dip < 0 ? -niceTop(-dip) : 0;
  // Плоская линия по нулю — единственный случай, когда размах пуст:
  // делить на него нельзя, и шкале даётся условная единица.
  const span = hi - lo || 1;
  const band = innerW / columns.length;
  const at = (value: number) => PAD.top + ((hi - value) / span) * innerH;
  const zero = at(0);
  const x = (index: number) => PAD.left + index * band + band / 2;

  const line = values.map((value, index) => `${x(index)},${at(value)}`).join(" ");
  const area = `${x(0)},${zero} ${line} ${x(values.length - 1)},${zero}`;
  const last = values.at(-1) ?? 0;

  return (
    <Frame
      title={title}
      note={note}
      keys={[
        { name: "Переработка", colour: over, shape: "tick" },
        { name: "Недоработка", colour: under, shape: "tick" },
      ]}
      hovered={hover === null ? null : (columns[hover] ?? null)}
    >
      <div ref={box}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          className="max-w-full"
          role="img"
          aria-labelledby={labelId}
          onPointerLeave={() => setHover(null)}
        >
          <title id={labelId}>{title}</title>

          <g aria-hidden>
            {[...new Set([hi, 0, lo])].map((value) => (
              <g key={value}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={at(value)}
                  y2={at(value)}
                  className={value === 0 ? "stroke-rule-strong" : "stroke-rule"}
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={at(value)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-ink-faint text-[11px] tabular-nums"
                >
                  {format(value)}
                </text>
              </g>
            ))}
          </g>

          {/* Заливка режется нулевой чертой надвое: над ней она цвета
              переработки, под ней — недоработки. Обрезкой, а не двумя
              ломаными: ломаная одна, и разрывать её ради заливки значило
              бы считать её точки дважды. */}
          <defs>
            <clipPath id={`${clipId}-over`}>
              <rect x={0} y={0} width={width} height={Math.max(0, zero)} />
            </clipPath>
            <clipPath id={`${clipId}-under`}>
              <rect x={0} y={zero} width={width} height={Math.max(0, height - zero)} />
            </clipPath>
          </defs>
          <polygon
            points={area}
            style={{ fill: over }}
            opacity={0.1}
            clipPath={`url(#${clipId}-over)`}
          />
          <polygon
            points={area}
            style={{ fill: under }}
            opacity={0.1}
            clipPath={`url(#${clipId}-under)`}
          />
          <polyline
            points={line}
            fill="none"
            style={{ stroke: over }}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            clipPath={`url(#${clipId}-over)`}
          />
          <polyline
            points={line}
            fill="none"
            style={{ stroke: under }}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            clipPath={`url(#${clipId}-under)`}
          />

          {/* Точка на конце и число при ней — единственная подпись на
              рисунке: она и есть его ответ. Кольцо цвета бумаги вокруг
              точки — чтобы она читалась там, где пересекает черту. Число
              уходит в ту сторону, где поле пустое: вверх при плюсе, вниз
              при минусе. */}
          <circle
            cx={x(values.length - 1)}
            cy={at(last)}
            r={4}
            style={{ fill: last < 0 ? under : over }}
            className="stroke-paper"
            strokeWidth={2}
          />
          <text
            x={x(values.length - 1)}
            y={at(last) + (last < 0 ? 18 : -11)}
            textAnchor="end"
            className="fill-ink text-[12px] font-medium tabular-nums"
          >
            {`${last > 0 ? "+" : last < 0 ? "−" : ""}${format(Math.abs(last))}`}
          </text>

          {hover === null ? null : (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              className="stroke-ink-faint"
              strokeWidth={1}
            />
          )}

          <MonthLabels
            columns={columns}
            band={band}
            left={PAD.left}
            baseline={height - 7}
            every={narrow ? 2 : 1}
            hover={hover}
          />

          <Hits
            columns={columns}
            band={band}
            left={PAD.left}
            top={PAD.top}
            height={innerH}
            onPick={setHover}
          />
        </svg>
      </div>
    </Frame>
  );
}

/**
 * Полоска доли — для перечня освобождений.
 *
 * Одна и та же у всех видов, и это намеренно: цветом здесь отвечает
 * КЛЕТКА при названии — та самая, какой этот вид стоит на сетке, — а
 * полоска говорит только «сколько». Раскрасить полоски по видам значило бы
 * завести пять серий, которые надо различать на глаз: счётом их цвета для
 * такой роли не годятся (пара «доп. отпуск» и «отгул» расходится на 3,6
 * при восьми положенных), а различать их и не требуется — имя написано
 * рядом.
 */
export function ShareBar({ share }: { share: number }) {
  return (
    <span
      aria-hidden
      className="block h-1.5 w-full overflow-hidden rounded-full bg-paper-sunken"
    >
      <span
        className="block h-full rounded-full bg-ink-faint"
        style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
      />
    </span>
  );
}
