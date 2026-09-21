"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Свет по кромке блока — со стороны курсора.
 *
 * --- Почему не заливка ------------------------------------------------------
 *
 * Заливка под курсором — приём из интерфейсов без источника света: она
 * ничего не объясняет, просто помечает «тут указатель». Здесь источник
 * есть, он висит под шапкой (`shared/lamp.tsx`), и весь вид блоков —
 * следствие его. Блок, который ТЕМНЕЕТ, когда на него посветили, читался
 * бы как чужая деталь.
 *
 * --- Что здесь, а что в таблице стилей --------------------------------------
 *
 * Само свечение — в `globals.css`, рядом с лампой и её бликами: это её
 * свет, и жить ему при ней. Здесь — две мелочи, которые нужны разметке:
 * прослойка, куда этот свет ложится, и обработчик, сообщающий ей, где
 * сейчас курсор.
 *
 * Положение пишется прямо в стиль узла, а не в состояние React: величину
 * читает только градиент, в отрисовке она не участвует, и гонять из-за
 * движения мыши перерисовку было бы дорого ровно настолько, насколько это
 * заметно.
 */
export function trackGlow(event: ReactPointerEvent<HTMLElement>): void {
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--glow-x", `${event.clientX - box.left}px`);
  event.currentTarget.style.setProperty("--glow-y", `${event.clientY - box.top}px`);
}

/**
 * Сама прослойка света. Ставится ПЕРВОЙ внутри блока с классом `lit-edge`.
 *
 * Лежит слоем под блоком и выходит из-под него на пару точек, поэтому от
 * пятна остаётся одна кромка. Форму берёт ту же, что и блок над ней:
 * скругление — классом, вырезанное очертание (папка) — `style`.
 */
export function LitEdgeGlow({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span aria-hidden className={cn("lit-edge__glow", className)} style={style} />
  );
}
