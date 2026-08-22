"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Число, которое не подменяется, а доходит до нового значения.
 *
 * --- Зачем ---------------------------------------------------------------
 *
 * Человек правит календарь и смотрит на полосу итога: что стало с нормой,
 * что с переработкой. Числа там меняются все разом, и подменённые
 * мгновенно они не отвечают на главный вопрос — КАКОЕ из них двинулось.
 * Особенно когда разница в один час: «144» и «143» на одном месте глаз не
 * различает вовсе, если между ними ничего не происходило.
 *
 * Отсчёт до нового значения отвечает на это движением. Он же стоит на
 * первом экране, где показывает разницу между отпуском и отгулом, — и
 * деталь тут одна на оба места намеренно: числа приложения обязаны себя
 * вести одинаково, где бы они ни стояли.
 *
 * --- Почему на строке, а не на числе ---------------------------------------
 *
 * Величины приходят сюда уже готовыми строками: «1972», «15,5», «8».
 * Формат у них общий (`formatHoursTrim`), но берётся он в разных местах, и
 * протаскивать сюда ещё и правило записи значило бы завести второй
 * источник формата. Поэтому строка разбирается на месте: сколько знаков
 * после запятой у ЦЕЛИ, столько же будет у промежуточных значений, а
 * последним кадром ставится ровно та строка, которую передали, — без
 * пересчёта и без риска разойтись с ней на последнюю цифру.
 *
 * Что разобрать не удалось — «8 суток», «—», пустое место — меняется
 * подстановкой. Отсчитывать нечего.
 *
 * --- Уважение к `prefers-reduced-motion` ----------------------------------
 *
 * Отсчёта нет вовсе: новое значение встаёт сразу. Числа при этом не
 * страдают — движение здесь помогает заметить перемену, но не является
 * самой переменой.
 */

/**
 * Сколько идёт перещёлкивание.
 *
 * Меньше полусекунды глаз не успевает поймать, больше секунды — правка в
 * календаре начинает казаться медленной: человек ставит отметку и ждёт
 * ответа.
 */
export const COUNT_MS = 900;

export function CountedNumber({ value }: { value: string }) {
  return <>{useCountedNumber(value)}</>;
}

/**
 * Строка, которую надо показать сейчас: цель или значение по дороге к ней.
 *
 * Первая отрисовка отдаёт цель как есть — и на сервере, и в браузере.
 * Отсчёт начинается только со ВТОРОГО значения: иначе экран, едва
 * открывшись, принимался бы крутить все свои числа от нуля, хотя ничего
 * ещё не менялось.
 */
export function useCountedNumber(target: string): string {
  const [tween, setTween] = useState<string | null>(null);
  const shown = tween ?? target;

  // Что стоит на экране прямо сейчас. Отсчёт начинается отсюда, а не от
  // прежней цели: если человек правит календарь быстрее, чем идёт
  // перещёлкивание, новое значение подхватывается с полдороги, а не
  // прыгает назад к тому, от чего шли.
  const displayed = useRef(shown);
  const frame = useRef(0);

  useEffect(() => {
    const from = parse(displayed.current);
    const to = parse(target);

    if (from === null || to === null || from === to || reducedMotion()) {
      displayed.current = target;
      setTween(null);
      return;
    }

    const digits = decimalsOf(target);
    const startedAt = performance.now();

    const step = (now: number) => {
      const passed = Math.min(1, (now - startedAt) / COUNT_MS);
      if (passed < 1) {
        // Замедление к концу: число подходит к своему значению, а не
        // останавливается на нём с разбегу.
        const eased = 1 - Math.pow(1 - passed, 3);
        const text = format(from + (to - from) * eased, digits);
        displayed.current = text;
        setTween(text);
        frame.current = requestAnimationFrame(step);
        return;
      }
      // Последним кадром — переданная строка, а не пересчитанная: только
      // так итог гарантированно совпадает с тем, что показывает расчёт.
      displayed.current = target;
      setTween(null);
    };

    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target]);

  return shown;
}

/** Число из записи вида «1972» или «15,5». Всё прочее — не число. */
function parse(text: string): number | null {
  if (!/^-?\d+(,\d+)?$/.test(text)) return null;
  return Number(text.replace(",", "."));
}

/** Сколько знаков после запятой у цели: столько же будет по дороге к ней. */
function decimalsOf(text: string): number {
  const comma = text.indexOf(",");
  return comma === -1 ? 0 : text.length - comma - 1;
}

function format(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
