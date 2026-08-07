import { StatusBadge } from "@/components/shared/status-badge";
import {
  COMPENSATION_FORM_LABELS,
  HOUR_CATEGORY_BASIS,
  HOUR_CATEGORY_LABELS,
} from "@/features/compensation/schemas";
import { LEAVE_TYPE_LABELS } from "@/features/leave/schemas";
import {
  LEGAL_BASE_LABELS,
  SERVICE_RECORD_EVENT_LABELS,
} from "@/features/personnel/schemas";
import { MOVEMENT_TYPE_LABELS } from "@/features/rest-balance/schemas";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatHours, formatPeriod } from "@/lib/utils/format";

import { withinPeriod, type EmployeeTrace, type TraceSection } from "../lib/trace";

/**
 * FE045 — трасса данных по сотруднику за период (UC-14).
 *
 * --- Что здесь считается «полной трассой» -------------------------------
 *
 * СРС БП-7: «история графика, фактов, приказов, компенсаций по
 * сотруднику/подразделению за период». Собрано всё, что модули отдают на
 * чтение, и каждый раздел назван вместе со своим правовым основанием —
 * проверяющий должен видеть не только число, но и норму, по которой оно
 * получено.
 *
 * Чего НЕТ и почему сказано прямо: событий табеля по одному (эндпоинт
 * отдаёт сводку, а не журнал фактов) и графика дежурств (он привязан к
 * подразделению, а не к сотруднику, и выбирать из него смены одного
 * человека сервер не предлагает). Умолчать об этих пробелах в отчёте для
 * служебной проверки нельзя: отсутствие раздела читалось бы как
 * отсутствие данных.
 *
 * --- Печать -------------------------------------------------------------
 *
 * Отчёт свёрстан так, чтобы печататься: без цветных заливок как
 * единственного носителя смысла, с подписями словами. Проверка
 * заканчивается бумагой, подшитой в дело.
 */

export interface TraceReportProps {
  trace: EmployeeTrace;
}

