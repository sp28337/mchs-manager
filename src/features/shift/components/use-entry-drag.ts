"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Перетаскивание профиля в папку — событиями указателя, а не родным
 * `draggable`.
 *
 * --- Почему не HTML5 drag-and-drop -----------------------------------------
 *
 * Родное перетаскивание браузера не работает на касание вовсе: ни Safari на
 * iPhone, ни Chrome на Android не шлют `dragstart` от пальца. А график
 * правят как раз с телефона — перетаскивание, доступное только мыши, здесь
 * было бы возможностью для тех, кому она нужна меньше всего.
 *
 * События указателя (`pointer*`) одинаковы для пальца, мыши и пера, и
 * ничего, кроме них, для переноса не нужно: что под пальцем, спрашивается у
 * самого документа (`elementFromPoint`).
 *
 * --- Почему тащат за ручку, а не за всю строку -----------------------------
 *
 * Страница прокручивается пальцем, и строка, которая ловит движение целиком,
 * отнимала бы у прокрутки половину списка. Запретить прокрутку на время
 * переноса нельзя: `touch-action` действует на жест, который ЕЩЁ не начался,
 * и смена его посреди жеста ничего уже не меняет.
 *
 * Поэтому у строки есть ручка — узкая полоска слева, на которой прокрутка
 * выключена заранее (`touch-none`). Палец на ручке тащит, палец на строке
 * листает, и спорить им не о чем.
 *
 * --- Почему нажатие на ручку тоже что-то делает ----------------------------
 *
 * Перетаскивание недоступно с клавиатуры и трудно тому, у кого дрожат руки.
 * Поэтому та же ручка, нажатая без движения, открывает перечень папок:
 * второй, равноправный путь к тому же действию.
 */

export interface EntryDrag {
  entryId: string;
  /** Имя профиля: его же показывает призрак под пальцем. */
  name: string;
  x: number;
  y: number;
  /** Папка под указателем или `null`, если под ним ничего подходящего. */
  over: string | null;
  /** Указатель сдвинулся настолько, что это перенос, а не нажатие. */
  moved: boolean;
}

/** Сколько точек нужно пройти, чтобы движение считалось переносом. */
const THRESHOLD = 6;

function folderUnder(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y);
  const target = element?.closest("[data-folder-drop]");
  return target instanceof HTMLElement ? (target.dataset.folderDrop ?? null) : null;
}

export function useEntryDrag({
  onDrop,
  onTap,
}: {
  onDrop: (entryId: string, folderId: string) => void;
  /** Нажатие на ручку без переноса — второй путь к тому же действию. */
  onTap: (entryId: string) => void;
}): {
  drag: EntryDrag | null;
  handlers: (entryId: string, name: string) => {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
  };
} {
  const [drag, setDrag] = useState<EntryDrag | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    drag,
    handlers: (entryId, name) => ({
      onPointerDown: (event) => {
        // Захват указателя: палец, уехавший за пределы ручки (а он уедет —
        // в том и смысл), продолжает слать события ей же.
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, y: event.clientY };
        setDrag({ entryId, name, x: event.clientX, y: event.clientY, over: null, moved: false });
      },
      onPointerMove: (event) => {
        const from = start.current;
        if (drag === null || from === null) return;
        const moved =
          drag.moved ||
          Math.hypot(event.clientX - from.x, event.clientY - from.y) > THRESHOLD;
        setDrag({
          ...drag,
          x: event.clientX,
          y: event.clientY,
          // Папка под указателем ищется только после порога: иначе строка,
          // лежащая на папке, подсвечивала бы её от простого касания.
          over: moved ? folderUnder(event.clientX, event.clientY) : null,
          moved,
        });
      },
      onPointerUp: () => {
        if (drag === null) return;
        if (!drag.moved) onTap(drag.entryId);
        else if (drag.over !== null) onDrop(drag.entryId, drag.over);
        setDrag(null);
        start.current = null;
      },
      onPointerCancel: () => {
        setDrag(null);
        start.current = null;
      },
    }),
  };
}
