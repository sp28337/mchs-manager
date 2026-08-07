import type { Metadata } from "next";
import Link from "next/link";

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
import { getEmployeeHistory } from "@/features/compensation/api";
import {
  COMPENSATION_FORM_LABELS,
  HOUR_CATEGORY_LABELS,
} from "@/features/compensation/schemas";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatHours, formatPeriod } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Мои компенсации — Учёт служебного времени" };

/** FE029 — история дел о компенсации сотрудника (UC-08). */
export default async function MyCompensationPage() {
  const session = await getServerSession();
  if (!session) return null;

  let cases: Awaited<ReturnType<typeof getEmployeeHistory>> = [];
  let error: ApiError | null = null;

  try {
    cases = await getEmployeeHistory(session.employeeId, { pageSize: 50 }, {
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
            detail: "Не удалось получить историю. Обновите страницу.",
          });
  }

  return (
    <>
      <PageHeader
        eyebrow={session.fullName}
        title="Мои компенсации"
        description="Дела о компенсации за отклонения от нормы служебного времени, по периодам."
      />

      {error ? <ErrorPanel error={error} /> : null}

      {cases.length === 0 && !error ? (
        <EmptyState
          title="Дел о компенсации нет"
          description={
            "Дело заводится автоматически после утверждения табеля — но только если есть " +
            "что компенсировать. У сменного состава ночные, праздничные и выходные часы " +
            "в пределах нормы не компенсируются (Приказ МЧС России № 410 п. 14)."
          }
        />
      ) : null}

      {cases.length > 0 ? (
        <Table caption="История дел о компенсации">
          <TableHeader>
            <TableRow>
              <TableHead>Период</TableHead>
              <TableHead>Начислено</TableHead>
              <TableHead>Состояние</TableHead>
              <TableHead>Дело</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cases.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{formatPeriod(item.periodStart, item.periodEnd)}</TableCell>
                <TableCell className="space-y-0.5 text-xs">
                  {item.lines.map((line) => (
                    <span key={line.id} className="block">
                      {HOUR_CATEGORY_LABELS[line.hourCategory] ?? line.hourCategory}:{" "}
                      <span className="font-mono">{formatHours(line.hoursAmount)} ч</span>{" "}
                      — {COMPENSATION_FORM_LABELS[line.compensationForm]}
                    </span>
                  ))}
                </TableCell>
                <TableCell>
                  <StatusBadge status={item.status} />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/compensation/cases/${item.id}`}
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
