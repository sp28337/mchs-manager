import type { CSSProperties } from "react";

/**
 * Откуда вырос лист.
 *
 * --- Что это -------------------------------------------------------------
 *
 * Полноэкранное окно на телефоне (`Modal` с `sheet`) появляется не рывком,
 * а вырастает из того, по чему нажали: шапка листа заливается фоном самой
 * кнопки — так, будто её подложка со всеми своими скруглениями выросла,
 * пока не накрыла шапку целиком.
 *
 * Считать это в CSS нечем: там неизвестно ни где стояла кнопка, ни какого
 * она была размера, цвета и скругления. Поэтому здесь снимается мерка и
 * уезжает в лист переменными CSS, а вся хореография остаётся в
 * `globals.css`.
 *
 * --- Два роста: в шапку и в страницу --------------------------------------
 *
 * Кнопка, стоявшая В ШАПКЕ (настройки), растёт в шапку и на её краях
 * останавливается: шапка листа встаёт на место шапки страницы, и рост
 * читается как «кнопка развернулась в полосу, где стояла». Дорасти при
 * этом до всего экрана она не может — тогда заливка проскочила бы шапку за
 * первые кадры, и от перехода осталась бы вспышка.
 *
 * Кнопка СО СТРАНИЦЫ (первый экран, клетка дня) растёт в страницу: из неё
 * вырастает весь лист, а шапка — верхняя полоса того же роста, просто
 * другого цвета. Останови такой рост на шапке — и человек увидел бы, как
 * полоса наверху заливается сама по себе, без всякой связи с тем местом,
 * куда он нажал.
 *
 * Обе полосы — шапка и остальной лист — растут ОДНОЙ фигурой в один и тот
 * же масштаб, поэтому шва между ними не бывает: это одна форма, крашенная
 * в два цвета.
 *
 * --- Почему мерка снимается в момент нажатия ------------------------------
 *
 * Ни одна из величин не известна заранее: кнопка настроек с 448 точек
 * обзаводится подписью и уезжает влево на её ширину, кнопка первого экрана
 * стоит посреди страницы, а день календаря — вообще где угодно и
 * размером в клетку. Замер после открытия невозможен: к этому времени лист
 * уже закрыл собой то, что нужно измерить.
 *
 * --- Почему масштаб считается, а не берётся с запасом ---------------------
 *
 * Скруглённый прямоугольник, растянутый в N раз, — это прямоугольник с
 * растянутым в N раз скруглением, и накрывает он не круг, а свою фигуру.
 * Взять «побольше» нельзя в обе стороны: мало — и в углу шапки останется
 * непокрашенный уголок, много — и заливка проскакивает шапку за первые
 * кадры, а дальше растёт вхолостую.
 *
 * Поэтому масштаб ищется точно: наименьший, при котором фигура накрывает
 * все четыре угла шапки. Ищется перебором пополам, а не формулой, — у
 * скруглённого прямоугольника условие покрытия кусочное, и формула
 * распалась бы на четыре случая с делением на ноль в двух из них.
 */

/**
 * Высота шапки листа.
 *
 * Та же, что у шапки страницы, и задана она классом `max-sm:h-16` в
 * `Modal`. Число здесь — то же самое число: заливке нужно знать, что
 * накрывать, а прочитать это с ещё не открытого окна нельзя.
 */
const BAR_HEIGHT = 64;

/** Запас поверх точного покрытия: гасит шов в полпикселя по краю. */
const MARGIN = 1.02;

/** Куда растёт заливка: до краёв шапки или до краёв экрана. */
export type SheetGrowth = "bar" | "page";

export interface SheetOrigin {
  growth: SheetGrowth;
  style: CSSProperties;
}

/**
 * Мерка с кнопки, из которой растёт лист. `undefined` — если мерить
 * нечего: тогда лист откроется заливкой во всю шапку, без роста.
 */
