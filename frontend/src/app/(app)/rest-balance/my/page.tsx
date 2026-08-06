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
import { getBalance, getMovements } from "@/features/rest-balance/api";
import { ConsumptionRequestForm } from "@/features/rest-balance/components/consumption-request-form";
import { RestBalanceGauge } from "@/features/rest-balance/components/rest-balance-gauge";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Баланс суток отдыха — Учёт служебного времени" };

/**
 * FE032 — «Баланс суток отдыха» (UC-13, UC-11).
 *
 * --- Журнал показывается целиком, включая сторно ------------------------
 *
 * Сторнирующее движение не сворачивается с исправляемым: инвариант 8.1.3
 * требует полной трассируемости для служебной проверки, а свёрнутая пара
 * скрыла бы, что ошибка была. Пара помечена — видно, какая запись какую
 * отменяет, и по какой причине.
 */
export default async function MyRestBalancePage() {
  const session = await getServerSession();
  if (!session) return null;

  let balance = null;
  let movements: Awaited<ReturnType<typeof getMovements>> = [];
  let error: ApiError | null = null;

  try {
    [balance, movements] = await Promise.all([
      getBalance(session.employeeId, undefined, { token: session.token, cache: "no-store" }),
      getMovements(session.employeeId, { pageSize: 50 }, {
        token: session.token,
        cache: "no-store",
      }),
    ]);
  } catch (cause) {
    error =
      cause instanceof ApiError
        ? cause
        : new ApiError({
            type: "about:blank",
            title: "Сервер недоступен",
            status: 0,
            detail: "Не удалось получить баланс. Обновите страницу.",
          });
  }

  const reversedIds = new Set(
    movements.map((m) => m.reversesMovementId).filter((id): id is string => Boolean(id)),
  );

  return (
    <>
      <PageHeader
        eyebrow={session.fullName}
        title="Баланс суток отдыха"
        description="Дополнительные сутки отдыха начисляются по компенсации за переработку и расходуются отгулами либо присоединением к отпуску."
      />

      {error ? <ErrorPanel error={error} /> : null}

      {balance ? (
        <>
          <RestBalanceGauge balance={balance} />

          <section className="space-y-3 rounded-sm border border-rule bg-paper-raised p-5">
            <h2 className="text-base">Подать рапорт на использование</h2>
            <ConsumptionRequestForm
              employeeId={session.employeeId}
              token={session.token}
              balanceDays={balance.balanceDays ?? 0}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-base">Журнал движений</h2>

            {movements.length === 0 ? (
              <EmptyState
                title="Движений нет"
                description="Первое начисление появится после того, как по утверждённому табелю будет оформлена компенсация в виде отдыха."
              />
            ) : (
              <Table caption="Движения баланса дополнительных суток отдыха">
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Вид</TableHead>
                    <TableHead className="text-right">Суток</TableHead>
                    <TableHead>Основание</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="font-mono text-xs">
                        {formatDate(movement.movementDate)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={movement.movementType} />
                        {reversedIds.has(movement.id) ? (
                          <span className="ml-2 text-xs text-signal">сторнировано</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {movement.movementType === "accrual" ? "+" : "−"}
                        {movement.amountDays.toLocaleString("ru-RU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-xs text-ink-muted">
                        {movement.reversalReason
                          ? `Сторно: ${movement.reversalReason}`
                          : movement.compensationLineId
                            ? "Компенсация за переработку"
                            : movement.leaveGrantId
                              ? "Присоединено к отпуску"
                              : "Отгул по рапорту"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
