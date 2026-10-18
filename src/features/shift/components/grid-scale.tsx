"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
 * Пределы и довод целиком — в `year-view.tsx`: от одного до шести столбцов,
 * а реальный верх задаёт ширина колонки. Месяц крупнее трёх в ряд не
 * показывается: `ZOOM_MIN` — самая крупная ступень лупы.
 *
 * Столбцов бывает от одного (`MONTHS_MIN`), а размер месяца — от трёх в ряд
 * (`ZOOM_MIN`): один столбец на широком экране не занимает всю рамку, а
 * стоит по середине месяцем такой же ширины, как при трёх в ряду. Две ступени
 * крупнее трёх — два месяца в ряд — были слишком широки: клетка там
 * превращалась в плиту.
 */
export const MONTHS_MIN = 1;
export const MONTHS_CAP = 6;
export const ZOOM_MIN = 3;

/**
 * Раскладка у человека, который её ещё не трогал: три столбца, а месяц — на
 * ступень мельче самой крупной (`ZOOM_MIN` + 1, то есть четыре месяца в ширину).
 * Выбранные столбцы закреплены, как если бы он выбрал их сам, а сетка стоит по
 * середине рамки, не растянутая на неё.
 *
 * Те же числа записаны в `globals.css` (`.year-room` с `lg`): заглушка рабочего
 * экрана, где скрипта нет, обязана встать той же раскладкой, какой её увидят через
 * мгновение. Менять — в обоих местах. Ниже `lg` число задаёт `globals.css`:
 * кнопок масштаба там нет, и менять его некому.
 */
export const DEFAULT_MONTHS = ZOOM_MIN + 1;
export const DEFAULT_COLUMNS = 3;

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

/**
 * Что запоминается между открытиями: желание человека, а не то, что вышло на
 * экране. Размер окна на другом устройстве другой, и «шесть столбцов» там
 * сожмутся до того, что влезает (`most`), — а когда окно расширят, вернутся.
 *
 * Хранится в браузере, отдельно от графика: это вкус к раскладке, а не часть
 * расчёта, и в файл с графиком и на сервер он не уезжает.
 */
const STORAGE_KEY = "shift-schedule.grid-scale";

interface Saved {
  asked: number;
  pinned: number | null;
  compact: boolean;
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= MONTHS_MIN && value <= MONTHS_CAP;

/** Сохранённое или `null`; испорченное и чужое отбрасывается целиком. */
function readSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return null;
    const { asked, pinned, compact } = data as Record<string, unknown>;
    if (!isCount(asked) || typeof compact !== "boolean") return null;
    if (pinned !== null && !isCount(pinned)) return null;
    return { asked, pinned, compact };
  } catch {
    return null;
  }
}

function writeSaved(saved: Saved) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Хранилище закрыто или полно — раскладка просто не запомнится.
  }
}

export function GridScaleProvider({ children }: { children: ReactNode }) {
  // Рабочий экран открывается только после чтения профиля, то есть уже в
  // браузере, и читать хранилище при первой отрисовке можно без расхождения
  // с разметкой, собранной на сервере.
  const [saved] = useState(readSaved);
  const [asked, setAsked] = useState(saved?.asked ?? DEFAULT_MONTHS);
  // Сохранённое «Авто» (`null`) — выбор человека и умолчанием не затирается.
  const [pinned, setPinned] = useState<number | null>(
    saved === null ? DEFAULT_COLUMNS : saved.pinned,
  );
  const [compact, setCompact] = useState(saved?.compact ?? false);
  const [limits, setLimits] = useState<GridLimits>({
    months: DEFAULT_MONTHS,
    columns: DEFAULT_COLUMNS,
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

  // Первый проход пропускается: пока человек ничего не менял, писать нечего.
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) {
      touched.current = true;
      return;
    }
    writeSaved({ asked, pinned, compact });
  }, [asked, pinned, compact]);

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
