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
 * Желание человека — `asked` (сколько месяцев в ряду он просил) и `compact`
 * — и то, что из этого вышло на самом деле: `months` и `most`. Вторые считает
 * сетка по замеру колонки — сколько влезает, — и сообщает сюда. Знакам они
 * нужны, чтобы погасить кнопку, которой дальше некуда: «мельче» на пределе
 * ширины, «крупнее» на двух месяцах.
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

/** Что сетка видит на самом деле: сколько месяцев в ряду и сколько влезло бы. */
export interface GridLimits {
  months: number;
  most: number;
}

interface GridScale extends GridLimits {
  asked: number;
  /** Месяцы собраны в ровные ряды и стоят по середине рамки. */
  compact: boolean;
  setAsked: (asked: number) => void;
  setCompact: (compact: boolean) => void;
  /** Сетка сообщает, во что упёрся масштаб; больше этого никто не зовёт. */
  report: (limits: GridLimits) => void;
}

const GridScaleContext = createContext<GridScale | null>(null);

export function GridScaleProvider({ children }: { children: ReactNode }) {
  const [asked, setAsked] = useState(DEFAULT_MONTHS);
  const [compact, setCompact] = useState(false);
  const [limits, setLimits] = useState<GridLimits>({
    months: DEFAULT_MONTHS,
    most: MONTHS_CAP,
  });

  // Одинаковый ответ сетки не должен перерисовывать всё, что на него
  // подписано: сообщает она после каждой отрисовки, а меняется он редко.
  const report = useCallback((next: GridLimits) => {
    setLimits((previous) =>
      previous.months === next.months && previous.most === next.most ? previous : next,
    );
  }, []);

  const value = useMemo<GridScale>(
    () => ({ asked, compact, ...limits, setAsked, setCompact, report }),
    [asked, compact, limits, report],
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
