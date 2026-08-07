import { cn } from "@/lib/utils/cn";

import { ABSENCE_LABELS, hours, type Calculation } from "../schemas";

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/**
 * График смен периода.
 *
 * Полоса по дням месяца, а не таблица: человек сверяет её с бумажным
 * табелем глазами, и совпадение формы важнее полноты. Смена, попавшая в
 * отсутствие, отмечена штриховкой — она СТОИТ в графике, но не
 * отработана, и в этом вся разница, из-за которой возникает спор.
 */
export function ShiftStrip({ calculation }: { calculation: Calculation }) {
  const start = new Date(`${calculation.periodStart}T00:00:00Z`);
  const end = new Date(`${calculation.periodEnd}T00:00:00Z`);

  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor < end) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const byDay = new Map(calculation.shifts.map((shift) => [shift.startedOn, shift]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {days.map((day) => {
          const iso = day.toISOString().slice(0, 10);
          const shift = byDay.get(iso);
          const weekday = (day.getUTCDay() + 6) % 7;

          return (
            <div
              key={iso}
              title={
                shift
                  ? shift.absenceKind
                    ? `${day.getUTCDate()} — смена по графику, ${ABSENCE_LABELS[shift.absenceKind]}`
                    : `${day.getUTCDate()} — смена, ${hours(shift.hours)} ч`
                  : `${day.getUTCDate()} — выходной`
              }
              className={cn(
                "flex w-11 flex-col items-center rounded-xs border py-1",
                !shift && "border-rule text-ink-faint",
                shift && !shift.absenceKind && "border-verify bg-verify-soft text-verify",
                shift?.absenceKind &&
                  "border-dashed border-signal bg-signal-soft text-signal",
              )}
            >
              <span className="text-[10px] uppercase">{WEEKDAYS[weekday]}</span>
              <span className="font-mono text-sm">{day.getUTCDate()}</span>
              <span className="font-mono text-[10px]">
                {shift ? (shift.absenceKind ? "—" : hours(shift.hours).split(",")[0]) : "·"}
              </span>
            </div>
          );
        })}
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <Legend className="border-verify bg-verify-soft text-verify" label="Отработанная смена" />
        <Legend
          className="border-dashed border-signal bg-signal-soft text-signal"
          label="Смена по графику, пропущенная по уважительной причине"
        />
        <Legend className="border-rule text-ink-faint" label="Выходной" />
      </dl>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className={cn("size-4 shrink-0 rounded-xs border", className)} aria-hidden />
      <dd className="text-ink-muted">{label}</dd>
    </div>
  );
}
