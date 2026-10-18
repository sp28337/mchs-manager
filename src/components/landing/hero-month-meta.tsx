"use client";

import { MetaSep } from "@/features/shift/components/month-grid";
import { CountedNumber } from "@/components/ui/counted-number";
import { cn } from "@/lib/utils/cn";

import { useHeroStage } from "./hero-stage";

/**
 * Итог месяца над его сеткой: норма, факт и разница — как в расчёте.
 *
 * Построение то же, что у `MonthBalance` в `shift-strip.tsx`: три величины
 * через иглу-разделитель, у разницы знак и цвет — переработка зелёная,
 * недоработка красная, ноль без цвета. Числа не подменяются, а доходят до
 * нового значения: тот же `CountedNumber`, что в расчёте. Человек отмечает
 * отпуск в августе — и видит движение там, где август, а не только в числах
 * над всей сеткой.
 *
 * Сам расчёт здесь не живёт — только готовые числа сценария
 * (`hero-scenario.ts`), сверенные с доменом тестом.
 */
export function HeroMonthMeta({ month }: { month: number }) {
  const total = useHeroStage().months[month];
  if (total === undefined) return null;

  const over = total.overtime > 0;
  const under = total.undertime > 0;
  const balance = under ? total.undertime : total.overtime;

  return (
    <span>
      <CountedNumber value={String(total.norm)} /> ч
      <MetaSep />
      <CountedNumber value={String(total.actual)} /> ч
      <MetaSep />
      <span className={cn(over && "text-verify", under && "text-signal")}>
        {over || under ? <span aria-hidden>{over ? "+" : "−"}</span> : null}
        <CountedNumber value={String(balance)} /> ч
      </span>
    </span>
  );
}
