import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimesheetWorkspace } from "@/features/time-accounting/components/timesheet-workspace";
import { getTimesheet } from "@/features/time-accounting/api/queries";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatPeriod } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Табель — Учёт служебного времени" };

/**
 * FE020 — карточка табеля (UC-04, UC-07).
 *
 * Данные читает сервер, действия совершает клиентский остров
 * (`TimesheetWorkspace`): список фактов не нуждается в интерактивности,
 * а форма регистрации и кнопки утверждения — нуждаются.
 */
export default async function TimesheetPage({
  params,
}: {
  params: Promise<{ timesheetId: string }>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  const { timesheetId } = await params;

  let timesheet;
  try {
    timesheet = await getTimesheet(timesheetId, {
      token: session.token,
      cache: "no-store",
    });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) notFound();
    return (
      <ErrorPanel
        error={
          cause instanceof ApiError
            ? cause
            : {
                type: "about:blank",
                title: "Сервер недоступен",
                status: 0,
                detail: "Не удалось получить табель. Обновите страницу.",
              }
        }
      />
    );
  }

  return (
    <>
      {/* Надзаголовок несёт СУБЪЕКТ. Имени сотрудника в ответе табеля
          нет — только идентификатор, — поэтому он и назван
          идентификатором, а не выдан за имя. Заменить его на ФИО
          следует, когда табель начнёт нести карточку сотрудника. */}
      <PageHeader
        eyebrow={`Сотрудник · ${timesheet.employeeId}`}
        title="Табель"
        period={formatPeriod(timesheet.periodStart, timesheet.periodEnd)}
        actions={<StatusBadge status={timesheet.status} />}
      />

      <TimesheetWorkspace timesheet={timesheet} token={session.token} />
    </>
  );
}
