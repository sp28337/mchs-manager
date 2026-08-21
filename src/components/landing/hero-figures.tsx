"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils/cn";

import { HERO_COUNT_MS, HERO_STAGES, HERO_STAGE_AT, type HeroStage } from "./hero-scenario";

/**
 * Три числа первого экрана — той же плашкой, что в расчёте.
 *
 * --- Почему одна плашка, а не три ----------------------------------------
 *
 * Норму, факт и разницу между ними сравнивают друг с другом, и рамка
 * вокруг каждого разрезала бы то, что читается вместе. В расчёте это одна
 * плашка (`MainPlate`), и здесь она обязана быть той же: первый экран
 * показывает не «что-то похожее», а тот самый блок, который человек
 * увидит внутри.
 *
 * --- Почему числа перещёлкиваются ----------------------------------------
 *
 * Это и есть предмет разговора. Тринадцатого человек берёт отгул за
 * переработку — уходит смена из отработанного, но норма остаётся: отгул
 * ею уже оплачен. С двадцать пятого отпуск — и вот тут уменьшается норма,
 * потому что эти часы не нужно было отрабатывать по уважительной причине.
 *
 * Разницу между двумя случаями можно объяснить абзацем текста, а можно
 * показать: два числа меняются по-разному. Счётчик нужен именно для
 * этого — чтобы глаз увидел, КАКОЕ из чисел двинулось.
 *
 * --- Почему счётчик на сценарии, а не на CSS ------------------------------
 *
 * Числа надо не «показать другими», а провести от прежнего к новому, и
 * промежуточные значения обязаны быть целыми часами. CSS так не умеет:
 * `@property` считает дробями, а привести их к виду часов можно только
 * подстановкой в `content`, где формат уже не выбрать.
 *
 * --- Уважение к `prefers-reduced-motion` ---------------------------------
 *
 * Человеку с отключённой анимацией показывается СРАЗУ последнее
 * состояние: и отсутствия, и числа при них. Это честнее, чем оставить его
 * с первым кадром истории, которую он не увидит.
 */

const CAPTIONS = ["Норма периода", "Фактически", "Переработка"] as const;

export function HeroFigures({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const stage = useStageTimeline();

  return (
    // Разметка повторяет `MainPlate` из расчёта: высота, поля, скругление
    // и разводка чисел по плашке — те же.
    <dl
      className={cn(
        "flex h-14 items-center justify-around gap-x-3 rounded-xl bg-paper-raised px-4 py-2",
        className,
      )}
      style={style}
    >
      <Figure value={stage.norm} caption={CAPTIONS[0]} emphatic />
      <Figure value={stage.actual} caption={CAPTIONS[1]} />
      <Figure value={stage.overtime} caption={CAPTIONS[2]} verify />
    </dl>
  );
}

/** Число с подписью — тот же `Figure`, что в полосе итога расчёта. */
function Figure({
  value,
  caption,
  emphatic,
  verify,
}: {
  value: number;
  caption: string;
  emphatic?: boolean;
  verify?: boolean;
}) {
  return (
    <div className="min-w-0 sm:flex sm:flex-row-reverse sm:items-center sm:gap-4 text-center">
      {/* Число и его единица не разрываются переносом: «168» на одной
          строке и «ч» на следующей читается как другое число. */}
      <dd
        className={cn(
          "whitespace-nowrap font-mono leading-none tabular-nums",
          emphatic ? "text-xl sm:text-2xl" : "text-lg sm:text-xl",
          verify && "font-medium text-verify",
        )}
      >
        {value}
        <span className="ml-1 text-xs text-ink-muted sm:text-sm">ч</span>
      </dd>
      <dt className="flex h-3.5 items-center justify-center gap-1 whitespace-nowrap text-[11px] leading-tight text-ink-muted">
        <span className="sm:after:content-[':'] lg:after:content-none">{caption}</span>
      </dt>
    </div>
  );
}

/**
 * Состояние расчёта на текущий момент истории.
 *
 * Возвращает не «какое сейчас состояние», а ЧИСЛА — в том числе
 * промежуточные, пока идёт перещёлкивание. Первая отрисовка отдаёт первое
 * состояние: она же уходит в статическую разметку, и расходиться ей с
 * браузером нельзя.
 */
function useStageTimeline(): HeroStage {
  const [shown, setShown] = useState<HeroStage>(HERO_STAGES[0]!);
  const frame = useRef(0);

  useEffect(() => {
    const last = HERO_STAGES[HERO_STAGES.length - 1]!;

    // Отключённая анимация — сразу итог. Показать первый кадр и замереть
    // значило бы соврать: у человека остались бы числа до отсутствий.
    //
    // Правило запрещает синхронный `setState` в эффекте — обычно верно,
    // это лишний прогон отрисовки. Здесь он неизбежен и однократен:
    // системную настройку на сервере не прочесть, а отдать в разметку
    // сразу итог нельзя — она общая для всех, и у большинства история
    // всё-таки играется с начала.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown(last);
      return;
    }

    const timers = HERO_STAGES.slice(1).map((next, index) => {
      const from = HERO_STAGES[index]!;
      const at = HERO_STAGE_AT[index + 1] ?? 0;
      return window.setTimeout(() => countTo(from, next), at);
    });

    function countTo(from: HeroStage, to: HeroStage) {
      const startedAt = performance.now();
      const step = (now: number) => {
        const passed = Math.min(1, (now - startedAt) / HERO_COUNT_MS);
        // Замедление к концу: число подходит к своему значению, а не
        // останавливается на нём с разбегу.
        const eased = 1 - Math.pow(1 - passed, 3);
        setShown({
          norm: between(from.norm, to.norm, eased),
          actual: between(from.actual, to.actual, eased),
          overtime: between(from.overtime, to.overtime, eased),
        });
        if (passed < 1) frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      cancelAnimationFrame(frame.current);
    };
  }, []);

  return shown;
}

/** Целые часы между двумя состояниями: доли часа расчёт тут не показывает. */
function between(from: number, to: number, passed: number): number {
  return Math.round(from + (to - from) * passed);
}
