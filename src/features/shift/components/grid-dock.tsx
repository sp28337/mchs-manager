"use client";

import { Check, Columns3, Expand, Shrink, ZoomIn, ZoomOut } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";

import { MARK_EMPTY_CLASS } from "@/components/shared/header-action";
import { KNOB, KNOB_ICON, KNOB_NEST, KnobLabel, knobOption } from "@/components/ui/knob";
import { MENU_LIST } from "@/components/ui/menu-row";
import { ThemeCorner } from "@/components/ui/theme-toggle";
import { useDismiss } from "@/components/ui/use-dismiss";
import { cn } from "@/lib/utils/cn";

import { numberWord } from "../domain/decimal";
import type { StoredProfile } from "../storage/profile";
import { CalendarIcon, ShiftsIcon } from "./grid-icons";
import { MONTHS_MIN, ZOOM_MIN, useGridScale } from "./grid-scale";
import { LegendButton } from "./legend-button";
import { LiveModeKnob } from "./live-mode";
import { YearPicker } from "./period-picker";
import type { YearViewKind } from "./year-view";

/**
 * Нижний ряд знаков: легенда, график, календарь, год, «Онлайн» и тема.
 *
 * --- Почему один ряд, а не панель и два угла -------------------------------
 *
 * Было три места: легенда в левом нижнем углу, тема в правом, а между ними
 * на телефоне — панель с ячейками «График», «Календарь», период и
 * «Онлайн», над сеткой на широком экране — строка тех же кнопок. Знаки в
 * углах и ячейки панели стояли друг над другом двумя этажами и говорили
 * на двух языках: одни — значком без плашки, другие — плашкой с подписью.
 *
 * Теперь язык один — знак без плашки, как у легенды и темы, — и место
 * одно, у нижней кромки окна, под большим пальцем на телефоне и в
 * привычном углу на мониторе.
 *
 * --- Как ряд стоит на разных экранах ---------------------------------------
 *
 * На телефоне — все шесть знаков от края до края с равными просветами:
 * левая группа раскрыта в общий ряд (`contents`), и `justify-between`
 * делит место поровну между всеми.
 *
 * С `md` — левая группа становится КОЛОНКОЙ у левого края, легенда в ней
 * нижняя, а тема остаётся в правом углу. Колонка стоит в поле страницы,
 * которое освобождает суженная рамка графика (`.year-room` в
 * `globals.css`): знаки не лежат на клетках, как лежали в ряду. Поэтому
 * отступ рамки не меньше колонки — 3,5 рем против занятых ею 4,25 от края
 * окна. Подпись знака выезжает вбок на подложке цвета бумаги и никого не
 * раздвигает (`ui/knob.tsx`), окошки легенды и года раскрываются вправо от
 * знака, а не вверх, где стоят остальные знаки. У темы подпись выезжает
 * влево.
 *
 * --- Что стоит над знаком темы ---------------------------------------------
 *
 * С `lg` над ним стоят четыре знака сетки: «столбцы» (выбор числа месяцев в
 * ряду), «компактно» и два масштаба. Раньше
 * они были квадратными кнопками с плашкой в строке над месяцами — единственное
 * управление сеткой на другом языке, чем остальное. Теперь они такие же знаки,
 * как соседи: значок без плашки, подпись выезжает влево при наведении, цвет
 * пустых клеток знака сайта. Колонка растёт вверх от кромки, где стоит знак
 * темы, — так же, как левая от легенды.
 *
 * Ниже `lg` их нет вовсе: на телефоне месяц и так занимает экран, растить его
 * некуда, а мельчить — значит получить клетку, в которую не попасть пальцем.
 * Скрыты они стилями, а не условием в разметке: ряд общий с заглушкой
 * (`workspace-skeleton.tsx`), где скрипта нет.
 *
 * --- Почему выбранное видно цветом, а не плашкой ---------------------------
 *
 * Плашек в ряду нет, и показанную сетку отмечает цвет значка. У графика
 * загорается залитая клетка — зелёным, тем же, каким на сетке отмечены
 * смены (`verify`): знак сайта и показывает дежурные сутки залитой
 * клеткой. Календарь загорается целиком — приглушённой охрой
 * (`calendar-mark`): жёлтый у ряда свой, ни с одной отметкой сетки он не
 * спорит, а яркий жёлтый резал бы глаз сильнее любого соседа. Не
 * показанная сетка — тусклым серым пустых клеток знака сайта
 * (`MARK_EMPTY`). Так же «Онлайн»: включённый — зелёные волны, выключенный
 * — серая точка. Для программы чтения то же сказано словами
 * (`aria-pressed`, `role="switch"`).
 *
 * --- Почему ряд прозрачен для нажатий --------------------------------------
 *
 * Ряд — полоса во всю ширину окна поверх сетки. Ловили бы нажатия и
 * просветы между знаками — и клетки под ними перестали бы нажиматься.
 * Поэтому полоса `pointer-events-none`, а ловят только сами знаки
 * (`KNOB_NEST`).
 *
 * --- Почему внизу разметки -------------------------------------------------
 *
 * Ряд закреплён у кромки окна (`fixed`), и предки со сдвигом (`transform`)
 * увели бы его вместе со страницей: любой `transform` заводит потомкам
 * `position: fixed` свою систему отсчёта. Поэтому он рисуется последним в
 * разметке рабочего экрана, вне раздела с сеткой, — и встречается последним
 * же при обходе клавишей и чтении вслух.
 */

