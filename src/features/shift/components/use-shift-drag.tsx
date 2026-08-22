"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { IsoDate } from "../domain/plain-date";

/**
 * Перенос смены пальцем и мышью.
 *
 * --- Зачем это, если есть окно суток ---------------------------------------
 *
 * Перенос — одно событие: «смену отдали на седьмое». Окном суток он
 * делается двумя: открыть четвёртое, снять смену, найти седьмое, открыть,
 * назначить. Между этими действиями график неверен, и человек это видит.
 * Перетаскивание говорит то же самое одним движением и тем словарём,
 * которым человек об этом думает.
 *
 * Окно при этом остаётся и остаётся главным: тащить мышью и пальцем
 * нельзя с клавиатуры, и другого способа снять смену у того, кто не может
 * тащить, быть не должно.
 *
 * --- Почему свои события, а не HTML5 drag-and-drop -------------------------
 *
 * Родное перетаскивание не работает на телефоне вовсе — а это ровно то
 * устройство, на котором график чаще всего и правят. Указатели
 * (`PointerEvent`) — один код на мышь, палец и перо.
 *
 * --- Долгое нажатие: почему именно так -------------------------------------
 *
 * На телефоне тянуть сразу нельзя: сетка занимает экран целиком, и
 * движение пальцем по ней — прокрутка страницы, а не перенос. Поэтому как
 * на рабочем столе телефона: подержал — клетка приподнялась — тащишь.
 *
 * Порядок здесь важнее длительности:
 *
 * * пока идёт отсчёт, движение больше нескольких точек ОТМЕНЯЕТ его —
 *   человек начал прокручивать, и перехватывать его жест нельзя;
 * * значит, к моменту, когда отсчёт дошёл до конца, палец стоит на месте
 *   и прокрутка ещё не началась. Только тогда `preventDefault` на
 *   `touchmove` её и удерживает: начавшуюся прокрутку он уже не остановит.
 *
 * Слушатель `touchmove` вешается руками и НЕ пассивным: React вешает свои
 * пассивными, а пассивный `preventDefault` браузер игнорирует.
 *
 * Мышью ждать нечего: там прокрутка колесом, и жесты не спорят. Тянется
 * сразу, как курсор сдвинулся на несколько точек, — иначе обычное нажатие
 * превращалось бы в перенос от малейшего дрожания руки.
 *
 * --- Почему клик после переноса съедается ----------------------------------
 *
 * Нажатие по клетке открывает окно суток. После переноса браузер всё
 * равно шлёт `click` — и поверх только что перенесённой смены открывалось
 * бы окно. Гасится он на фазе перехвата и ровно один раз.
 */

/** Сколько держать палец, прежде чем клетка «оторвётся». */
const LONG_PRESS_MS = 350;

/** Сдвиг, после которого нажатие считается не нажатием. */
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 4;

/** Полоса у края экрана, в которой страница едет сама. */
const EDGE = 72;
const EDGE_SPEED = 12;

interface Press {
  day: IsoDate;
  x: number;
  y: number;
  touch: boolean;
  timer: number;
}

export interface ShiftDrag {
  /** Сутки, которые сейчас несут. */
  from: IsoDate | null;
  /** Сутки под указателем, куда смену можно положить. */
  over: IsoDate | null;
  /** Свойства клетки: `canDrag` — есть ли в этих сутках что нести. */
  cellProps: (
    day: IsoDate,
    canDrag: boolean,
  ) => {
    "data-day": IsoDate;
    onPointerDown?: (event: React.PointerEvent) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
  };
  /** Образец под указателем. Ставится в конце разметки. */
  ghost: ReactNode;
}

