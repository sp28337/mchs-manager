import type { Metadata } from "next";
import Link from "next/link";

import { DateRangePicker } from "@/components/shared/date-range-picker";
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
import { getUnitSchedules } from "@/features/scheduling/api";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatPeriod } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Графики дежурств — Учёт служебного времени" };

/**
 * FE024 — графики подразделения (UC-02).
 *
 * DoD: «список фильтруется по `period` через URL». Период — в адресе, как
 * везде в этой системе: планировщик, нашедший расхождение в мартовском
 * графике, присылает командиру ссылку, а не описание пути к ней.
 */
export default async function SchedulingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  const params = await searchParams;
  const now = new Date();
  const periodStart =
    typeof params.periodStart === "string"
      ? params.periodStart
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const periodEnd =
    typeof params.periodEnd === "string"
      ? params.periodEnd
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
          .toISOString()
          .slice(0, 10);

  const unitId = session.unitScope[0];

  if (!unitId) {
    return (
      <>
        <PageHeader title="Графики дежурств" />
        <EmptyState
          title="Подразделение не назначено"
          description="Область видимости учётной записи пуста: обратитесь к администратору системы."
        />
      </>
    );
  }

  let schedules: Awaited<ReturnType<typeof getUnitSchedules>> = [];
  let error: ApiError | null = null;
  try {
    schedules = await getUnitSchedules(
      unitId,
      { periodStart, periodEnd },
      { token: session.token, cache: "no-store" },
    );
  } catch (cause) {
    if (cause instanceof ApiError && cause.status !== 404) error = cause;
  }

  return (
    <>
      <PageHeader
        eyebrow={`Подразделение ${unitId}`}
        title="Графики дежурств"
        description="График вводится в действие приказом. Утверждённый график неизменяем — изменения оформляются пересмотром, создающим новую редакцию."
      />

      <DateRangePicker />

      {error ? <ErrorPanel error={error} /> : null}

      {schedules.length === 0 && !error ? (
        <EmptyState
          title="Графиков за период нет"
          description="График составляется на учётный период: месяц, квартал, полугодие или год."
        />
      ) : null}

      {schedules.length > 0 ? (
        <Table caption="Графики дежурств подразделения">
          <TableHeader>
            <TableRow>
              <TableHead>Период</TableHead>
              <TableHead className="text-right">Редакция</TableHead>
              <TableHead className="text-right">Смен</TableHead>
              <TableHead>Приказ</TableHead>
              <TableHead>Состояние</TableHead>
              <TableHead>График</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.map((schedule) => (
              <TableRow key={schedule.id}>
                <TableCell>{formatPeriod(schedule.periodStart, schedule.periodEnd)}</TableCell>
                <TableCell className="text-right font-mono">{schedule.revisionNo}</TableCell>
                <TableCell className="text-right font-mono">
                  {schedule.shifts?.length ?? 0}
                </TableCell>
                <TableCell className="text-xs text-ink-muted">
                  {schedule.approvalOrderRef ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={schedule.status} />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/scheduling/schedules/${schedule.id}`}
                    className="text-trace underline underline-offset-2"
                  >
                    Открыть
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </>
  );
}
