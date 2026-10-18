import { datesOfMonth, weekday } from "@/features/shift/domain/plain-date";

/**
 * Волна сборки на первом экране: место каждой клетки в ней.
 *
 * --- Что это за числа ---------------------------------------------------------
 *
 * Месяцы приходят из глубины наружу, клетка за клеткой, и задержка у каждой
 * своя. Вычислить её можно только там, где известно место клетки в ВСЕЙ
 * плоскости, а не в своём месяце: четыре месяца собираются одной волной, а не
 * четырьмя по очереди. Сюда приходят места, отсюда уходят два числа на клетку
 * (`--ix`, `--iy`), а во что они превратятся, решает `globals.css`.
 *
 * Волна — это диагональ. По ширине клетка стоит вдвое дальше от соседней, чем
 * по высоте, поэтому фронт идёт наискось, а не вертикалью: `x = 2·столбец +
 * строка` на широком экране, где глубина слева, и `y = 2·(строк − строка) +
 * столбец` на узком, где глубина внизу.
 *
 * --- Почему отдельным файлом ---------------------------------------------------
 *
 * Последний номер волны нужен не только раскладке. От него зависит, когда
 * сборка закончена, — а от этого, когда можно начинать историю
 * (`hero-scenario.ts`): отметка, легшая на ещё не собравшуюся сетку, видна не
 * будет. Считать его в двух местах значило бы однажды получить два разных.
 */

/** Месяцы первого экрана, слева направо и сверху вниз: июль — октябрь. */
export const HERO_MONTHS = [7, 8, 9, 10] as const;

/** Год записан числом: страница собирается заранее и раздаётся статикой. */
export const HERO_YEAR = 2028;

/** Месяцев в строке плоскости. */
const PER_ROW = 2;

/** Столбцов на месяц: семь дней недели и просвет до соседнего. */
const BLOCK_COLUMNS = 8;

/** Строк на месяц: шапка, буквы дней недели и до шести недель. */
const BLOCK_ROWS = 8;

/** Строк во всей плоскости. */
const TOTAL_ROWS = BLOCK_ROWS * Math.ceil(HERO_MONTHS.length / PER_ROW);

export interface WavePlace {
  "--ix": number;
  "--iy": number;
}

function place(column: number, row: number): { x: number; y: number } {
  return { x: column * 2 + row, y: (TOTAL_ROWS - 1 - row) * 2 + column };
}

/** Левый верхний угол месяца в плоскости: столбец и строка. */
function origin(month: number): { column: number; row: number } {
  return {
    column: (month % PER_ROW) * BLOCK_COLUMNS,
    row: Math.floor(month / PER_ROW) * BLOCK_ROWS,
  };
}

/** Клетка месяца по её месту в сетке из семи столбцов (`slot` считается с пустых). */
export function cellWave(month: number, slot: number): WavePlace {
  const start = origin(month);
  const { x, y } = place(start.column + (slot % 7), start.row + 2 + Math.floor(slot / 7));
  return { "--ix": x, "--iy": y };
}

/**
 * Буква дня недели: строка над неделями, а по ширине — со своим столбцом.
 *
 * `x + 1`: буква приходит чуть позже клетки соседней строки и не выскакивает
 * раньше её столбца. По высоте строка недели выше первой и потому приходит
 * последней — у ближнего края.
 */
export function letterWave(month: number, column: number): WavePlace {
  const start = origin(month);
  const { x, y } = place(start.column + column, start.row + 1);
  return { "--ix": x + 1, "--iy": y };
}

/** Шапка месяца — название и итоги: над всем, поэтому приходит последней. */
export function headWave(month: number): WavePlace {
  const start = origin(month);
  const { x, y } = place(start.column + 3, start.row);
  return { "--ix": x + 1, "--iy": y };
}

/**
 * Номер последней клетки волны — по нему отсчитываются и числа над сеткой, и
 * начало истории.
 *
 * Из всех порядков берётся самый долгий: на широком экране последней
 * приходит правая нижняя клетка или буква, на узком — буква или шапка у
 * ближнего края.
 */
export const HERO_LAST_WAVE: number = (() => {
  let last = 0;
  const note = (at: WavePlace) => {
    last = Math.max(last, at["--ix"], at["--iy"]);
  };
  HERO_MONTHS.forEach((_, month) => {
    const first = datesOfMonth(HERO_YEAR, HERO_MONTHS[month]!)[0]!;
    const days = datesOfMonth(HERO_YEAR, HERO_MONTHS[month]!).length;
    const offset = weekday(first);
    const slots = Math.ceil((offset + days) / 7) * 7;
    for (let slot = 0; slot < slots; slot += 1) note(cellWave(month, slot));
    for (let column = 0; column < 7; column += 1) note(letterWave(month, column));
    note(headWave(month));
  });
  return last;
})();
