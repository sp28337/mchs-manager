import type { Metadata } from "next";

import { DateRangePicker } from "@/components/shared/date-range-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { UnitDashboardFigures } from "@/features/time-accounting/components/unit-dashboard-figures";
import { getUnitDashboard } from "@/features/time-accounting/api/queries";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Сводка подразделения — Учёт служебного времени" };

/**
 * FE022 — сводный дашборд подразделения (UC-15).
 *
 * DoD: «агрегированные показатели совпадают с данными API». Совпадают
 * потому, что не пересчитываются: страница показывает то, что вернул
 * сервер, и ни одно число здесь не выводится заново. Пересчёт на клиенте
 * дал бы вторую версию тех же показателей, и расхождение между ними
 * никто бы не заметил.
 *
 * --- Подразделение берётся из области видимости сессии -------------------
 *
 * `unit_scope[]` токена, а не параметр адреса: командир видит своё
 * подразделение, и давать ему выбирать чужое в адресной строке значило бы
 * предложить получить 403 вручную. Если подразделений несколько — берётся
 * первое, пока нет переключателя (он появится с FE024).
 */
export default async function UnitDashboardPage({
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
        <PageHeader title="Сводка подразделения" />
        <EmptyState
          title="Подразделение не назначено"
          description="Область видимости учётной записи пуста: обратитесь к администратору системы, чтобы за вами закрепили подразделение."
        />
      </>
    );
  }

  let dashboard = null;
  let error: ApiError | null = null;
  try {
    dashboard = await getUnitDashboard(
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
        title="Сводка подразделения"
        description="Агрегированные показатели за учётный период по данным утверждённых табелей."
      />

      <DateRangePicker />

      {error ? <ErrorPanel error={error} /> : null}

      {dashboard ? (
        <UnitDashboardFigures dashboard={dashboard} />
      ) : !error ? (
        <EmptyState
          title="За период нет утверждённых табелей"
          description="Показатели собираются из утверждённых расчётов. Пока ни один табель периода не утверждён, собирать нечего."
        />
      ) : null}
    </>
  );
}
