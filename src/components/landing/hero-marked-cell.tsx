"use client";

import { cn } from "@/lib/utils/cn";

import type { HeroLayout } from "./hero-story";
import { useStoryEvent } from "./hero-story-store";

/**
 * Клетка первого экрана, на которую палец ставит запись.
 *
 * Остальные клетки месяца — статика из разметки (`Cell` в `hero-calendar.tsx`) и
 * на историю не смотрят; эта подписана на свою запись и ложится или гаснет вместе
 * с ней. Подписаны только клетки с отметками: на широкой раскладке их три с
 * лишним десятка, и клиентскими остаются они одни — месяцы не тянутся в бандл.
 *
 * --- Как отметка ложится ---------------------------------------------------------
 *
 * Клетка не подменяется, а НАКРЫВАЕТСЯ: разметка отдаётся статикой, и подменить
 * в ней содержимое нечем. Вид записи лежит сверху и проявляется, когда запись
 * `on`; а когда её убрали — `off` — гаснет. Состояние стоит на самой клетке
 * (`data-state`), а остальное делает таблица стилей: сутки ложатся друг за
 * другом по номеру в записи (`--k`) и шагу записи (`--stagger`), а гаснут разом.
 *
 * Под накладкой гаснет и сама клетка: накладка полупрозрачна (тихий тон — это
 * вполсилы тот же вид), и сквозь неё видны число и буква смены. «О» поверх «В» и
 * «8» читалась кашей из двух знаков в одной клетке; на графике клетка одна, и
 * знак в ней один.
 *
 * Свет лампы на клетке под отметкой не рисуется: он лежит накладкой поверх
 * содержимого, а отметка на подскоке крупнее клетки, и светлый контур оказывался
 * бы ВНУТРИ неё, будто под ней лежит ещё одна.
 */
export function HeroMarkedCell({
  layout,
  eventId,
  order,
  stagger,
  day,
  corners,
  wave,
  tone,
  mark,
  overlay,
  overlayMark,
  children,
}: {
  layout: HeroLayout;
  eventId: string;
  /** Номер этих суток в записи — от него зависит, когда они ляжут. */
  order: number;
  /** Через сколько ложатся следующие сутки записи, мс. */
  stagger: number;
  /** Сутки, ISO: по метке палец находит клетку (`HeroPointer`). */
  day: string;
  corners: string;
  wave: { "--ix": number; "--iy": number };
  /** Вид клетки без записи. */
  tone: string;
  /** Вторая строка клетки без записи: часы смены или «В». */
  mark: string;
  /** Вид клетки с записью — полный или тихий. */
  overlay: string;
  overlayMark: string;
  children: React.ReactNode;
}) {
  const state = useStoryEvent(layout, eventId);

  return (
    <div
      data-hero-day={day}
      data-state={state}
      className={cn("hero-cal__cell hero-marked relative bg-paper-raised lit-tile", corners)}
      style={
        { ...wave, "--k": order, "--stagger": `${stagger}ms` } as React.CSSProperties
      }
    >
      <div
        className={cn(
          "hero-marked__under flex aspect-square w-full flex-col items-center justify-center leading-tight",
          tone,
        )}
      >
        <span className="font-mono text-[1em]">{children}</span>
        <span className="font-mono text-[0.7em]">{mark}</span>
      </div>

      <span
        className={cn(
          "hero-marked__mark absolute inset-0 flex flex-col items-center justify-center",
          "rounded-md border leading-tight",
          overlay,
        )}
      >
        <span className="font-mono text-[1em]">{children}</span>
        <span className="font-mono text-[0.7em]">{overlayMark}</span>
      </span>
    </div>
  );
}
