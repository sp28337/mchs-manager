import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getEmployeeGrants } from "@/features/leave/api";
import { LeaveTimeline } from "@/features/leave/components/leave-timeline";
import { LEAVE_TYPE_BASIS, LEAVE_TYPE_LABELS } from "@/features/leave/schemas";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatDate, inclusiveEnd } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Мои отпуска — Учёт служебного времени" };

/**
 * FE034 — «Мои отпуска» (UC-13).
 *
 * Год ленты — тот, в котором больше всего предоставлений: показывать
 * текущий календарный год у человека, чей отпуск был в прошлом, значило
 * бы отдать пустую ленту при непустом списке.
 */
export default async function MyLeavePage() {
  const session = await getServerSession();
  if (!session) return null;

  let grants: Awaited<ReturnType<typeof getEmployeeGrants>> = [];
  let error: ApiError | null = null;

  try {
    grants = await getEmployeeGrants(session.employeeId, {
      token: session.token,
      cache: "no-store",
    });
  } catch (cause) {
    error =
      cause instanceof ApiError
        ? cause
        : new ApiError({
            type: "about:blank",
            title: "Сервер недоступен",
            status: 0,
            detail: "Не удалось получить список отпусков. Обновите страницу.",
          });
  }

  const byYear = new Map<number, number>();
  for (const grant of grants) {
    const year = Number(grant.periodStart.slice(0, 4));
    byYear.set(year, (byYear.get(year) ?? 0) + 1);
  }
  const timelineYear =
    [...byYear.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ??
    new Date().getUTCFullYear();

  const unusedTotal = grants.reduce((sum, grant) => sum + (grant.unusedDays ?? 0), 0);

  return (
    <>
      <PageHeader
        eyebrow={session.fullName}
        title="Мои отпуска"
        description="Предоставленные отпуска и неиспользованные остатки по ним."
      />

      {error ? <ErrorPanel error={error} /> : null}

      {grants.length === 0 && !error ? (
        <EmptyState
          title="Отпусков не предоставлялось"
          description="Отпуск оформляет специалист по кадрам приказом. Здесь появятся все предоставления с их правовыми основаниями."
        />
      ) : null}

      {unusedTotal > 0 ? (
        <p
          role="status"
          className="rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm"
        >
          Неиспользованных дней отпуска: <strong>{unusedTotal}</strong>. Они не
          сгорают — часть, оставшаяся после отзыва, предоставляется в удобное для
          сотрудника время (ФЗ-141 ст. 65 ч. 3).
        </p>
      ) : null}

      <LeaveTimeline grants={grants} year={timelineYear} />

      {grants.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base">Все предоставления</h2>
          <Table caption="Отпуска сотрудника">
            <TableHeader>
              <TableRow>
                <TableHead>Вид</TableHead>
                <TableHead>Период</TableHead>
                <TableHead className="text-right">Право, дн.</TableHead>
                <TableHead className="text-right">Использовано</TableHead>
                <TableHead className="text-right">Остаток</TableHead>
                <TableHead>Состояние</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((grant) => (
                <TableRow key={grant.id}>
                  <TableCell>
                    <span className="block">
                      {LEAVE_TYPE_LABELS[grant.leaveType] ?? grant.leaveType}
                    </span>
                    <span className="block text-xs text-ink-faint">
                      {LEAVE_TYPE_BASIS[grant.leaveType]}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatDate(grant.periodStart)} —{" "}
                    {inclusiveEnd(grant.periodEnd).toLocaleDateString("ru-RU", {
                      timeZone: "UTC",
                    })}
                  </TableCell>
                  <TableCell className="text-right font-mono">{grant.entitledDays}</TableCell>
                  <TableCell className="text-right font-mono">{grant.usedDays}</TableCell>
                  <TableCell
                    className={`text-right font-mono ${grant.unusedDays > 0 ? "text-signal" : ""}`}
                  >
                    {grant.unusedDays}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={grant.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
    </>
  );
}
