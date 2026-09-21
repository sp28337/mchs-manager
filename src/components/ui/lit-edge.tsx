"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Откуда светить: точка курсора внутри блока.
 *
 * Сама кайма — в таблице стилей, рядом с лампой и её бликами
 * (`globals.css`, `.lit-edge`): это её свет, и жить ему при ней. Здесь
 * только мелочь, которая нужна разметке, — сообщить кайме, где сейчас
 * указатель.
 *
 * Пишется прямо в стиль узла, а не в состояние React: величину читает
 * только градиент, в отрисовке она не участвует, и гонять из-за движения
 * мыши перерисовку было бы дорого ровно настолько, насколько это заметно.
 */
export function trackGlow(event: ReactPointerEvent<HTMLElement>): void {
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--glow-x", `${event.clientX - box.left}px`);
  event.currentTarget.style.setProperty("--glow-y", `${event.clientY - box.top}px`);
}
