import { cn } from "@/lib/utils/cn";

import type { RestBalance } from "../schemas";

/**
 * FE031 — остаток дополнительных суток отдыха.
 *
 * DoD: «gauge визуализирует остаток относительно максимума».
 *
 * --- Что здесь считать максимумом --------------------------------------
 *
 * Прямого «максимума суток отдыха» закон не устанавливает: остаток растёт
 * начислениями по компенсации и убывает отгулами, потолка у него нет.
 * Нарисовать шкалу «от 0 до 100» значило бы придумать число и выдать его
 * за норму.
 *
 * Ориентир, который закон всё-таки даёт, один и косвенный: Приказ МЧС
 * России № 410 п. 12 ограничивает ОБЩУЮ продолжительность непрерывного
 * отпуска при присоединении дополнительных дней отдыха шестьюдесятью
 * календарными днями. Это не предел накопления, но предел разового
 * использования, и он — единственная величина в нормах, с которой остаток
 * осмысленно сравнивать.
 *
 * Поэтому шкала показывает остаток относительно этих 60 суток и НАЗЫВАЕТ,
 * что это за 60. Остаток сверх — не ошибка: он просто не помещается в
 * один отпуск, и шкала это показывает, а не обрезает молча.
 *
 * --- Почему не круговой индикатор --------------------------------------
 *
 * Круг подразумевает долю целого; целого здесь нет. Полоса читается как
 * «сколько накоплено относительно ориентира» — то, что и происходит.
 */

/** Приказ МЧС России № 410 п. 12 — предел непрерывного отпуска. */
const CONTINUOUS_LEAVE_LIMIT_DAYS = 60;

export interface RestBalanceGaugeProps {
  balance: RestBalance;
  className?: string;
}

function formatDays(value: number): string {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function RestBalanceGauge({ balance, className }: RestBalanceGaugeProps) {
  const days = balance.balanceDays ?? 0;
  const percent = Math.min(100, Math.round((days / CONTINUOUS_LEAVE_LIMIT_DAYS) * 100));
  const overLimit = days > CONTINUOUS_LEAVE_LIMIT_DAYS;

  return (
    <section
      className={cn("space-y-4 rounded-sm border border-rule bg-paper-raised p-5", className)}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base">Остаток суток отдыха</h2>
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
          {balance.computedFromJournal
            ? `на ${balance.asOf} · по журналу`
            : "на сейчас · по сводному представлению"}
        </p>
      </header>

      <p className="text-4xl">
        {formatDays(days)}
        <span className="ml-2 font-sans text-base text-ink-muted">сут.</span>
      </p>

      <div className="space-y-1.5">
        <div
          role="meter"
          aria-label={`Остаток ${formatDays(days)} суток из ориентира в ${CONTINUOUS_LEAVE_LIMIT_DAYS}`}
          aria-valuenow={days}
          aria-valuemin={0}
          aria-valuemax={CONTINUOUS_LEAVE_LIMIT_DAYS}
          className="h-2 w-full overflow-hidden rounded-xs bg-paper-sunken"
        >
          <div
            className={cn("h-full", overLimit ? "bg-signal" : "bg-verify")}
            style={{ width: `${percent}%` }}
          />
        </div>

        <p className="text-xs text-ink-faint">
          Ориентир — {CONTINUOUS_LEAVE_LIMIT_DAYS} суток: столько составляет предельная
          продолжительность непрерывного отпуска при присоединении дополнительных дней
          отдыха (Приказ МЧС России № 410 п. 12). Предела накопления закон не
          устанавливает.
        </p>

        {overLimit ? (
          <p className="text-xs text-signal">
            Накоплено больше, чем можно присоединить к одному отпуску: часть суток
            придётся использовать отдельными отгулами.
          </p>
        ) : null}
      </div>
    </section>
  );
}