/** Место ряда: у нижней кромки, с теми же полями, что у страницы. */
export const DOCK = cn(
  // Без подложки и на телефоне: ряд стоит на общем растворении у нижней
  // кромки (`--veil-fade-bottom`), так же, как на широком экране.
  "pointer-events-none fixed inset-x-0 z-90 flex items-center justify-between px-6",
  // С `md` левая группа — колонка, и знак темы стоит у её нижнего конца, а
  // не посередине высоты: он прижат к той же кромке, что легенда.
  "md:items-end",
  "bottom-[calc(1.5rem+var(--safe-bottom))]",
);

/**
 * Левая группа: на телефоне — раскрыта в общий ряд, чтобы просветы между
 * всеми шестью знаками были равны; с `md` — колонкой у левого края, и
 * ЛЕГЕНДА В НЕЙ НИЖНЯЯ.
 *
 * `flex-col-reverse`, а не перестановка в разметке: порядок в разметке один
 * на все экраны (легенда, график, календарь, год, «Онлайн»), и на телефоне
 * он читается слева направо. Колонка с обратным порядком растёт вверх от
 * кромки окна, где стоит легенда, и ставит остальные знаки над ней в том же
 * порядке — ближе к кромке то, что раньше стояло левее.
 */
export const DOCK_LEFT = "max-md:contents md:flex md:flex-col-reverse md:items-start";

/**
 * Правая группа: до `lg` — один знак темы, как раньше; с `lg` — колонка,
 * в которой над темой стоят знаки масштаба. Колонка прижата к правому краю,
 * а её нижний конец — у кромки окна, где стоит тема: знаки масштаба идут в
 * разметке перед ней, и в колонке сверху вниз это «компактно», «крупнее»,
 * «мельче», тема.
 *
 * `-mr-2` — правый край значков встаёт там же, где правый край трёх полос
 * кнопки меню в шапке. Клетка знака — 44 точки, значок в ней — 28, и без
 * сдвига значки отступали бы от края окна на восемь точек больше, чем полосы
 * меню над ними: две колонки у одного края стояли бы не в одну линию. Тот же
 * сдвиг у знака темы без ряда (`ThemeCorner`), иначе тот прыгал бы при
 * открытии раздела.
 */
export const DOCK_RIGHT = "max-lg:contents lg:-mr-2 lg:flex lg:flex-col lg:items-end";

