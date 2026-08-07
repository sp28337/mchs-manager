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
import { EmployeeFilters } from "@/features/personnel/components/employee-filters";
import { listEmployees, listUnits } from "@/features/personnel/api";
import {
  EMPLOYMENT_STATUS_LABELS,
  LEGAL_BASE_LABELS,
  type Employee,
  type EmploymentStatus,
  type Unit,
} from "@/features/personnel/schemas";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Сотрудники — Учёт служебного времени" };

const PAGE_SIZE = 25;

/**
 * FE036 — список сотрудников (UC-11).
 *
 * DoD: «фильтры сохраняются в URL».
 *
 * --- Пагинация здесь своя, а не `DataTable` -----------------------------
 *
 * `DataTable` сортирует по столбцам, а сервер сортировки не принимает:
 * `GET /personnel/employees` знает только `unitId`, `page` и `pageSize`.
 * Кликабельный заголовок, ничего не меняющий, — обещание, которого
 * система не выполняет, и это хуже отсутствия сортировки.
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  const params = await searchParams;
  const unitId = typeof params.unitId === "string" ? params.unitId : undefined;
  const status = typeof params.status === "string" ? (params.status as EmploymentStatus) : undefined;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  let units: Unit[] = [];
  let envelope: Awaited<ReturnType<typeof listEmployees>> | null = null;
  let error: ApiError | null = null;

  try {
    [units, envelope] = await Promise.all([
      listUnits({}, { token: session.token, cache: "no-store" }),
      listEmployees(
        { unitId, page, pageSize: PAGE_SIZE },
        { token: session.token, cache: "no-store" },
      ),
    ]);
  } catch (cause) {
    if (cause instanceof ApiError) error = cause;
    else
      error = new ApiError({
        type: "about:blank",
        title: "Сервер недоступен",
        status: 0,
        detail: "Не удалось получить список сотрудников.",
      });
  }

  const unitNames = new Map(units.map((unit) => [unit.id, unit.name]));
  const rows: Employee[] = (envelope?.items ?? []).filter(
    (employee) => !status || employee.employmentStatus === status,
  );

  const totalPages = envelope
    ? Math.max(1, Math.ceil(envelope.totalCount / Math.max(1, envelope.pageSize)))
    : 1;

  function pageHref(target: number): string {
    const next = new URLSearchParams();
    if (unitId) next.set("unitId", unitId);
    if (status) next.set("status", status);
    if (target > 1) next.set("page", String(target));
    const query = next.toString();
    return query ? `?${query}` : "?";
  }

  return (
    <>
      <PageHeader
        title="Сотрудники"
        description="Личный состав подразделения. Основание прохождения службы определяет, каким законом считается служебное время: ФЗ-141 или Трудовой кодекс."
      />

      <EmployeeFilters units={units} />

      {error ? <ErrorPanel error={error} /> : null}

      {!error && rows.length === 0 ? (
        <EmptyState
          title={
            envelope && envelope.totalCount > 0
              ? "Под фильтр никто не подходит"
              : "Сотрудников нет"
          }
          description={
            envelope && envelope.totalCount > 0
              ? "Сбросьте фильтры, чтобы увидеть остальных."
              : "Личный состав заводится кадровой службой при приёме на службу."
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <div className="space-y-3">
          <Table caption="Список сотрудников">
            <TableHeader>
              <TableRow>
                <TableHead>Табельный №</TableHead>
                <TableHead>Фамилия, имя, отчество</TableHead>
                <TableHead>Звание</TableHead>
                <TableHead>Подразделение</TableHead>
                <TableHead>Основание</TableHead>
                <TableHead>На службе с</TableHead>
                <TableHead>Состояние</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((employee) => (
                <TableRow key={employee.id}>
                  <TableCell className="font-mono text-xs">
                    {employee.personnelNumber}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/personnel/employees/${employee.id}`}
                      className="text-trace underline underline-offset-2"
                    >
                      {employee.fullName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{employee.rank}</TableCell>
                  <TableCell className="text-sm">
                    {unitNames.get(employee.currentUnitId) ?? (
                      <span className="font-mono text-xs text-ink-faint">
                        {employee.currentUnitId}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {LEGAL_BASE_LABELS[employee.legalBase] ?? employee.legalBase}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatDate(employee.hiredAt)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={employee.employmentStatus}
                      label={EMPLOYMENT_STATUS_LABELS[employee.employmentStatus]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {envelope ? (
            <nav
              className="flex items-center justify-between gap-4 text-sm"
              aria-label="Постраничная навигация"
            >
              <p className="text-ink-muted">
                {status
                  ? `${rows.length} из ${envelope.items.length} на странице · всего ${envelope.totalCount}`
                  : `Страница ${envelope.page} · всего ${envelope.totalCount}`}
              </p>

              <div className="flex items-center gap-2">
                {envelope.page > 1 ? (
                  <Link
                    href={pageHref(envelope.page - 1)}
                    className="rounded-xs border border-rule-strong px-3 py-1 hover:bg-paper-sunken"
                  >
                    Назад
                  </Link>
                ) : (
                  <span className="rounded-xs border border-rule px-3 py-1 text-ink-faint">
                    Назад
                  </span>
                )}
                <span className="font-mono text-xs text-ink-muted">
                  {envelope.page} / {totalPages}
                </span>
                {envelope.page < totalPages ? (
                  <Link
                    href={pageHref(envelope.page + 1)}
                    className="rounded-xs border border-rule-strong px-3 py-1 hover:bg-paper-sunken"
                  >
                    Вперёд
                  </Link>
                ) : (
                  <span className="rounded-xs border border-rule px-3 py-1 text-ink-faint">
                    Вперёд
                  </span>
                )}
              </div>
            </nav>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
