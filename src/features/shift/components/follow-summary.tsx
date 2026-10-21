"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Кнопка периода уезжает вместе с полосой цифр.
 *
 * --- Что было -------------------------------------------------------------
 *
 * Полоса цифр (`PeriodSummary`) закреплена под шапкой, но закреплена внутри
 * `main`: когда страница докручена до конца и подвал поднимает низ `main` к
 * верху окна, полоса уезжает вверх вместе с ним. Шапка же закреплена окном, и
 * кнопка периода, стоящая в её середине, оставалась на месте — висела над
 * подвалом одна, а цифры, к которым она относится, уходили под шапку.
 *
 * Заметно на невысоком окне: чем ниже окно, тем больше подвала в нём
 * помещается и тем раньше низ `main` доходит до полосы.
 *
 * --- Почему не перенести кнопку в полосу ------------------------------------
 *
 * Середина шапки — колонка сетки `1fr auto 1fr` (`site-header.tsx`): когда
 * середине мешает имя графика, кнопка отъезжает вправо ровно настолько, насколько
 * мешает, и без замера скриптом. В полосе такого расчёта нет, и кнопка легла бы
 * на имя. Поэтому она остаётся в шапке, а следует за полосой смещением.
 *
 * --- Как считается смещение -------------------------------------------------
 *
 * Полоса сдвигается вверх ровно на столько, на сколько низ её контейнера
 * (`main`) оказался выше того места, где полоса стоит закреплённой. Считается по
 * разметке (`top` и высота полосы, низ контейнера), а не по её нынешнему месту
 * на экране: `-translate-y-8` полосы сдвигает и закреплённую, и уехавшую одинаково, и
 * учитывать его не нужно. Пока полоса закреплена, смещение нулевое, и кнопка не
 * трогается.
 *
 * Скрипт нужен потому, что кнопка стоит в шапке, закреплённой окном, а полоса
 * уезжает по правилам `sticky`: связать одно с другим без замера CSS не умеет.
 */

/**
 * Насколько полоса ушла вверх от закреплённого места, точек; не больше нуля.
 *
 * Закреплённая полоса стоит на `stuckTop` от верха окна. Пока её низ
 * (`stuckTop + height`) не выше низа контейнера, ей есть где стоять; когда
 * контейнер кончается раньше, полоса ложится на его низ — и разница между ними
 * и есть смещение.
 */
export function summaryLift({
  stuckTop,
  height,
  containerBottom,
}: {
  stuckTop: number;
  height: number;
  containerBottom: number;
}): number {
  return Math.min(0, containerBottom - (stuckTop + height));
}

/** Смещение полосы, которая сейчас на странице; нуль, если полосы нет. */
function liftNow(): number {
  const strip = document.querySelector<HTMLElement>("[data-summary]");
  const container = strip?.parentElement;
  if (strip == null || container == null) return 0;

  const stuckTop = Number.parseFloat(getComputedStyle(strip).top);
  // `auto` — полоса не закреплена, и уезжать ей нечему.
  if (!Number.isFinite(stuckTop)) return 0;

  // Закреплённая полоса стоит в содержимом контейнера, не в его поле.
  const padding = Number.parseFloat(getComputedStyle(container).paddingBottom) || 0;

  return summaryLift({
    stuckTop,
    height: strip.offsetHeight,
    containerBottom: container.getBoundingClientRect().bottom - padding,
  });
}

export function FollowSummary({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const lift = liftNow();
      node.style.transform = lift === 0 ? "" : `translateY(${lift}px)`;
    };
    // Один пересчёт на кадр, сколько бы раз ни сработала прокрутка.
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Низ контейнера двигает и смена раздела под полосой (график, события,
    // статистика разной высоты), а прокрутки при этом нет.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(document.documentElement);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      node.style.transform = "";
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