/**
 * Знаки масштаба — только с `lg`, ниже них нет (довод — в шапке файла).
 *
 * Между ними и темой пусто на одну клетку знака (`mb-11`, 44 точки), как если
 * бы между ними стоял ещё один, невидимый: тема — отдельное действие окна, а не
 * пятый знак масштаба, и сплошной столбик из пяти одинаковых читался бы как
 * один набор. Колонка под меню в шапке отступает от кнопки меню на столько же
 * (`HEADER_RAIL`).
 */
export const SCALE_KNOBS = "max-lg:hidden lg:mb-11 lg:flex lg:flex-col lg:items-end";

/**
 * Показанный график: значок чернилами названия сайта (`HEADER_WORD`), а
 * залитая клетка — зелёным смен. Клетка — первый прямоугольник знака
 * (`ui/logo.tsx`); заливка у неё атрибутом `currentColor`, и правило
 * таблицы стилей сильнее атрибута.
 */
export const SHIFTS_ON = "text-black/80 dark:text-ink [&_svg>rect:first-child]:fill-verify";

/** Показанный календарь: значок целиком приглушённой охрой. */
export const CALENDAR_ON = "text-calendar-mark";

export function GridDock({
  profile,
  onChange,
  view,
  onViewChange,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  view: YearViewKind;
  onViewChange: (view: YearViewKind) => void;
}) {
  return (
    // `data-dock` — примета для перечня видов у дня (`day-ring.tsx`): ряд
    // стоит над сеткой, и перечень на него не заходит.
    <div role="group" aria-label="Управление сеткой" data-dock className={DOCK}>
      <div className={DOCK_LEFT}>
        {/* Какая из двух легенд в окошке, решает показанная сетка: о
            графике смен и о производственном календаре клетки говорят
            разное. */}
        <LegendButton view={view} profile={profile} onChange={onChange} />

        <ViewKnob
          active={view === "shifts"}
          onClassName={SHIFTS_ON}
          onClick={() => onViewChange("shifts")}
          name="Показать график смен"
          caption="График"
        >
          {/* Поправки размера (`grid-icons.tsx`) выровнены по часам; в ряду
              мера — знак легенды той же клетки, что и знак сайта, и
              поправка здесь не нужна. */}
          <ShiftsIcon className="scale-100" />
        </ViewKnob>
        <ViewKnob
          active={view === "calendar"}
          onClassName={CALENDAR_ON}
          onClick={() => onViewChange("calendar")}
          name="Показать производственный календарь"
          caption="Календарь"
        >
          <CalendarIcon className="scale-100" />
        </ViewKnob>

        {/* Учётный год записывается прямо в профиль: человек, вернувшийся к
            прошлогоднему расчёту через день, найдёт его там же. */}
        <YearPicker
          accountingYear={profile.accountingYear}
          onAccountingYear={(accountingYear) =>
            onChange((previous) => ({ ...previous, accountingYear }))
          }
        />

        <LiveModeKnob profile={profile} onChange={onChange} />
      </div>

      <div className={DOCK_RIGHT}>
        <ScaleKnobs />
        <ThemeCorner docked />
      </div>
    </div>
  );
}

/**
 * «Месяц» или «месяца» — для программы чтения.
 *
 * Она произносит итог нажатия вслух, и «4 месяц в ряду» там слышно так же
 * отчётливо, как читалось бы на экране. Форм нужно две: пределы масштаба —
 * от двух до восьми, и «один месяц» в этот отрезок не попадает.
 */
function monthsWord(count: number): string {
  return count >= 5 ? "месяцев" : "месяца";
}

