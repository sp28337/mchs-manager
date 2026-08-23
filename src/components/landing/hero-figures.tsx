"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { BalanceCaption, BALANCE_SWAP_MS } from "@/components/ui/balance-caption";
import { CountedNumber } from "@/components/ui/counted-number";
import { cn } from "@/lib/utils/cn";

import { HERO_FIGURES_AT, HERO_STAGES, type HeroStage } from "./hero-scenario";

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
 * Это и есть предмет разговора. Сначала отпуск на первую смену месяца — и
 * уходят двадцать четыре часа из отработанного, а норма стоит: отпуск лёг
 * на субботу с воскресеньем, рабочих дней внутри него нет, исключать из
 * нормы нечего. Потом тринадцатого отгул за переработку — уходит ещё одна
 * смена, норма опять на месте, и восьми часов переработки на суточный
 * отгул не хватает: разница уходит в недоработку.
 *
 * Что норма считается по производственному календарю, а не по графику
 * смен, можно объяснить абзацем текста, а можно показать: два числа
 * меняются по-разному. Счётчик нужен именно для этого — чтобы глаз
 * увидел, КАКОЕ из чисел двинулось.
 *
 * Сам счётчик здесь не свой: это `CountedNumber`, тот же, что крутит числа
 * в полосе итога при правке календаря. Первый экран обещает поведение,
 * которое человек встретит внутри, и расходиться им нельзя.
 *
 * --- Уважение к `prefers-reduced-motion` ---------------------------------
 *
 * Человеку с отключённой анимацией показывается СРАЗУ последнее
 * состояние: и отсутствия, и числа при них. Это честнее, чем оставить его
 * с первым кадром истории, которую он не увидит.
 */

const CAPTIONS = ["Норма периода", "Фактически"] as const;

export function HeroFigures({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const stage = useStageTimeline();
  const under = stage.undertime > 0;

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
      {/* Третье число — разница, и имя у неё меняется вместе со знаком.
          Та же деталь, что в расчёте: приставка уезжает, число меняет
          цвет. */}
      <Figure
        value={under ? stage.undertime : stage.overtime}
        caption={<BalanceCaption under={under} />}
        tone={under ? "signal" : stage.overtime > 0 ? "verify" : undefined}
      />
    </dl>
  );
}

/** Число с подписью — тот же `Figure`, что в полосе итога расчёта. */
function Figure({
  value,
  caption,
  emphatic,
  tone,
}: {
  value: number;
  caption: ReactNode;
  emphatic?: boolean;
  /** Разница: зелёная, пока она переработка, красная — когда недоработка. */
  tone?: "signal" | "verify";
}) {
  return (
    <div className="min-w-0 sm:flex sm:flex-row-reverse sm:items-center sm:gap-4 text-center">
      {/* Число и его единица не разрываются переносом: «168» на одной
          строке и «ч» на следующей читается как другое число. */}
      <dd
        className={cn(
          "whitespace-nowrap font-mono leading-none tabular-nums",
          emphatic ? "text-xl sm:text-2xl" : "text-lg sm:text-xl",
          // Цвет меняется вместе с именем разницы, а не когда счётчик
          // добежит: «пере» уезжает и число краснеет одним движением.
          // Длительность одна на оба — она приходит оттуда же, откуда её
          // берёт сама приставка. Ждать конца счёта здесь нечего: в ноль
          // он не приходит, знак разницы меняется сразу.
          "transition-colors",
          tone === "signal" && "text-signal",
          tone === "verify" && "font-medium text-verify",
        )}
        style={{ transitionDuration: `${BALANCE_SWAP_MS}ms` }}
      >
        <CountedNumber value={String(value)} />
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
 * Возвращает СОСТОЯНИЕ целиком, а не числа по дороге к нему: дорогу до
 * нового значения каждое число проходит само (`CountedNumber`). Первая
 * отрисовка отдаёт первое состояние — она же уходит в статическую
 * разметку, и расходиться ей с браузером нельзя.
 */
function useStageTimeline(): HeroStage {
  const [index, setIndex] = useState(0);

  useEffect(() => {
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
      setIndex(HERO_STAGES.length - 1);
      return;
    }

    const timers = HERO_STAGES.slice(1).map((_, step) =>
      window.setTimeout(() => setIndex(step + 1), HERO_FIGURES_AT[step + 1] ?? 0),
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return HERO_STAGES[index] ?? HERO_STAGES[0]!;
}
