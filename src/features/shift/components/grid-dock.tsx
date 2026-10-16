"use client";

import type { ReactNode } from "react";

import { MARK_EMPTY_CLASS } from "@/components/shared/header-action";
import { KNOB, KNOB_ICON, KNOB_NEST, KnobLabel } from "@/components/ui/knob";
import { ThemeCorner } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils/cn";

import type { StoredProfile } from "../storage/profile";
import { CalendarIcon, ShiftsIcon } from "./grid-icons";
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
 * С `md` — левая группа собирается в одну кучку у левого края, вслед за
 * легендой, а тема остаётся в правом углу. Знаки левой группы показывают
 * имя при наведении: подпись выезжает справа и раздвигает соседей
 * (`ui/knob.tsx`). У темы подписи нет — она одна в своём углу и ничего не
 * раздвигает.
 *
 * --- Почему выбранное видно цветом, а не плашкой ---------------------------
 *
 * Плашек в ряду нет, и показанную сетку отмечает цвет значка: выбранная —
 * чернилами, как «ГРАФИК» в знаке сайта, другая — тусклым серым пустых
 * клеток того же знака (`MARK_EMPTY`). Так же «Онлайн»: включённый — зелёные
 * волны, выключенный — серая точка. Для программы чтения то же сказано
 * словами (`aria-pressed`, `role="switch"`).
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
  // `dock` — бумага под рядом на телефоне (`globals.css`).
  "dock pointer-events-none fixed inset-x-0 z-90 flex items-center justify-between px-6",
  "bottom-[calc(1.5rem+var(--safe-bottom))]",
);

/**
 * Левая группа: на телефоне — раскрыта в общий ряд, чтобы просветы между
 * всеми шестью знаками были равны; с `md` — одной кучкой у левого края.
 */
export const DOCK_LEFT = "max-md:contents md:flex md:items-center";

/** Цвет выбранного значка — чернила названия сайта (`HEADER_WORD`). */
export const KNOB_ON = "text-black/80 dark:text-ink";

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
    <div role="group" aria-label="Управление сеткой" className={DOCK}>
      <div className={DOCK_LEFT}>
        {/* Какая из двух легенд в окошке, решает показанная сетка: о
            графике смен и о производственном календаре клетки говорят
            разное. */}
        <LegendButton view={view} profile={profile} onChange={onChange} />

        <ViewKnob
          active={view === "shifts"}
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

      <ThemeCorner docked />
    </div>
  );
}

/** Знак одной из двух сеток. */
function ViewKnob({
  active,
  onClick,
  name,
  caption,
  children,
}: {
  active: boolean;
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
            active ? KNOB_ON : MARK_EMPTY_CLASS,
          )}
        >
          {children}
        </span>
        <KnobLabel>{caption}</KnobLabel>
      </button>
    </div>
  );
}
