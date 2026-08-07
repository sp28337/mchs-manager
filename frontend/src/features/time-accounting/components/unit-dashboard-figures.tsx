import { cn } from "@/lib/utils/cn";
import { formatHours } from "@/lib/utils/format";

import type { UnitTimesheetDashboard } from "../schemas";

/**
 * Показатели подразделения.
 *
 * --- Почему полосы, а не круговая диаграмма -----------------------------
 *
 * Показателей четыре, и три из них — величины разной природы (часы,
 * человек, штуки). Круговая диаграмма подразумевает доли одного целого,
 * которых здесь нет; сложить переработку с числом сотрудников нельзя.
 *
 * Полоса сравнивает переработку с недоработкой — единственную пару,
 * сравнение которой осмысленно: обе в часах и обе описывают отклонение от
 * нормы, только в разные стороны. Остальные два числа стоят цифрами,
 * потому что цифра и есть их лучшее представление.
 *
 * Диаграмма рисуется разметкой, без библиотеки: две полосы не стоят
 * тридцати килобайт в бандле, а `aria`-разметка на собственной вёрстке
 * честнее, чем `<canvas>`, о содержимом которого программа чтения с
 * экрана не знает ничего.
 *
 * --- Сигнальный цвет ----------------------------------------------------
 *
 * Достаётся переработке и табелям, ждущим утверждения: и то и другое
 * требует решения командира. Недоработка — повод разобраться, а не
 * действовать немедленно, и потому нейтральна.
 */

export interface UnitDashboardFiguresProps {
  dashboard: UnitTimesheetDashboard;
  className?: string;
}

export function UnitDashboardFigures({ dashboard, className }: UnitDashboardFiguresProps) {
  const overtime = dashboard.totalOvertimeHours ?? 0;
  const underworked = dashboard.totalUnderworkedHours ?? 0;
  const scale = Math.max(overtime, underworked, 1);

  return (
    <div className={cn("space-y-6", className)}>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-sm border border-rule bg-paper-raised p-4">
          <dt className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
            Сотрудников в периоде
          </dt>
          <dd className="mt-1 font-mono text-3xl">{dashboard.totalEmployees ?? 0}</dd>
        </div>

        <div
          className={cn(
            "rounded-sm border p-4",
            (dashboard.pendingApprovalCount ?? 0) > 0
              ? "border-signal bg-signal-soft"
              : "border-rule bg-paper-raised",
          )}
        >
          <dt className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
            Ждут утверждения
          </dt>
          <dd
            className={cn(
              "mt-1 font-mono text-3xl",
              (dashboard.pendingApprovalCount ?? 0) > 0 ? "text-signal" : undefined,
            )}
          >
            {dashboard.pendingApprovalCount ?? 0}
          </dd>
          {(dashboard.pendingApprovalCount ?? 0) > 0 ? (
            <p className="mt-1 text-xs text-ink-muted">
              Расчёт по этим табелям не окончателен, компенсация по ним не заводится.
            </p>
          ) : null}
        </div>
      </dl>

      <section className="space-y-4 rounded-sm border border-rule bg-paper-raised p-5">
        <h2 className="text-base">Отклонение от нормы</h2>

        <dl className="space-y-4">
          <Bar
            label="Переработка"
            hours={overtime}
            scale={scale}
            tone="signal"
            note={
              overtime > 0
                ? "Подлежит компенсации (Приказ МЧС России № 410 п. 10-11)"
                : "Превышения нормы нет"
            }
          />
          <Bar
            label="Недоработка"
            hours={underworked}
            scale={scale}
            tone="neutral"
            note={
              underworked > 0
                ? "Включает часы, объяснённые больничными и командировками"
                : "Недобора до нормы нет"
            }
          />
        </dl>
      </section>
    </div>
  );
}

function Bar({
  label,
  hours,
  scale,
  tone,
  note,
}: {
  label: string;
  hours: number;
  scale: number;
  tone: "signal" | "neutral";
  note: string;
}) {
  const percent = Math.round((hours / scale) * 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
          {label}
        </dt>
        <dd className={cn("font-mono text-lg", tone === "signal" && hours > 0 ? "text-signal" : undefined)}>
          {formatHours(hours)} ч
        </dd>
      </div>

      <div
        role="meter"
        aria-label={`${label}: ${formatHours(hours)} часов`}
        aria-valuenow={hours}
        aria-valuemin={0}
        aria-valuemax={scale}
        className="h-2 w-full overflow-hidden rounded-xs bg-paper-sunken"
      >
        <div
          className={cn("h-full", tone === "signal" ? "bg-signal" : "bg-ink-faint")}
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="text-xs text-ink-faint">{note}</p>
    </div>
  );
}
