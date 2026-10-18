"use client";

import { META_FIGURE, META_UNIT, MetaSep } from "@/features/shift/components/month-grid";
import { CountedNumber } from "@/components/ui/counted-number";
import { cn } from "@/lib/utils/cn";

import { HERO_SCRIPTS, type HeroLayout } from "./hero-story";
import { useStoryStage } from "./hero-story-store";

/**
 * Итог месяца над его сеткой: норма, факт и разница — как в расчёте.
 *
 * Построение то же, что у `MonthBalance` в `shift-strip.tsx`: три величины
 * через иглу-разделитель, у разницы только цвет — переработка зелёная,
 * недоработка красная, ноль чернилами; знака «+» и «−» нет, как и в расчёте.
 * Цифры жирные и чернилами темы, «ч» и иглы тише (`META_FIGURE`) — тоже как там.
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
      <span className={META_FIGURE}>
        <CountedNumber value={String(total.norm)} />
      </span>
      <span className={META_UNIT}>ч</span>
      <MetaSep />
      <span className={META_FIGURE}>
        <CountedNumber value={String(total.actual)} />
      </span>
      <span className={META_UNIT}>ч</span>
      <MetaSep />
      <span className={cn(META_FIGURE, over && "text-verify", under && "text-signal")}>
        <CountedNumber value={String(balance)} />
      </span>
      <span className={META_UNIT}>ч</span>
    </span>
  );
}