export function TraceReport({ trace }: TraceReportProps) {
  const { periodStart, periodEnd } = trace;
  const timeZone = trace.unit.data?.timeZone ?? "Europe/Moscow";

  const movements = trace.movements.data ?? [];
  const inPeriodMovements = movements.filter((movement) =>
    withinPeriod(movement.movementDate, periodStart, periodEnd),
  );

  const grants = trace.leave.data ?? [];
  const inPeriodGrants = grants.filter(
    (grant) => grant.periodStart < periodEnd && grant.periodEnd > periodStart,
  );

  const cases = trace.compensation.data ?? [];
  const inPeriodCases = cases.filter(
    (item) => item.periodStart < periodEnd && item.periodEnd > periodStart,
  );

  return (
    <article className="space-y-8">
      <Section
        title="Сотрудник"
        basis="Личный состав: ФЗ-141 ст. 38 (стаж службы)"
        state={trace.employee}
      >
        {trace.employee.data ? (
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-[auto_1fr] sm:max-w-2xl text-sm">
            <dt className="text-ink-muted">Фамилия, имя, отчество</dt>
            <dd>{trace.employee.data.fullName}</dd>
            <dt className="text-ink-muted">Табельный номер</dt>
            <dd className="font-mono">{trace.employee.data.personnelNumber}</dd>
            <dt className="text-ink-muted">Звание</dt>
            <dd>{trace.employee.data.rank}</dd>
            <dt className="text-ink-muted">Основание прохождения службы</dt>
            <dd>
              {LEGAL_BASE_LABELS[trace.employee.data.legalBase] ??
                trace.employee.data.legalBase}
            </dd>
            <dt className="text-ink-muted">Принят на службу</dt>
            <dd className="font-mono">{formatDate(trace.employee.data.hiredAt)}</dd>
            <dt className="text-ink-muted">Подразделение</dt>
            <dd>
              {trace.unit.data
                ? `${trace.unit.data.name} (${trace.unit.data.code})`
                : trace.employee.data.currentUnitId}
            </dd>
            <dt className="text-ink-muted">Часовой пояс подразделения</dt>
            <dd className="font-mono text-xs">{timeZone}</dd>
          </dl>
        ) : null}
      </Section>

      <Section
        title="История прохождения службы"
        basis="ФЗ-141 ст. 38; записи неизменяемы (append-only)"
        state={trace.serviceRecord}
      >
        {trace.serviceRecord.data?.length ? (
          <ol className="space-y-1 text-sm">
            {trace.serviceRecord.data.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-x-4">
                <span className="font-mono">{formatDate(entry.effectiveDate)}</span>
                <span>
                  {SERVICE_RECORD_EVENT_LABELS[entry.eventType] ?? entry.eventType}
                </span>
                {entry.rank ? <span className="text-ink-muted">{entry.rank}</span> : null}
                <span className="font-mono text-xs text-ink-faint">
                  внесено {formatDate(entry.recordedAt.slice(0, 10))}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <Nothing>Записей истории службы нет.</Nothing>
        )}
      </Section>

      <Section
        title="Служебное время за период"
        basis="ФЗ-141 ст. 54, 55; ТК РФ ст. 96, 112, 153"
        state={trace.hours}
      >
        {trace.hours.data ? (
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-[auto_1fr] sm:max-w-lg text-sm">
            <dt className="text-ink-muted">Норма периода</dt>
            <dd className="font-mono">{formatHours(trace.hours.data.normHours)} ч</dd>
            <dt className="text-ink-muted">Фактически</dt>
            <dd className="font-mono">{formatHours(trace.hours.data.actualHours)} ч</dd>
            <dt className="text-ink-muted">Переработка</dt>
            <dd className="font-mono">{formatHours(trace.hours.data.overtimeHours)} ч</dd>
            <dt className="text-ink-muted">Недоработка</dt>
            <dd className="font-mono">{formatHours(trace.hours.data.underworkedHours)} ч</dd>
            <dt className="text-ink-muted">Ночные</dt>
            <dd className="font-mono">{formatHours(trace.hours.data.nightHours)} ч</dd>
            <dt className="text-ink-muted">Праздничные</dt>
            <dd className="font-mono">{formatHours(trace.hours.data.holidayHours)} ч</dd>
            <dt className="text-ink-muted">Выходные</dt>
            <dd className="font-mono">{formatHours(trace.hours.data.weekendHours)} ч</dd>

            {/* Пояс расчёта и редакция правила — не подробности, а
                единственное, чем проверяется само число: ночные часы
                считаются в поясе подразделения (ТК РФ ст. 96), а норма —
                по редакции, действовавшей на дату события. */}
            <dt className="text-ink-muted">Считалось в поясе</dt>
            <dd className="font-mono text-xs">
              {trace.hours.data.computedInTimeZone || timeZone}
            </dd>
            <dt className="text-ink-muted">Основание расчёта</dt>
            <dd className="font-mono text-xs">
              {trace.hours.data.computedFromRuleVersionId ?? "редакция правила не указана"}
            </dd>
          </dl>
        ) : null}
      </Section>

      <Section
        title="Компенсации"
        basis="Приказ МЧС России № 410 пп. 10-18; Приказ № 539 пп. 103-111"
        state={trace.compensation}
        note={outsideNote(cases.length, inPeriodCases.length, "дел")}
      >
        {inPeriodCases.length > 0 ? (
          <ul className="space-y-3 text-sm">
            {inPeriodCases.map((item) => (
              <li key={item.id} className="space-y-1">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium">
                    {formatPeriod(item.periodStart, item.periodEnd)}
                  </span>
                  <StatusBadge status={item.status} />
                  {item.correctsCaseId ? (
                    <span className="text-xs text-signal">
                      исправляет дело {item.correctsCaseId}
                    </span>
                  ) : null}
                </p>
                <ul className="space-y-0.5 pl-4 text-xs">
                  {item.lines.map((line) => (
                    <li key={line.id} className="flex flex-wrap gap-x-3">
                      <span>{HOUR_CATEGORY_LABELS[line.hourCategory]}</span>
                      <span className="font-mono">{formatHours(line.hoursAmount)} ч</span>
                      <span>{COMPENSATION_FORM_LABELS[line.compensationForm]}</span>
                      <span className="text-ink-muted">
                        {HOUR_CATEGORY_BASIS[line.hourCategory]}
                      </span>
                      {/* Редакция правила, по которой посчитана строка, —
                          то, ради чего трасса и собирается: без неё
                          проверить число нечем. */}
                      <span className="font-mono text-ink-faint">
                        редакция {line.legalBasisRuleVersionId}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <Nothing>Дел о компенсации за период нет.</Nothing>
        )}
      </Section>

      <Section
        title="Баланс дополнительных суток отдыха"
        basis="Приказ МЧС России № 410 пп. 11-12; журнал движений неизменяем"
        state={trace.balance}
        note={outsideNote(movements.length, inPeriodMovements.length, "движений")}
      >
        {trace.balance.data ? (
          <p className="text-sm">
            Остаток:{" "}
            <span className="font-mono">{trace.balance.data.balanceDays}</span> сут
            {trace.balance.data.computedFromJournal
              ? " (по журналу движений)"
              : " (по представлению, возможно отставание до минуты)"}
            .
          </p>
        ) : null}

        {inPeriodMovements.length > 0 ? (
          <ul className="mt-2 space-y-0.5 text-xs">
            {inPeriodMovements.map((movement) => (
              <li key={movement.id} className="flex flex-wrap gap-x-3">
                <span className="font-mono">{formatDate(movement.movementDate)}</span>
                <span>{MOVEMENT_TYPE_LABELS[movement.movementType]}</span>
                <span className="font-mono">{movement.amountDays} сут</span>
                {movement.reversesMovementId ? (
                  <span className="text-signal">
                    сторно движения {movement.reversesMovementId}
                    {movement.reversalReason ? `: ${movement.reversalReason}` : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Nothing>Движений баланса за период нет.</Nothing>
        )}
      </Section>

      <Section
        title="Отпуска"
        basis="ФЗ-141 ст. 58-65; Приказ МЧС России № 410 п. 12"
        state={trace.leave}
        note={outsideNote(grants.length, inPeriodGrants.length, "отпусков")}
      >
        {inPeriodGrants.length > 0 ? (
          <ul className="space-y-0.5 text-sm">
            {inPeriodGrants.map((grant) => (
              <li key={grant.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-mono">
                  {formatPeriod(grant.periodStart, grant.periodEnd)}
                </span>
                <span>{LEAVE_TYPE_LABELS[grant.leaveType] ?? grant.leaveType}</span>
                <StatusBadge status={grant.status} />
              </li>
            ))}
          </ul>
        ) : (
          <Nothing>Отпусков, пересекающихся с периодом, нет.</Nothing>
        )}
      </Section>

      <section className="border-t border-rule pt-4 text-xs text-ink-muted">
        <p className="font-medium">Чего в этой трассе нет</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>
            Отдельных фактов служебного времени: сервер отдаёт сводку часов за
            период, а не журнал событий по сотруднику.
          </li>
          <li>
            График дежурств: он ведётся по подразделению, и выборки смен одного
            сотрудника интерфейс чтения не предоставляет.
          </li>
        </ul>
        <p className="mt-2">
          Трасса собрана {new Date(trace.collectedAt).toLocaleString("ru-RU")} из
          операций чтения; ни одна запись при этом не изменялась.
        </p>
      </section>
    </article>
  );
}

function outsideNote(total: number, shown: number, unit: string): string | undefined {
  const outside = total - shown;
  if (outside <= 0) return undefined;
  return `За границами периода осталось ${unit}: ${outside}. Они существуют, но в отчёт за этот период не входят.`;
}

function Section({
  title,
  basis,
  state,
  note,
  children,
}: {
  title: string;
  basis: string;
  state: TraceSection<unknown>;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="border-b border-rule pb-1">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide">{title}</h2>
        <p className="text-xs text-ink-muted">{basis}</p>
      </div>

      {state.failure ? (
        // Несобранный раздел ОТМЕЧЕН, а не показан пустым: для проверки
        // «данных нет» и «получить не удалось» означают противоположное.
        <p className={cn("rounded-sm border-l-2 border-signal bg-signal-soft px-3 py-2 text-sm")}>
          Раздел не собран: {state.failure}. Отсутствие данных здесь не
          установлено — установлено, что их не удалось получить.
        </p>
      ) : state.absence ? (
        // Объяснённое отсутствие — сам по себе результат проверки, а не
        // сбой, и подан он спокойно: сервер ответил, и ответ приведён
        // дословно, чтобы проверяющий сослался на него, а не на пересказ.
        <p className="rounded-sm border-l-2 border-rule-strong bg-paper-sunken px-3 py-2 text-sm">
          Данных нет. Ответ системы: {state.absence}
        </p>
      ) : (
        <>
          {children}
          {note ? <p className="text-xs text-ink-muted">{note}</p> : null}
        </>
      )}
    </section>
  );
}

function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-muted">{children}</p>;
}
