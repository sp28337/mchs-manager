"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils/cn";

import type { PeriodCalculation } from "../domain/calculation";
import { formatHoursTrim, type Decimal } from "../domain/decimal";
import type { IsoDate } from "../domain/plain-date";

/**
 * Приращение разницы — всплывает над сутками, которые только что правили.
 *
 * --- Что это и зачем ------------------------------------------------------
 *
 * Правка одних суток двигает разницу над сеткой — «переработку» или
 * «недоработку» — и число там идёт к новому значению счётчиком
 * (`CountedNumber`). Но стоит оно наверху, в полосе итога, а смотрит человек
 * на клетку, которую нажал: отгул поставлен, и увидеть, во что он обошёлся,
 * значит поднять глаза и сравнить два числа в уме.
 *
 * Поэтому приращение показывается там же, где было действие: над клеткой
 * выплывает «−24» красным или «+24» зелёным, на миг замирает и, уходя вверх,
 * растворяется — тем же движением и тем же ходом, что названия событий на
 * первом экране (`.hero-chip`), как «+10 опыта» в играх. Красный и зелёный те
 * же, что у самой разницы: меньше — недоработка, больше — переработка.
 *
 * --- Откуда берётся число ---------------------------------------------------
 *
 * Это разница между «переработка минус недоработка» до правки и после — то
 * самое, что изменилось в поле над сеткой, а не часы одной смены: отпуск на
 * сутки со сменой убирает и отработанное, и норму, и итог при этом двигается
 * на другую величину, чем сама смена. Считается по расчёту выбранного отрезка
 * (`PeriodCalculation`), поэтому надпись и число наверху сойтись не могут.
 *
 * --- Почему не от любого пересчёта ----------------------------------------
 *
 * Разница меняется и без правок суток: другой график в настройках, другой
 * учётный период, смена профиля. «−120» над случайной клеткой в этих случаях
 * было бы ложью — человек ничего не ставил. Поэтому правка суток сама
 * отмечается (`note`), перед тем как попасть в профиль, а пересчёт, пришедший
 * следом, эту отметку забирает. Отметка живёт секунду: правка, не изменившая
 * профиль (то же событие поставили поверх такого же), расчёт не пересчитывает,
 * и отметка не должна дожидаться чужого пересчёта.
 *
 * --- Движение ----------------------------------------------------------------
 *
 * Правила — в `globals.css` (`.balance-pop`). Человеку, попросившему поменьше
 * движения, надпись не достаётся вовсе: общее правило сводит ход к нулевой
 * длительности, а заливка оставляет её невидимой. Число над сеткой при этом
 * меняется как всегда, а для программы чтения приращение объявляется словами
 * (`role="status"` — он стоит в разметке всегда, а меняется только текст:
 * вставленный вместе с текстом, такой слой не озвучивается).
 */

/** Сколько живёт отметка правки, мс: от нажатия до пересчёта — доли секунды. */
const FRESH_MS = 1000;

interface Pop {
  /** Новое приращение — новая надпись: по ключу анимация идёт заново. */
  id: number;
  text: string;
  more: boolean;
  /** Середина клетки в окне, точки. */
  left: number;
  top: number;
}

/** «Переработка минус недоработка»: знак показывает, в какую сторону разница. */
function signed(calculation: PeriodCalculation): Decimal {
  return calculation.overtimeHours.minus(calculation.undertimeHours);
}

export function useBalancePop(calculation: PeriodCalculation): {
  /** Отметить правку суток — звать ДО того, как она попадёт в профиль. */
  note: (day: IsoDate) => void;
  /** Что вставить в разметку рабочего экрана. */
  pop: ReactNode;
} {
  const last = useRef<Decimal>(signed(calculation));
  const pending = useRef<{ day: IsoDate; at: number } | null>(null);
  const counter = useRef(0);
  const [shown, setShown] = useState<Pop | null>(null);

  const note = useCallback((day: IsoDate) => {
    pending.current = { day, at: performance.now() };
  }, []);

  useEffect(() => {
    const now = signed(calculation);
    const delta = now.minus(last.current);
    last.current = now;

    const edit = pending.current;
    if (edit === null) return;
    pending.current = null;
    if (performance.now() - edit.at > FRESH_MS || delta.isZero()) return;

    // Клетки нет в окне — надписи негде встать, и показывать её над пустым
    // местом незачем: число наверху всё равно изменилось.
    const cell = document.querySelector<HTMLElement>(`[data-day="${edit.day}"]`);
    if (cell === null) return;
    const box = cell.getBoundingClientRect();
    if (box.bottom < 0 || box.top > window.innerHeight) return;

    const more = delta.greaterThan(0);
    counter.current += 1;
    setShown({
      id: counter.current,
      // Настоящий минус, а не дефис: короче дефиса цифры рядом выглядят
      // перечёркнутыми.
      text: `${more ? "+" : "−"}${formatHoursTrim(delta.abs())}`,
      more,
      left: box.left + box.width / 2,
      top: box.top + box.height / 2,
    });
  }, [calculation]);

  const pop = (
    <>
      <span role="status" className="sr-only">
        {shown === null
          ? ""
          : `Разница ${shown.more ? "выросла" : "уменьшилась"} на ${shown.text.slice(1)} ч`}
      </span>
      {shown === null
        ? null
        : createPortal(
            // В теле страницы, а не рядом с сеткой: у предков рабочего экрана
            // бывают `transform` и `filter` (проявление раздела), и закреплённый
            // элемент внутри них считал бы место от них, а не от окна.
            <span
              aria-hidden
              className="balance-pop-spot"
              style={{ left: shown.left, top: shown.top }}
            >
              <span
                key={shown.id}
                className={cn(
                  "balance-pop font-mono",
                  shown.more ? "text-verify" : "text-signal",
                )}
                onAnimationEnd={() => setShown(null)}
              >
                {shown.text}
              </span>
            </span>,
            document.body,
          )}
    </>
  );

  return { note, pop };
}
