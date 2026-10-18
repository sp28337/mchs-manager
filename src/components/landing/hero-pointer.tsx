"use client";

import { X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { ABSENCE_MARK, ABSENCE_TONE, CALLOUT_MARK, CALLOUT_TONE } from "@/features/shift/components/day-marks";
import { cn } from "@/lib/utils/cn";

import { HandIcon } from "./hand-icon";
import {
  HERO_EVENT_LABEL,
  HERO_MOVE_MS,
  HERO_SCRIPTS,
  type HeroChip,
  type HeroEvent,
  type HeroLayout,
} from "./hero-story";
import { useStoryPointer } from "./hero-story-store";

/**
 * Палец первого экрана: ездит по месяцам, нажимает и ставит события.
 *
 * --- Почему он здесь, а не поверх страницы --------------------------------------
 *
 * Палец лежит В ТОЙ ЖЕ плоскости, что и месяцы, и наклонён вместе с ней: это
 * рука, положенная на лист, а не наклейка поверх картинки. Стоит он в той же
 * коробке, что месяцы (`.hero-cal__box`), и считает место от неё.
 *
 * --- Как он находит клетку ----------------------------------------------------------
 *
 * По метке на самой клетке (`data-hero-day`) — и по смещениям вёрстки
 * (`offsetLeft`, `offsetTop`), а не по `getBoundingClientRect`: плоскость
 * наклонена, и размеры клеток, измеренные на экране, уже сжаты перспективой.
 * Смещения вёрстки на наклон не смотрят, а палец, лежащий в той же плоскости,
 * наклонится сам.
 *
 * Мерится резкий слой месяцев, а не размытая копия под ним: клетки там те же, но
 * ставить палец на размытую значило бы целиться в дымку.
 *
 * --- Почему положение не в состоянии React -------------------------------------
 *
 * Оно меняется только затем, чтобы быть записанным в `transform`, и перерисовка
 * на каждое движение ничего бы не дала. Поэтому оно пишется в стиль прямо:
 * переход (`transition`) на `transform` везёт палец сам, а длительность перехода
 * и дорога руки в сценарии — одно число (`HERO_MOVE_MS`).
 *
 * Появляется палец не из воздуха, а из угла плоскости, откуда и приезжает к
 * первым суткам: мгновенно поставить его у цели значило бы показать, что он тут
 * и был.
 *
 * --- Что у него в подсказке ---------------------------------------------------------
 *
 * Рядом с нажатием на миг встаёт плашка с тем, что выбрано, — знак и слово, как
 * в строке перечня видов у дня. Перечень целиком показан ниже, в разделе «Как
 * работает»; здесь, на лёгком фоне, достаточно одной строки: она называет, ЧТО
 * ставит палец, а числа рядом показывают, что из этого вышло.
 */

/** Кончик пальца в рисунке руки: от левого верхнего угла, точки. */
const TIP_X = 12;
const TIP_Y = 4;

/** Палец, подъехавший близко к левому краю плоскости, подпись ставит вправо. */
const SIDE_EDGE = 150;

/** Сумма смещений вёрстки от клетки до коробки. */
function offsetWithin(element: HTMLElement, box: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node && node !== box) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

/** Центр клетки в системе коробки или `null`, если такой клетки в коробке нет. */
function cellCentre(box: HTMLElement, day: string): { x: number; y: number } | null {
  const cell = box.querySelector<HTMLElement>(
    `.hero-cal__layer--sharp [data-hero-day="${day}"]`,
  );
  if (cell === null) return null;
  const at = offsetWithin(cell, box);
  return { x: at.x + cell.offsetWidth / 2, y: at.y + cell.offsetHeight / 2 };
}

export function HeroPointer({ layout }: { layout: HeroLayout }) {
  const pointer = useStoryPointer(layout);
  const root = useRef<HTMLDivElement>(null);
  const wasShown = useRef(false);

  // Подпись держится и после того, как нажатие кончилось, — ради растворения:
  // забудь мы её в тот же миг, гаснуть было бы нечему.
  const [lastChip, setLastChip] = useState<HeroChip | null>(null);
  if (pointer.chip !== null && pointer.chip !== lastChip) setLastChip(pointer.chip);

  useLayoutEffect(() => {
    const element = root.current;
    const box = element?.parentElement;
    if (!element || !box) return;

    const place = () => {
      if (pointer.day === null) return;
      const centre = cellCentre(box, pointer.day);
      if (centre === null) return;

      // Подъехать с угла, а не появиться у цели: переход на время выключается,
      // палец ставится в угол, и только потом едет.
      if (!wasShown.current) {
        element.style.transition = "none";
        element.style.transform = `translate3d(${box.clientWidth}px, ${box.clientHeight}px, 0)`;
        void element.offsetWidth;
        element.style.transition = "";
      }
      element.style.transform = `translate3d(${centre.x - TIP_X}px, ${centre.y - TIP_Y}px, 0)`;
      element.dataset.side = centre.x < SIDE_EDGE ? "right" : "left";
    };

    if (pointer.visible) place();
    wasShown.current = pointer.visible;

    // Окно изменилось — клетки сдвинулись, и палец должен стоять на своей.
    if (!pointer.visible) return;
    const watcher = new ResizeObserver(() => {
      wasShown.current = true;
      place();
    });
    watcher.observe(box);
    return () => watcher.disconnect();
  }, [pointer.visible, pointer.day]);

  const script = HERO_SCRIPTS[layout];

  return (
    <div
      ref={root}
      aria-hidden
      data-visible={pointer.visible}
      className="hero-pointer"
      style={{ "--hero-move": `${HERO_MOVE_MS}ms` } as React.CSSProperties}
    >
      {/* Круг от нажатия расходится заново при каждом нажатии: ключ — счётчик
          нажатий, и элемент пересоздаётся, а с ним и анимация. */}
      <span key={pointer.press} className="hero-pointer__ring" />
      <HandIcon />
      <Chip chip={pointer.chip ?? lastChip} events={script.events} shown={pointer.chip !== null} />
    </div>
  );
}

/** Знак записи в подписи: тот же, каким вид суток нарисован в клетке и в перечне. */
function sign(event: HeroEvent): { mark: string; tone: string } {
  if (event.kind === "callout") return { mark: CALLOUT_MARK, tone: CALLOUT_TONE };
  return { mark: ABSENCE_MARK[event.kind], tone: ABSENCE_TONE[event.kind] };
}

function Chip({
  chip,
  events,
  shown,
}: {
  chip: HeroChip | null;
  events: readonly HeroEvent[];
  shown: boolean;
}) {
  if (chip === null) return null;
  const picked = chip.events.map((index) => events[index]!);
  const first = sign(picked[0]!);

  // Вызов называется вместе с часами: «Вызов · 4 ч» — в строке перечня их нет,
  // а на сетке часы вызова не видны вовсе, и без них число рядом непонятно.
  const labels = picked.map((event) =>
    event.hours ? `${HERO_EVENT_LABEL[event.kind]} · ${event.hours} ч` : HERO_EVENT_LABEL[event.kind],
  );

  return (
    <span
      data-shown={shown}
      className={cn(
        "hero-chip lit modal-lift flex items-center gap-2 whitespace-nowrap",
        "rounded-lg bg-paper-raised py-1 pl-1 pr-2.5 text-xs text-ink",
      )}
    >
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-md border font-mono text-[10px] leading-none",
          chip.remove ? "border-rule bg-paper-sunken text-ink-muted" : first.tone,
        )}
      >
        {chip.remove ? <X aria-hidden className="size-3" /> : first.mark}
      </span>
      {chip.remove ? `Убрать: ${labels.join(", ")}` : labels[0]}
    </span>
  );
}