/**
 * Знаки сетки месяцев: «компактно» и два масштаба.
 *
 * Состояние общее с сеткой (`grid-scale.tsx`): знаки здесь, месяцы там.
 *
 * --- Что делает «компактно» -----------------------------------------------
 *
 * Масштаб задаёт размер месяца, а эта кнопка — как месяцы встают в ряды. По
 * ширине рамки ряд заполнен до края, и неполный остаток стоит по середине
 * отдельной строкой; компактно все ряды одной длины (шесть месяцев — два
 * ряда по три), и вся сетка — по середине рамки, не растянутая на неё.
 *
 * Кнопка называет действие, а не состояние: значок и подпись показывают,
 * что произойдёт при нажатии — собрать или растянуть.
 *
 * --- Почему нет подписи «Масштаб» ------------------------------------------
 *
 * Две лупы — со знаком плюс и со знаком минус — объясняют себя сами. Для
 * программы чтения подписи остались при самих кнопках, а итог нажатия
 * объявляется вслух: у ползунка это делал `aria-valuetext`, у пары кнопок
 * сказать о том, что изменилось, больше некому.
 *
 * Упёршись в предел, знак не исчезает, а остаётся на месте бледным:
 * пропавший сдвинул бы соседний под самым пальцем, а человеку нужно видеть,
 * что мельче уже некуда.
 */
function ScaleKnobs() {
  const { compact, pinned, months, columns, most, setAsked, setColumns, setCompact } =
    useGridScale();
  // Крупнее некуда: три месяца в ряду, а при выбранных столбцах — когда они
  // заняли рамку целиком (месяц больше не стал бы) или месяц дошёл до трёх в
  // ряду. Мельче некуда — на пределе ширины в обоих случаях.
  const smallest = Math.max(ZOOM_MIN, pinned === null ? 0 : columns);

  return (
    <div role="group" aria-label="Масштаб сетки" className={SCALE_KNOBS}>
      <ColumnsKnob columns={columns} pinned={pinned !== null} most={most} onPick={setColumns} />
      <ScaleKnob
        name={compact ? "Растянуть по ширине рамки" : "Собрать компактно: ровные ряды по середине"}
        caption={compact ? "Растянуть" : "Компактно"}
        onClick={() => setCompact(!compact)}
      >
        {compact ? <Expand aria-hidden /> : <Shrink aria-hidden />}
      </ScaleKnob>
      <ScaleKnob
        name={
          pinned === null
            ? "Крупнее: меньше месяцев в ряду"
            : "Крупнее: те же столбцы, месяцы больше"
        }
        caption="Крупнее"
        disabled={months <= smallest}
        onClick={() => setAsked(Math.max(smallest, months - 1))}
      >
        <ZoomIn aria-hidden />
      </ScaleKnob>
      <ScaleKnob
        name={
          pinned === null
            ? "Мельче: больше месяцев в ряду"
            : "Мельче: те же столбцы, месяцы меньше"
        }
        caption="Мельче"
        disabled={months >= most}
        onClick={() => setAsked(Math.min(most, months + 1))}
      >
        <ZoomOut aria-hidden />
      </ScaleKnob>
      <span aria-live="polite" className="sr-only">
        {columns} {monthsWord(columns)} в ряду
        {pinned !== null ? ", столбцы выбраны" : ""}
        {compact ? ", компактно" : ""}
      </span>
    </div>
  );
}

/**
 * Число столбцов — выбором из списка, а не шагами по одному.
 *
 * Две лупы меняют масштаб на одну ступень, и перейти от четырёх столбцов к
 * шести — два нажатия, а обратно — ещё два. Человек, который уже знает, сколько
 * месяцев хочет видеть в ряду, выбирает число прямо: открыл список, нажал.
 * Лупы остались: «чуть крупнее» нажимают, не думая о числе.
 *
 * «Столбец» здесь — месяц в ряду: сетка строится рядами месяцев. Выбранное
 * число ЗАКРЕПЛЯЕТСЯ (`pinned` в `grid-scale.tsx`): лупы после него меняют
 * размер месяцев, а не число столбцов. Первым пунктом — «Авто»: он снимает
 * закрепление, и столбцы снова ведёт масштаб, как до выбора. Выше `most`
 * список не идёт: больше месяцев, чем влезает в колонку, не показать, и
 * пункт, который ничего не сделает, только ввёл бы в заблуждение. Нижняя
 * граница — один: на широком экране он не занимает всю рамку, а стоит по
 * середине месяцем той же ширины, что при трёх в ряду (довод — в `year-view.tsx`).
 *
 * Окошко раскрывается ВЛЕВО от знака: знак стоит у правой кромки окна, и вправо
 * ему некуда. Выровнено оно по нижнему краю знака и растёт вверх — так же, как
 * окошки левой колонки растут от своих знаков.
 */
