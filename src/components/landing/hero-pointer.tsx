"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

import { HandIcon } from "./hand-icon";
import {
  HERO_EVENT_LABEL,
  HERO_MOVE_MS,
  HERO_SCRIPTS,
  type HeroChip,
  type HeroEvent,
  type HeroEventKind,
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
 * --- Что у него вместо подсказки ----------------------------------------------------
 *
 * Нажатие выпускает в воздух надпись — знак и слово, — как в играх, когда
 * подобрал что-то и над героем всплывает «+10 опыта»: она появляется над
 * местом нажатия, на миг замирает и, уходя вверх, испаряется. Ни плашки, ни
 * рамки у неё нет: плашка с рамкой над рукой читалась окошком, а не событием,
 * и висела, пока рука стояла. Надпись называет, ЧТО поставил палец, а числа
 * рядом показывают, что из этого вышло; сама же она проходит и исчезает, не
 * мешая клеткам.
 *
 * Читается она без плашки за счёт цвета записи — тот же, каким она закрашена
 * на сетке, — и бумажного ореола вокруг букв: на светлой теме он белый, на
 * тёмной — тёмный, и буквы не тонут в клетках позади.
 *
 * Стоит надпись НЕ на пальце, а в коробке месяцев на месте нажатия: рука
 * после нажатия сразу едет дальше, и надпись, ехавшая бы с ней, тянулась бы
 * следом, как привязанная. Взлетает она с того места, где её выпустили.
 */

/** Кончик пальца в рисунке руки: от левого верхнего угла, точки. */
const TIP_X = 12;
const TIP_Y = 4;

/** Насколько выше кончика пальца встаёт низ надписи, точки. */
const CHIP_LIFT = 10;

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

  // Надпись взлетает с места нажатия — того, куда рука к этому мигу доехала.
  const spot = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = spot.current;
    const box = root.current?.parentElement;
    if (!element || !box || pointer.day === null || pointer.press === 0) return;
    const centre = cellCentre(box, pointer.day);
    if (centre === null) return;
    element.style.left = `${centre.x}px`;
    element.style.top = `${centre.y - TIP_Y - CHIP_LIFT}px`;
    // Только по нажатию, а не по смене суток: рука поехала дальше — а надпись
    // уже взлетела, и ей оставаться там, где её выпустили.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointer.press]);

  const script = HERO_SCRIPTS[layout];

  return (
    <>
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
      </div>

      {/* Надпись — отдельно от пальца: после нажатия он едет дальше, а она
          остаётся там, где её выпустили, и уходит вверх. */}
      <span ref={spot} aria-hidden className="hero-chip-spot">
        <Chip key={pointer.press} chip={lastChip} events={script.events} />
      </span>
    </>
  );
}

/**
 * Цвет надписи — тот же, каким запись закрашена на сетке и в легенде расчёта.
 *
 * Только цвет текста, без заливки и рамки: надпись всплывает над клетками без
 * плашки. Вызов — один цвет на все виды (`CALLOUT_TONE`), у отсутствий — по
 * виду, смена — зелёный смен; кто не назван, берёт обычные чернила.
 */
const INK: Partial<Record<HeroEventKind, string>> = {
  annual_leave: "text-leave",
  extra_leave: "text-trip",
  sick_leave: "text-sick",
  study_leave: "text-study",
  business_trip: "text-errand",
  time_off_in_lieu: "text-rest",
  callout: "text-callout",
  shift: "text-verify",
};

/**
 * Всплывающая надпись: одно слово, без плашки, рамки и значка.
 *
 * Прежде перед словом стоял знак записи — «Б Больничный», «О Отпуск» — и часы у
 * вызова. Но знак говорил то же, что слово и цвет, а часы на сетке не видны
 * вовсе и объясняются в подписи сами, когда человек откроет приложение;
 * в надписи, которая пролетает за секунду, лишнее мешало прочесть главное.
 * Поэтому осталось слово — название события, а при удалении — «Удалить».
 *
 * Анимация целиком в `globals.css` (`hero-float`): надпись появляется с лёгким
 * приростом, держится мгновение и, поднимаясь, растворяется. Ключ у неё —
 * счётчик нажатий (`HeroPointer`), и каждое нажатие даёт новую.
 */
function Chip({ chip, events }: { chip: HeroChip | null; events: readonly HeroEvent[] }) {
  if (chip === null) return null;

  if (chip.remove) return <span className="hero-chip text-ink">Удалить</span>;

  const event = events[chip.events[0]!]!;
  return (
    <span className={cn("hero-chip", INK[event.kind] ?? "text-ink")}>
      {HERO_EVENT_LABEL[event.kind]}
    </span>
  );
}
