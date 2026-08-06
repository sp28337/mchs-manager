import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { listEmployees } from "@/features/personnel/api";
import { getSchedule } from "@/features/scheduling/api";
import { ScheduleWorkspace } from "@/features/scheduling/components/schedule-workspace";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatPeriod } from "@/lib/utils/format";

export const metadata: Metadata = { title: "График дежурств — Учёт служебного времени" };

/**
 * FE025/FE026 — карточка графика: сетка смен и действия над графиком.
 *
 * Список сотрудников подразделения тянется здесь, на сервере: без него
 * сетку не построить, а два запроса из браузера дали бы водопад —
 * сначала график, потом по его `unitId` сотрудники
 * (`async-parallel` неприменим, зависимость настоящая, поэтому цепочка
 * выполняется на сервере, где она дешевле).
 */
export default async function SchedulePage({
  params,
}: {
  params: Promise<{ scheduleId: string }>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  const { scheduleId } = await params;

  let schedule;
  try {
    schedule = await getSchedule(scheduleId, { token: session.token, cache: "no-store" });
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
                detail: "Не удалось получить график. Обновите страницу.",
              }
        }
      />
    );
  }

  let roster: { id: string; fullName: string }[] = [];
  try {
    const page = await listEmployees(
      { unitId: schedule.unitId, pageSize: 200 },
      { token: session.token, cache: "no-store" },
    );
    roster = page.items
      // В наряд ставят действующих: уволенный сотрудник в сетке — приглашение
      // к ошибке, которую сервер и так отклонит.
      .filter((employee) => employee.employmentStatus !== "dismissed")
      .map((employee) => ({ id: employee.id, fullName: employee.fullName }));
  } catch {
    // Сетка без списка бессмысленна, но сам график показать можно —
    // состояние и действия останутся доступны.
    roster = [];
  }

  return (
    <>
      <PageHeader
        eyebrow={`Подразделение ${schedule.unitId}`}
        title={`График, редакция ${schedule.revisionNo}`}
        period={formatPeriod(schedule.periodStart, schedule.periodEnd)}
        actions={<StatusBadge status={schedule.status} />}
      />

      {schedule.previousScheduleId ? (
        <p className="rounded-sm border-l-2 border-rule-strong bg-paper-sunken px-4 py-3 text-sm">
          Пересмотр предыдущей редакции
          {schedule.revisionReason ? `: ${schedule.revisionReason}` : ""}.{" "}
          <Link
            href={`/scheduling/schedules/${schedule.previousScheduleId}`}
            className="text-trace underline underline-offset-2"
          >
            Открыть прежнюю редакцию
          </Link>
        </p>
      ) : null}

      <ScheduleWorkspace schedule={schedule} roster={roster} token={session.token} />
    </>
  );
}
