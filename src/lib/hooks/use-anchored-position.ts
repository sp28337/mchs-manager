"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Место для всплывающего слоя рядом с элементом, который его вызвал.
 *
 * --- Зачем это вообще ----------------------------------------------------
 *
 * Всплывающие слои на этом экране живут внутри боковой колонки, а та
 * прокручивается внутри себя и потому обрезает всё, что вылезает за её
 * края. Календарь и подсказка шире колонки, и при обычном `absolute` от
 * них осталась бы половина.
 *
 * Слой с `position: fixed` считается от окна и обрезке предком не
 * подлежит — при условии, что ни у одного предка нет `transform`,
 * `filter` или `contain`, и на этих страницах это так. Портал при этом не
 * нужен: слой остаётся ребёнком своей обёртки, поэтому проверка
 * «щёлкнули мимо» через `contains` продолжает работать, а порядок обхода
 * по Tab не ломается.
 *
 * --- Что возвращается ----------------------------------------------------
 *
 * `null` до первого замера. Показывать слой в этот момент нельзя: он
 * мигнул бы в левом верхнем углу окна и прыгнул на место. Вызывающий код
 * прячет его, пока место не известно.
 *
 * --- Почему пересчёт, а не один замер ------------------------------------
 *
 * Открытый слой должен ехать вместе со своей кнопкой. Прокрутка ловится с
 * `capture`, иначе события от внутренних областей прокрутки — той самой
 * боковой колонки — до документа не всплывут.
 */
export function useAnchoredPosition(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  options: {
    /** Ширина слоя: нужна, чтобы прижать его к краю окна. */
    width: number;
    /** По какому краю кнопки равняется слой. */
    align: "left" | "right";
    /** Зазор между кнопкой и слоем. */
    gap?: number;
  },
): { top: number; left: number } | null {
  const { width, align, gap = 4 } = options;
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  // Обычный `useEffect`, а не `useLayoutEffect`: последний на сервере не
  // выполняется и ругается в консоль, а мигание кадром здесь исключено —
  // до первого замера слой скрыт.
  //
  // `sync` — один путь на все случаи, включая закрытие: у закрытого слоя
  // места нет, и забытые от прошлого раза координаты при следующем
  // открытии показали бы его на миг там, где кнопки уже нет.
  useEffect(() => {
    function sync() {
      const box = open ? anchor.current?.getBoundingClientRect() : undefined;
      if (!box) {
        setPlace(null);
        return;
      }
      const room = document.documentElement.clientWidth;
      const wanted = align === "right" ? box.right - width : box.left;
      setPlace({
        top: box.bottom + gap,
        // Не ближе восьми пикселей к любому краю окна: иначе на узком
        // экране слой уезжает за него.
        left: Math.min(Math.max(8, wanted), Math.max(8, room - width - 8)),
      });
    }

    sync();
    if (!open) return;

    window.addEventListener("resize", sync);
    document.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      document.removeEventListener("scroll", sync, true);
    };
  }, [open, anchor, width, align, gap]);

  return place;
}
