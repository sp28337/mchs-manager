"use client";

import { useEffect, useId, useRef, useState } from "react";

import { LegendMark } from "@/components/shared/header-action";
import { cn } from "@/lib/utils/cn";

import { ShiftLegend } from "./shift-strip";

/**
 * Легенда — кнопкой в левом нижнем углу рабочего экрана.
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
 * --- Почему в левом нижнем углу --------------------------------------------
 *
 * Правый верхний занят меню, правый нижний на телефоне — панелью сеток
 * (`grid-deck.tsx`). Левый нижний — единственный свободный угол, и он же
 * ближайший к сеткам, о которых легенда и рассказывает.
 *
 * Над панелью, а не под ней: на телефоне панель закреплена у самой кромки
 * окна, и кнопка, поставленная туда же, легла бы ей на ячейку «График».
 *
 * --- Почему окошко раскрывается вверх --------------------------------------
 *
 * Кнопка стоит у нижней кромки, и место под ней кончается. Раскрытое вниз
 * окошко уехало бы за экран целиком.
 */
export function LegendButton({ className }: { className?: string }) {
  const [открыто, setОткрыто] = useState(false);
  const гнездо = useRef<HTMLDivElement>(null);
  const id = useId();

  // Закрывается всеми способами, какими обязано: `Esc`, нажатие мимо, уход
  // фокуса. Те же три, что у меню в шапке (`shared/header-menu.tsx`).
  useEffect(() => {
    if (!открыто) return;

    const закрыть = () => setОткрыто(false);
    const мимо = (событие: PointerEvent) => {
      if (!гнездо.current?.contains(событие.target as Node)) закрыть();
    };
    const клавиша = (событие: KeyboardEvent) => {
      if (событие.key === "Escape") закрыть();
    };
    const фокус = (событие: FocusEvent) => {
      if (!гнездо.current?.contains(событие.target as Node)) закрыть();
    };

    document.addEventListener("pointerdown", мимо);
    document.addEventListener("keydown", клавиша);
    document.addEventListener("focusin", фокус);

    return () => {
      document.removeEventListener("pointerdown", мимо);
      document.removeEventListener("keydown", клавиша);
      document.removeEventListener("focusin", фокус);
    };
  }, [открыто]);

  return (
    <div
      ref={гнездо}
      className={cn(
        // Отсчёт от безопасной зоны телефона — той же, от которой считает
        // себя панель сеток: без неё кнопка на телефоне с вырезом внизу
        // оказалась бы под системной полосой.
        "fixed left-6 z-90 bottom-[calc(5.5rem+var(--safe-bottom))]",
        "md:bottom-[calc(1.5rem+var(--safe-bottom))]",
        className,
      )}
    >
      {открыто && (
        <div
          id={id}
          role="group"
          aria-label="Легенда графика"
          className={cn(
            "modal-lift absolute bottom-full left-0 mb-2 w-72 max-w-[calc(100vw-3rem)]",
            "max-h-[70svh] overflow-y-auto rounded-xl bg-paper-raised p-4",
          )}
        >
          <ShiftLegend />
        </div>
      )}

      <button
        type="button"
        onClick={() => setОткрыто((было) => !было)}
        aria-expanded={открыто}
        aria-controls={id}
        aria-label="Легенда: чем помечены клетки"
        title="Легенда"
        className={cn(
          // Плашка здесь нужна — в отличие от надписей в шапке: кнопка
          // лежит поверх сеток, и без своей поверхности она читалась бы
          // как часть календаря под ней.
          "lit grid size-11 cursor-pointer place-items-center rounded-xl bg-paper-raised",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        )}
      >
        <LegendMark />
      </button>
    </div>
  );
}