export function useShiftDrag({
  canDrop,
  onMove,
  renderGhost,
}: {
  /** Можно ли положить смену в эти сутки. */
  canDrop: (day: IsoDate) => boolean;
  onMove: (from: IsoDate, to: IsoDate) => void;
  /** Что рисовать под указателем, пока смену несут. */
  renderGhost: (day: IsoDate) => ReactNode;
}): ShiftDrag {
  // Нажатие живёт в ссылках, а не в состоянии: слушатели читают его на
  // каждом движении, и подписка не должна пересобираться по кадру.
  // Состояние здесь только то, что рисуется.
  const [pressing, setPressing] = useState(false);
  const [drag, setDrag] = useState<{ from: IsoDate; x: number; y: number } | null>(null);
  const [over, setOver] = useState<IsoDate | null>(null);

  const press = useRef<Press | null>(null);
  const dragging = useRef<IsoDate | null>(null);
  const overRef = useRef<IsoDate | null>(null);
  // Скорость самоедущей страницы: считается на движении, применяется
  // покадрово. Иначе перенос за край экрана требовал бы дёргать пальцем.
  const speed = useRef(0);
  const frame = useRef(0);

  // Обработчики вызывающего — через ссылку: они приходят стрелками и
  // меняются каждую отрисовку, а подписка обязана пережить отрисовку.
  // Запись в эффекте, а не по ходу отрисовки: во время отрисовки ссылка
  // ещё может быть отброшена вместе с попыткой, и правило это запрещает.
  const handlers = useRef({ canDrop, onMove });
  useEffect(() => {
    handlers.current = { canDrop, onMove };
  }, [canDrop, onMove]);

  const stop = useCallback(() => {
    if (press.current?.timer) window.clearTimeout(press.current.timer);
    press.current = null;
    dragging.current = null;
    overRef.current = null;
    speed.current = 0;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    setPressing(false);
    setDrag(null);
    setOver(null);
  }, []);

  useEffect(() => {
    if (!pressing) return;

    const tick = () => {
      frame.current = dragging.current === null ? 0 : requestAnimationFrame(tick);
      if (speed.current !== 0) window.scrollBy(0, speed.current);
    };

    const begin = (x: number, y: number) => {
      const current = press.current;
      if (!current) return;
      dragging.current = current.day;
      setDrag({ from: current.day, x, y });
      // Короткий отклик, если устройство умеет: на телефоне это
      // единственное подтверждение, что клетка «оторвалась».
      navigator.vibrate?.(8);
      if (!frame.current) frame.current = requestAnimationFrame(tick);
    };

    const move = (event: PointerEvent) => {
      const current = press.current;
      if (!current) return;

      if (dragging.current === null) {
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        if (Math.hypot(dx, dy) <= (current.touch ? TOUCH_SLOP : MOUSE_SLOP)) return;
        // Палец поехал раньше, чем клетка оторвалась, — это прокрутка, и
        // она не наша. Мышь наоборот: сдвинулась — значит тащит.
        if (current.touch) stop();
        else begin(event.clientX, event.clientY);
        return;
      }

      setDrag({ from: current.day, x: event.clientX, y: event.clientY });

      const under = dayAt(event.clientX, event.clientY);
      const target =
        under !== null && under !== current.day && handlers.current.canDrop(under)
          ? under
          : null;
      overRef.current = target;
      setOver(target);

      const above = EDGE - event.clientY;
      const below = event.clientY - (window.innerHeight - EDGE);
      speed.current = above > 0 ? -EDGE_SPEED : below > 0 ? EDGE_SPEED : 0;
    };

    const up = () => {
      const current = press.current;
      const target = overRef.current;
      if (current && dragging.current !== null && target !== null) {
        handlers.current.onMove(current.day, target);
        swallowClick();
      } else if (dragging.current !== null) {
        // Тащили и бросили мимо: клик всё равно придёт, и открывать по
        // нему окно суток человек не просил.
        swallowClick();
      }
      stop();
    };

    const block = (event: TouchEvent) => {
      if (dragging.current !== null) event.preventDefault();
    };

    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("keydown", key);
    document.addEventListener("touchmove", block, { passive: false });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("keydown", key);
      document.removeEventListener("touchmove", block);
    };
  }, [pressing, stop]);

  const cellProps: ShiftDrag["cellProps"] = (day, canDrag) => ({
    "data-day": day,
    ...(canDrag
      ? {
          onPointerDown: (event: React.PointerEvent) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const touch = event.pointerType === "touch";
            const x = event.clientX;
            const y = event.clientY;
            press.current = {
              day,
              x,
              y,
              touch,
              timer: touch
                ? window.setTimeout(() => {
                    if (!press.current) return;
                    dragging.current = press.current.day;
                    setDrag({ from: press.current.day, x, y });
                    navigator.vibrate?.(8);
                  }, LONG_PRESS_MS)
                : 0,
            };
            setPressing(true);
          },
          // Долгое нажатие на телефоне зовёт меню выделения: оно перекрыло
          // бы клетку ровно в тот момент, когда она оторвалась.
          onContextMenu: (event: React.MouseEvent) => {
            if (press.current !== null || dragging.current !== null) event.preventDefault();
          },
        }
      : {}),
  });

  return {
    from: drag?.from ?? null,
    over,
    cellProps,
    ghost:
      drag !== null && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-hidden
              className="shift-ghost pointer-events-none fixed z-100"
              style={{ left: drag.x, top: drag.y }}
            >
              {renderGhost(drag.from)}
            </div>,
            document.body,
          )
        : null,
  };
}

/** Сутки под точкой экрана — по разметке, а не по своей карте клеток. */
function dayAt(x: number, y: number): IsoDate | null {
  const element = document.elementFromPoint(x, y);
  const cell = element?.closest<HTMLElement>("[data-day]");
  return cell?.dataset.day ?? null;
}

/**
 * Съесть ближайший клик.
 *
 * Один раз и на фазе перехвата: браузер шлёт `click` после отпускания, и
 * без этого поверх перенесённой смены открывалось бы окно суток. Если
 * клика не последовало, слушатель снимается сам — иначе он съел бы
 * следующее осмысленное нажатие.
 */
function swallowClick() {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, true), 400);
}
