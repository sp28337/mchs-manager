"use client";

import { useId, useRef, useState } from "react";

import { LegendMark } from "@/components/shared/header-action";
import { KNOB, KNOB_ICON, KNOB_NEST, KNOB_POPOVER, KnobLabel } from "@/components/ui/knob";
import { useDismiss } from "@/components/ui/use-dismiss";
import { cn } from "@/lib/utils/cn";

import type { StoredProfile } from "../storage/profile";
import { ShiftLegend } from "./shift-strip";
import { CalendarLegend } from "./year-calendar-editor";
import type { YearViewKind } from "./year-view";

/**
 * Легенда — первым знаком нижнего ряда (`grid-dock.tsx`).
 *
 * --- Почему кнопка, а не колонка -------------------------------------------
 *
 * Легенда стояла колонкой слева от сеток и была двумя разными вещами на
 * двух экранах. На мониторе — полезной, но дорогой: семнадцать рем
 * ширины, отнятые у года из двенадцати сеток. На телефоне — почти
 * бесполезной: там она оказывалась ПОД всеми сетками, то есть за тремя
 * экранами прокрутки от той клетки, значение которой человек хотел
 * узнать.
 *
 * Кнопка решает оба случая разом: легенда в одном нажатии с любого места
 * года и не занимает ничего, пока её не спросили.
 *
 * --- Почему в нижнем ряду, первой ----------------------------------------
 *
 * Правый верхний угол занят меню, а нижний ряд — органами управления
 * сеткой: что показать, за какой год, по сегодня ли. Легенда рассказывает
 * о той же сетке и стоит с ними одним рядом — первой, у левого края, где
 * стояла и раньше одна.
 *
 * --- Почему окошко раскрывается вверх --------------------------------------
 *
 * Кнопка стоит у нижней кромки, и место под ней кончается. Раскрытое вниз
 * окошко уехало бы за экран целиком. С `md` знаки стоят колонкой, а легенда
 * в ней — нижняя: вверх окошко легло бы на остальные знаки, поэтому там оно
 * раскрывается вправо от кнопки (`KNOB_POPOVER`).
 *
 * --- Почему легенда зависит от сетки ---------------------------------------
 *
 * На месте года по очереди стоят две разные сетки — график смен и
 * производственный календарь, — и размечены они по-разному: в одной клетка
 * говорит о смене, в другой о виде дня по закону. Одна кнопка на обе и
 * показывает ту легенду, которая поясняет то, что человек видит прямо
 * сейчас. Обе разом означали бы перечень из двух с лишним десятков
 * значков, половина которых на экране не встречается.
 */
export function LegendButton({
  view,
  profile,
  onChange,
}: {
  /** Показанная сетка: она же решает, какая легенда в окошке. */
  view: YearViewKind;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
}) {
  const [открыто, setОткрыто] = useState(false);
  const гнездо = useRef<HTMLDivElement>(null);
  const id = useId();
  const календарь = view === "calendar";
  useDismiss(открыто, setОткрыто, гнездо);

  return (
    <div ref={гнездо} className={KNOB_NEST}>
      {открыто && (
        <div
          id={id}
          role="group"
          aria-label={
            календарь ? "Легенда производственного календаря" : "Легенда графика"
          }
          className={cn(KNOB_POPOVER, "left-0 w-72 max-h-[70svh] p-4")}
        >
          {календарь ? (
            <CalendarLegend profile={profile} onChange={onChange} />
          ) : (
            <ShiftLegend />
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setОткрыто(!открыто)}
        aria-expanded={открыто}
        aria-controls={id}
        aria-label={
          календарь
            ? "Легенда: чем помечены дни календаря"
            : "Легенда: чем помечены клетки графика"
        }
        className={KNOB}
      >
        <span className={KNOB_ICON}>
          <LegendMark />
        </span>
        <KnobLabel>Легенда</KnobLabel>
      </button>
    </div>
  );
}
