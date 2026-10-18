"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Масштаб и раскладка сетки месяцев — общие для сетки и для знаков у кромки.
 *
 * --- Почему не внутри `YearView` ------------------------------------------
 *
 * Кнопки масштаба и «компактно» стояли над сеткой, и состояние жило в ней же.
 * Теперь они — знаки правого нижнего угла, над знаком темы (`grid-dock.tsx`),
 * то есть в другом месте дерева: сетка в разделе, знаки у кромки окна, вне
 * него (причина — закрепление, она разобрана в `workspace.tsx`). Общего
 * предка у них один — рабочий экран, и состояние живёт там.
 *
 * Побочная выгода: масштаб больше не сбрасывается, когда человек заходит в
 * настройки и возвращается. Сетка при этом перемонтировалась и открывалась
 * на четырёх месяцах в ряду, как будто ничего не выбирали.
 *
 * --- Что хранится ---------------------------------------------------------
 *
 * Желание человека — `asked` (сколько месяцев в ряду он просил), `pinned`
 * (сколько столбцов выбрал из списка) и `compact` — и то, что из этого вышло
 * на самом деле: `months`, `columns` и `most`. Вторые считает сетка по замеру
 * колонки — сколько влезает, — и сообщает сюда. Знакам они нужны, чтобы
 * погасить кнопку, которой дальше некуда: «мельче» на пределе ширины,
 * «крупнее» на двух месяцах или на выбранном числе столбцов.
 *
 * --- Два числа, а не одно ---------------------------------------------------
 *
 * Пока человек столбцы не выбирал, их ровно столько, сколько месяцев в ряду, —
 * это одно число, и лупы двигают его. Выбрав число из списка, он называет
 * СТОЛБЦЫ, и они закрепляются: лупы больше не меняют их, а меняют только
 * размер месяца. Крупнее некуда, когда выбранные столбцы заняли всю рамку;
 * мельче — сетка сужается и стоит по середине, столбцов в ней столько же.
 */

/**
 * Масштаб — ЧИСЛО МЕСЯЦЕВ В РЯДУ.
 *
 * Пределы и довод целиком — в `year-view.tsx`: два месяца снизу (один на
 * колонку — уже не год), восемь сверху, а реальный верх задаёт ширина
 * колонки.
 */
export const MONTHS_MIN = 2;
export const MONTHS_CAP = 8;

/**
 * Сколько месяцев в ряду при первом открытии широкого экрана — четыре.
 *
 * Столько же было и раньше: экран, открытый впервые, выглядит ровно так же,
 * как выглядел. Ниже `lg` число задаёт `globals.css`: кнопок масштаба там
 * нет, и менять его некому.
 */
export const DEFAULT_MONTHS = 4;

/**
 * Что сетка видит на самом деле: сколько месяцев в ширину (размер месяца),
 * сколько столбцов получилось и сколько влезло бы.
 *
 * Без выбранных столбцов `columns` равно `months`. С выбранными `months` не
 * меньше `columns`: месяц уже не стал бы больше, чем нужно, чтобы столбцы
 * заняли рамку.
 */
export interface GridLimits {
  months: number;
  columns: number;
  most: number;
}

interface GridScale extends GridLimits {
  asked: number;
  /** Столбцы, выбранные из списка; `null` — не выбирал, их ведёт масштаб. */
  pinned: number | null;
  /** Месяцы собраны в ровные ряды и стоят по середине рамки. */
  compact: boolean;
  setAsked: (asked: number) => void;
  /**
   * Закрепить число столбцов (`null` — снова вести их масштабом).
   *
   * Месяц при этом встаёт во всю рамку: сетка с выбранным числом столбцов
   * сперва занимает её целиком, а мельчить её дальше — дело лупы.
   */
  setColumns: (columns: number | null) => void;
  setCompact: (compact: boolean) => void;
  /** Сетка сообщает, во что упёрся масштаб; больше этого никто не зовёт. */
  report: (limits: GridLimits) => void;
}

const GridScaleContext = createContext<GridScale | null>(null);

export function GridScaleProvider({ children }: { children: ReactNode }) {
  const [asked, setAsked] = useState(DEFAULT_MONTHS);
  const [pinned, setPinned] = useState<number | null>(null);
  const [compact, setCompact] = useState(false);
  const [limits, setLimits] = useState<GridLimits>({
    months: DEFAULT_MONTHS,
    columns: DEFAULT_MONTHS,
    most: MONTHS_CAP,
  });

  // Одинаковый ответ сетки не должен перерисовывать всё, что на него
  // подписано: сообщает она после каждой отрисовки, а меняется он редко.
  const report = useCallback((next: GridLimits) => {
    setLimits((previous) =>
      previous.months === next.months &&
      previous.columns === next.columns &&
      previous.most === next.most
        ? previous
        : next,
    );
  }, []);

  // Выбор столбцов ставит и размер: месяц — во всю рамку на этом числе. А
  // «снова вести масштабом» оставляет то, что человек видит сейчас: число
  // месяцев в ряду становится равным столбцам, которые были, — сетка не
  // прыгает.
  const setColumns = useCallback(
    (next: number | null) => {
      setPinned(next);
      setAsked(next ?? limits.columns);
    },
    [limits.columns],
  );

  const value = useMemo<GridScale>(
    () => ({ asked, pinned, compact, ...limits, setAsked, setColumns, setCompact, report }),
    [asked, pinned, compact, limits, report, setColumns],
  );

  return <GridScaleContext.Provider value={value}>{children}</GridScaleContext.Provider>;
}

export function useGridScale(): GridScale {
  const scale = useContext(GridScaleContext);
  if (scale === null) {
    throw new Error("useGridScale вне GridScaleProvider: масштаб живёт на рабочем экране");
  }
  return scale;
}
