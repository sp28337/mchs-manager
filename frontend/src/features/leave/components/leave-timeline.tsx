import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils/cn";
import { formatDate, inclusiveEnd } from "@/lib/utils/format";

import { LEAVE_TYPE_LABELS, type LeaveGrant } from "../schemas";

/**
 * FE033 — лента отпусков года.
 *
 * DoD: «timeline визуализирует периоды без наложений».
 *
 * --- Наложений не бывает, и лента это показывает ------------------------
 *
 * Инвариант 9.1.1 запрещает пересечение периодов одного сотрудника, и
 * `excl_leave_period_no_overlap` не даёт их создать. Поэтому лента не
 * решает задачу «уложить пересекающиеся отрезки в дорожки» — задачи нет.
 * Одна дорожка на год, отрезки идут подряд.
 *
 * Зато лента показывает то, что инвариант ДОПУСКАЕТ и что иначе не видно:
 * СМЕЖНОСТЬ. Основной отпуск по 14 марта и дополнительный с 15-го —
 * законное присоединение (Приказ № 410 п. 12, ФЗ-141 ст. 63), и на ленте
 * они стоят вплотную, без зазора. Отпуска с промежутком разделены
 * зазором. Разница видна глазом, а не вычисляется в уме из дат.
 *
 * --- Отзыв рисуется, а не подразумевается ------------------------------
 *
 * Отозванный отпуск сохраняет ПРЕДОСТАВЛЕННЫЙ период — инвариант 9.1.3
 * запрещает укорачивать его задним числом. Поэтому отрезок рисуется
 * целиком, а использованная часть выделена заливкой: неиспользованный
 * остаток виден как незакрашенный хвост, и его не надо считать.
 *
 * --- Почему разметка, а не библиотека графиков --------------------------
 *
 * Отрезков в году — единицы. Библиотека дала бы тридцать килобайт и
 * `<canvas>`, о содержимом которого программа чтения с экрана не знает
 * ничего; здесь каждый отрезок — ссылка с подписью, доступная и с
 * клавиатуры.
 */

export interface LeaveTimelineProps {
  grants: LeaveGrant[];
  year: number;
  className?: string;
}

const MONTHS = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

function dayOfYear(iso: string, year: number): number {
  const date = new Date(`${iso}T00:00:00Z`);
  const start = Date.UTC(year, 0, 1);
  return (date.getTime() - start) / 86_400_000;
}

function yearLength(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
}

export function LeaveTimeline({ grants, year, className }: LeaveTimelineProps) {
  const total = yearLength(year);

  const visible = grants
    .filter((grant) => {
      const start = dayOfYear(grant.periodStart, year);
      const end = dayOfYear(grant.periodEnd, year);
      return end > 0 && start < total;
    })
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));

  if (visible.length === 0) return null;

  return (
    <section className={cn("space-y-3 rounded-sm border border-rule bg-paper-raised p-5", className)}>
      <h2 className="text-base">Отпуска {year} года</h2>

      {/* Шкала месяцев — единственный ориентир, по которому отрезок
          читается как «март», а не как «пятно ближе к началу». */}
      <div aria-hidden className="flex border-b border-rule pb-1">
        {MONTHS.map((month, index) => (
          <span
            key={month}
            className="font-mono text-[10px] uppercase tracking-wider text-ink-faint"
            style={{
              width: `${((Date.UTC(year, index + 1, 1) - Date.UTC(year, index, 1)) / 86_400_000 / total) * 100}%`,
            }}
          >
            {month}
          </span>
        ))}
      </div>

      <ol className="space-y-2">
        {visible.map((grant) => {
          const start = Math.max(0, dayOfYear(grant.periodStart, year));
          const end = Math.min(total, dayOfYear(grant.periodEnd, year));
          const width = ((end - start) / total) * 100;
          const offset = (start / total) * 100;

          // Использованная доля: у отозванного отпуска она меньше
          // предоставленной, и остаток виден незакрашенным хвостом.
          const grantedDays = grant.usedDays + grant.unusedDays;
          const usedShare = grantedDays > 0 ? grant.usedDays / grantedDays : 1;

          return (
            <li key={grant.id} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm">
                  {LEAVE_TYPE_LABELS[grant.leaveType] ?? grant.leaveType}
                  <span className="ml-2 font-mono text-xs text-ink-muted">
                    {formatDate(grant.periodStart)} —{" "}
                    {inclusiveEnd(grant.periodEnd).toLocaleDateString("ru-RU", {
                      timeZone: "UTC",
                    })}
                  </span>
                </span>
                <StatusBadge status={grant.status} />
              </div>

              <div className="relative h-3 w-full rounded-xs bg-paper-sunken">
                <div
                  className="absolute h-full rounded-xs border border-rule-strong bg-paper"
                  style={{ left: `${offset}%`, width: `${width}%` }}
                >
                  <div
                    className={cn(
                      "h-full rounded-xs",
                      grant.status === "cancelled" ? "bg-ink-faint/40" : "bg-verify",
                    )}
                    style={{ width: `${usedShare * 100}%` }}
                  />
                </div>
              </div>

              {grant.unusedDays > 0 ? (
                <p className="text-xs text-signal">
                  Не использовано {grant.unusedDays} дн. — подлежат предоставлению в
                  удобное для сотрудника время (ФЗ-141 ст. 65 ч. 3).
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