export function sheetOrigin(
  from: HTMLElement | null | undefined,
): SheetOrigin | undefined {
  if (!from) return undefined;

  const rect = from.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return undefined;

  const style = getComputedStyle(from);
  const radius = radiusOf(style.borderTopLeftRadius, rect);

  // Начавшееся в полосе шапки там же и кончается. Граница по ВЕРХУ кнопки,
  // а не по её середине: кнопка шапки целиком лежит в этой полосе, а всё,
  // что начинается ниже, к шапке уже не относится.
  const growth: SheetGrowth = rect.top < BAR_HEIGHT ? "bar" : "page";

  // Шапка листа стоит в левом верхнем углу экрана, поэтому мерка с экрана
  // ложится в неё как есть, без пересчёта координат.
  const area =
    growth === "bar"
      ? { width: window.innerWidth, height: BAR_HEIGHT }
      : { width: window.innerWidth, height: window.innerHeight };

  return {
    growth,
    style: {
      "--sheet-fill-x": `${round(rect.left)}px`,
      "--sheet-fill-y": `${round(rect.top)}px`,
      "--sheet-fill-w": `${round(rect.width)}px`,
      "--sheet-fill-h": `${round(rect.height)}px`,
      "--sheet-fill-r": `${round(radius)}px`,
      "--sheet-fill-scale": round(coverScale(rect, radius, area) * MARGIN, 3),
      // Цвет — тот, что человек видел под пальцем. Прозрачную подложку
      // (у дня календаря она бывает такой) подменяет цвет шапки: иначе
      // заливка началась бы с пустого места.
      "--sheet-fill-tint": opaque(style.backgroundColor)
        ? style.backgroundColor
        : "var(--color-paper-raised)",
    } as CSSProperties,
  };
}

/**
 * Во сколько раз растянуть фигуру, чтобы она накрыла область.
 *
 * Достаточно проверить четыре угла: фигура выпуклая, и накрыв углы, она
 * накрывает и всё между ними.
 */
function coverScale(
  from: DOMRect,
  radius: number,
  area: { width: number; height: number },
): number {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const hw = from.width / 2;
  const hh = from.height / 2;
  const r = Math.min(radius, hw, hh);

  const corners: readonly (readonly [number, number])[] = [
    [0, 0],
    [area.width, 0],
    [0, area.height],
    [area.width, area.height],
  ];

  let scale = 1;
  for (const [x, y] of corners) {
    scale = Math.max(scale, reach(Math.abs(x - cx), Math.abs(y - cy), hw, hh, r));
  }
  return scale;
}

/**
 * Наименьший масштаб, при котором точка (dx, dy) от центра оказывается
 * внутри фигуры.
 *
 * Внутрь фигура растёт равномерно, поэтому «накрыто или нет» с ростом
 * масштаба меняется один раз и в одну сторону — перебор пополам сходится к
 * границе. Верхняя граница взята с запасом: фигура заведомо содержит
 * вписанный круг радиусом `min(hw, hh)`, значит такого масштаба хватает
 * любой точке.
 */
function reach(dx: number, dy: number, hw: number, hh: number, r: number): number {
  const inside = (s: number) => {
    const ax = Math.max(0, dx - s * (hw - r));
    const ay = Math.max(0, dy - s * (hh - r));
    return ax * ax + ay * ay <= s * r * (s * r);
  };

  let low = 1;
  let high = Math.max(1, Math.hypot(dx, dy) / Math.min(hw, hh));
  if (inside(low)) return low;

  for (let step = 0; step < 30; step += 1) {
    const middle = (low + high) / 2;
    if (inside(middle)) high = middle;
    else low = middle;
  }
  return high;
}

/**
 * Скругление кнопки в точках.
 *
 * Браузер отдаёт длину в точках, но `50%` возвращает процентами как есть —
 * такое скругление означает «до предела», то есть половину меньшей
 * стороны.
 */
function radiusOf(value: string, rect: DOMRect): number {
  if (value.endsWith("%")) {
    return (Number.parseFloat(value) / 100) * Math.min(rect.width, rect.height);
  }
  const px = Number.parseFloat(value);
  return Number.isFinite(px) ? px : 0;
}

/** Есть ли у цвета непрозрачность. Браузер отдаёт прозрачное как `rgba(…, 0)`. */
function opaque(color: string): boolean {
  const alpha = /^rgba?\([^)]*[,/]\s*([\d.]+)\s*\)$/.exec(color)?.[1];
  return alpha === undefined ? color !== "transparent" : Number.parseFloat(alpha) > 0;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
