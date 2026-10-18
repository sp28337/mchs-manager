"use client";

import { MetaSep } from "@/features/shift/components/month-grid";
import { CountedNumber } from "@/components/ui/counted-number";
import { cn } from "@/lib/utils/cn";

import { HERO_SCRIPTS, type HeroLayout } from "./hero-story";
import { useStoryStage } from "./hero-story-store";

/**
 * Итог месяца над его сеткой: норма, факт и разница — как в расчёте.
 *
 * Построение то же, что у `MonthBalance` в `shift-strip.tsx`: три величины
 * через иглу-разделитель, у разницы только цвет — переработка зелёная,
 * недоработка красная, ноль без цвета; знака «+» и «−» нет, как и в расчёте.
 * Числа не подменяются, а доходят до нового значения: тот же `CountedNumber`,
 * что в расчёте. Палец ставит отпуск в июле — и итог июля идёт к нулю на
 * глазах, а не только числа над всей сеткой.
 *
 * Сам расчёт здесь не живёт — только готовые числа сценария (`hero-story.ts`),
 * сверенные с доменом тестом.
 */
export function HeroMonthMeta({ layout, index }: { layout: HeroLayout; index: number }) {
  const stage = useStoryStage(layout);
  const total = HERO_SCRIPTS[layout].stages[stage]?.months[index];
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
        <CountedNumber value={String(balance)} /> ч
      </span>
    </span>
  );
}