function ColumnsKnob({
  columns,
  pinned,
  most,
  onPick,
}: {
  columns: number;
  /** Число закреплено выбором; иначе столбцы ведёт масштаб. */
  pinned: boolean;
  most: number;
  onPick: (columns: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const nest = useRef<HTMLDivElement>(null);
  const id = useId();
  useDismiss(open, setOpen, nest);

  const choices = Array.from({ length: Math.max(0, most - MONTHS_MIN + 1) }, (_, at) => MONTHS_MIN + at);

  return (
    <div ref={nest} className={cn(KNOB_NEST, "justify-end")}>
      {open && (
        <div
          id={id}
          role="group"
          aria-label="Столбцов в ряду"
          className={cn(
            "lit modal-lift absolute bottom-0 right-13 w-44 max-h-[60svh] overflow-y-auto",
            "pop-in [--pop-origin:100%_100%] [--pop-x:6px]",
            "rounded-xl bg-paper-raised p-1.5",
            MENU_LIST,
          )}
        >
          <button
            type="button"
            aria-pressed={!pinned}
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className={knobOption(!pinned)}
          >
            Авто
            {!pinned ? <Check aria-hidden className="ml-auto text-ink" /> : null}
          </button>
          {choices.map((count) => {
            const active = pinned && count === columns;
            return (
              <button
                key={count}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onPick(count);
                  setOpen(false);
                }}
                className={knobOption(active)}
              >
                {count} {numberWord(count, "столбец", "столбца", "столбцов")}
                {active ? <Check aria-hidden className="ml-auto text-ink" /> : null}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Столбцов в ряду: ${columns}${pinned ? "" : " (авто)"}. Выбрать другое число`}
        className={KNOB}
      >
        <KnobLabel side="left">Столбцы</KnobLabel>
        <span className={cn(KNOB_ICON, MARK_EMPTY_CLASS)}>
          <Columns3 aria-hidden />
        </span>
      </button>
    </div>
  );
}

/** Знак масштаба: тот же, что у темы, — значок без плашки, подпись влево. */
function ScaleKnob({
  name,
  caption,
  disabled,
  onClick,
  children,
}: {
  name: string;
  caption: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className={cn(KNOB_NEST, "justify-end")}>
      <button
        type="button"
        aria-label={name}
        disabled={disabled}
        onClick={onClick}
        className={cn(KNOB, "disabled:pointer-events-none")}
      >
        <KnobLabel side="left">{caption}</KnobLabel>
        {/* Цвет — на самом значке, а не на кнопке: бледность
            (`MARK_EMPTY_CLASS`) — это прозрачность, и на кнопке она
            погасила бы заодно и выезжающую подпись. Упёршийся в предел знак
            бледнее обычного, но не исчезает. */}
        <span
          className={cn(
            KNOB_ICON,
            MARK_EMPTY_CLASS,
            "transition-opacity group-disabled/press:opacity-10",
          )}
        >
          {children}
        </span>
      </button>
    </div>
  );
}

/** Знак одной из двух сеток. */
function ViewKnob({
  active,
  onClassName,
  onClick,
  name,
  caption,
  children,
}: {
  active: boolean;
  /** Цвет значка, когда эта сетка показана. */
  onClassName: string;
  onClick: () => void;
  /** Имя для программы чтения — что сделает нажатие. */
  name: string;
  /** Подпись, выезжающая при наведении. */
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className={KNOB_NEST}>
      <button
        type="button"
        aria-pressed={active}
        aria-label={name}
        onClick={onClick}
        className={KNOB}
      >
        <span
          className={cn(
            KNOB_ICON,
            "transition-[color,opacity] duration-200",
            active ? onClassName : MARK_EMPTY_CLASS,
          )}
        >
          {children}
        </span>
        <KnobLabel>{caption}</KnobLabel>
      </button>
    </div>
  );
}
