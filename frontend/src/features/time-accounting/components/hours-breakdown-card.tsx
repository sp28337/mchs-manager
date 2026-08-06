import { ProvenanceTooltip } from "@/components/shared/provenance-tooltip";
import { cn } from "@/lib/utils/cn";
import { formatHours } from "@/lib/utils/format";

import type { HoursBreakdown } from "../schemas";

/**
 * Сводка часов периода — главный экран системы для сотрудника.
 *
 * --- Каждое число здесь вычислено, и это видно --------------------------
 *
 * Ни одна величина в сводке не введена человеком: норма выведена
 * Алгоритмом Б из правила и календаря, ночные — Алгоритмом Г в часовом
 * поясе подразделения, переработка — Алгоритмом Ж. Поэтому ВСЕ они несут
 * правовой след, а не одна показательная.
 *
 * --- Почему часовой пояс назван --------------------------------------
 *
 * ТК РФ ст. 96 определяет ночное время как промежуток с 22 до 6 ЧАСОВ, и
 * часы эти местные. Одна и та же смена даёт 4 ночных часа в Москве и 1 во
 * Владивостоке. Сводка, не называющая пояс, показывает число, которое
 * невозможно проверить.
 *
 * --- Почему недоработка разделена -------------------------------------
 *
 * `underworkedHours` без `underworkedExplainedHours` звучит как
 * обвинение. Часы, покрытые больничным или командировкой, — не
 * недоработка сотрудника, и Алгоритм З требует их различать. Здесь они
 * стоят рядом, и та часть, что объяснена, названа словом.
 *
 * --- Сигнальный цвет ---------------------------------------------------
 *
 * Единственная величина, способная его получить, — переработка: она
 * означает, что сотруднику что-то причитается, и это требует решения
 * (Приказ № 410 п. 11, форма компенсации). Ночные и праздничные часы у
 * сменного состава — характер службы, а не отклонение, и красить их
 * значило бы звать к действию там, где действия нет.
 */

export interface HoursBreakdownCardProps {
  breakdown: HoursBreakdown;
  className?: string;
}

const LEGAL_BASE_LABELS: Record<string, string> = {
  fps_service: "ФЗ-141 (служебное время)",
  labor_code: "ТК РФ (рабочее время)",
};

interface FigureProps {
  label: string;
  hours: number | undefined;
  breakdown: HoursBreakdown;
  legalBasis: string;
  emphasis?: "signal" | "none";
  hint?: string;
}

function Figure({ label, hours, breakdown, legalBasis, emphasis = "none", hint }: FigureProps) {
  return (
    <div className="space-y-1">
      <dt className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd
        className={cn(
          "text-2xl",
          emphasis === "signal" && (hours ?? 0) > 0 ? "text-signal" : undefined,
        )}
      >
        <ProvenanceTooltip
          ruleVersionId={breakdown.computedFromRuleVersionId ?? ""}
          legalBasis={legalBasis}
          effectiveOn={breakdown.periodEnd}
        >
          {formatHours(hours)}
        </ProvenanceTooltip>
        <span className="ml-1 font-sans text-sm text-ink-muted">ч</span>
      </dd>
      {hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function HoursBreakdownCard({ breakdown, className }: HoursBreakdownCardProps) {
  const legalBase =
    LEGAL_BASE_LABELS[breakdown.computedFromLegalBase] ?? breakdown.computedFromLegalBase;

  const balance = (breakdown.actualHours ?? 0) - (breakdown.normHours ?? 0);
  const unexplained =
    (breakdown.underworkedHours ?? 0) - (breakdown.underworkedExplainedHours ?? 0);

  return (
    <section className={cn("space-y-5 rounded-sm border border-rule bg-paper-raised p-5", className)}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-3">
        <h2 className="text-base">Сводка служебного времени</h2>
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
          {legalBase} · пояс {breakdown.computedInTimeZone}
        </p>
      </header>

      <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Норма периода"
          hours={breakdown.normHours}
          breakdown={breakdown}
          legalBasis="ФЗ-141 ст. 54-55"
        />
        <Figure
          label="Фактически"
          hours={breakdown.actualHours}
          breakdown={breakdown}
          legalBasis="Алгоритм В — сумма фактов табеля"
          hint={
            balance === 0
              ? "Ровно по норме"
              : balance > 0
                ? `Сверх нормы на ${formatHours(balance)} ч`
                : `Ниже нормы на ${formatHours(-balance)} ч`
          }
        />
        <Figure
          label="Ночные"
          hours={breakdown.nightHours}
          breakdown={breakdown}
          legalBasis="ТК РФ ст. 96 — с 22 до 6 часов"
          hint={`Считаны в поясе ${breakdown.computedInTimeZone}`}
        />
        <Figure
          label="Праздничные"
          hours={breakdown.holidayHours}
          breakdown={breakdown}
          legalBasis="ТК РФ ст. 112 — нерабочие праздничные дни"
        />
        <Figure
          label="Выходные"
          hours={breakdown.weekendHours}
          breakdown={breakdown}
          legalBasis="ТК РФ ст. 153 — работа в выходной день"
        />
        <Figure
          label="Переработка"
          hours={breakdown.overtimeHours}
          breakdown={breakdown}
          legalBasis="Приказ МЧС России № 410 п. 10-11"
          emphasis="signal"
          hint={
            (breakdown.overtimeHours ?? 0) > 0
              ? "Подлежит компенсации отдыхом либо деньгами по рапорту"
              : undefined
          }
        />
        <Figure
          label="Недоработка"
          hours={breakdown.underworkedHours}
          breakdown={breakdown}
          legalBasis="Алгоритм З — недобор до нормы периода"
          hint={
            (breakdown.underworkedHours ?? 0) > 0
              ? `Из них объяснено: ${formatHours(breakdown.underworkedExplainedHours)} ч` +
                (unexplained > 0 ? `, без объяснения ${formatHours(unexplained)} ч` : "")
              : undefined
          }
        />
      </dl>

      <footer className="border-t border-rule pt-3 text-xs text-ink-faint">
        Все величины выведены расчётом. Подчёркнутое число раскрывает норму,
        по которой получено.
      </footer>
    </section>
  );
}
