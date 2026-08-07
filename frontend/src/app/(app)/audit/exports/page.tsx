import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TraceForm } from "@/features/audit/components/trace-form";
import { TraceReport } from "@/features/audit/components/trace-report";
import { collectEmployeeTrace } from "@/features/audit/lib/trace";
import { listEmployees } from "@/features/personnel/api";
import type { Employee } from "@/features/personnel/schemas";
import { getServerSession } from "@/lib/auth/server";
import { formatPeriod } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Выгрузки для проверки — Учёт служебного времени",
};

/**
 * FE045 — выгрузка для служебной проверки (UC-14).
 *
 * DoD: «доступна только роли `auditor`, все действия — GET».
 *
 * --- Про роль -----------------------------------------------------------
 *
 * Проверка роли здесь — НЕ защита. Токен разбирается на клиенте, ни один
 * эндпоинт бэкенда сегодня не проверяет ни подлинность подписи, ни права
 * (это задача фазы 12), и человек, желающий обойти эту страницу, обойдёт
 * её тривиально.
 *
 * Она делает другое, и это тоже нужно: не показывает пункт меню и экран
 * тем, чья работа сюда не относится. Выдавать её за контроль доступа
 * было бы опасной неправдой, поэтому сказано прямо здесь, а не только в
 * задаче фазы 12.
 *
 * --- Все действия — GET -------------------------------------------------
 *
 * Экран ничего не создаёт и не меняет. Даже параметры отчёта передаются
 * строкой запроса, а не POST: у выгрузки для проверки не должно быть
 * побочных эффектов вообще, и ссылка на конкретный отчёт обязана
 * открывать тот же отчёт — иначе на неё нельзя сослаться в акте.
 */
export default async function AuditExportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  if (!session.roles.includes("auditor")) {
    return (
      <>
        <PageHeader title="Выгрузки для проверки" />
        <EmptyState
          title="Раздел предназначен для аудитора"
          description="Выгрузка полной трассы данных по сотруднику формируется в рамках служебной проверки. Если проверка поручена вам, обратитесь к администратору за назначением роли."
        />
      </>
    );
  }

  const params = await searchParams;
  const employeeId = typeof params.employeeId === "string" ? params.employeeId : undefined;

  const now = new Date();
  const periodStart =
    typeof params.periodStart === "string"
      ? params.periodStart
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
          .toISOString()
          .slice(0, 10);
  const periodEnd =
    typeof params.periodEnd === "string"
      ? params.periodEnd
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
          .toISOString()
          .slice(0, 10);

  const roster: Employee[] = await listEmployees(
    { pageSize: 200 },
    { token: session.token, cache: "no-store" },
  )
    .then((envelope) => envelope.items)
    .catch(() => []);

  const trace = employeeId
    ? await collectEmployeeTrace(
        employeeId,
        { periodStart, periodEnd },
        { token: session.token, cache: "no-store" },
      )
    : null;

  const subject = roster.find((employee) => employee.id === employeeId);

  return (
    <>
      <PageHeader
        eyebrow="Служебная проверка"
        title="Выгрузка трассы данных"
        description="Собирается операциями чтения из всех модулей учёта. Ни одна запись при формировании отчёта не изменяется."
      />

      <TraceForm roster={roster} />

      {!trace ? (
        <EmptyState
          title="Сотрудник не выбран"
          description="Выберите сотрудника и период: отчёт соберёт карточку, историю службы, часы, компенсации, баланс суток отдыха и отпуска."
        />
      ) : (
        <>
          <div className="border-y border-rule py-3">
            <p className="text-sm">
              <span className="text-ink-muted">Предмет проверки: </span>
              <span className="font-medium">
                {subject
                  ? `${subject.fullName}, ${subject.rank}, табельный № ${subject.personnelNumber}`
                  : trace.employee.data?.fullName ?? employeeId}
              </span>
            </p>
            <p className="text-sm">
              <span className="text-ink-muted">Период: </span>
              <span className="font-medium">{formatPeriod(periodStart, periodEnd)}</span>
            </p>
          </div>

          <TraceReport trace={trace} />
        </>
      )}
    </>
  );
}
