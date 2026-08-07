import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { listUnits } from "@/features/personnel/api";
import type { Unit } from "@/features/personnel/schemas";
import { getServerSession } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Прогноз затрат — Учёт служебного времени" };

/**
 * Вход в прогноз затрат из меню.
 *
 * Прогноз строится ПО ПОДРАЗДЕЛЕНИЮ, поэтому страницы «прогноз вообще» не
 * существует. Когда область видимости состоит из одного подразделения —
 * а у начальника части это так всегда, — выбирать не из чего, и лишний
 * экран между пунктом меню и данными был бы просто препятствием.
 *
 * Когда подразделений несколько (руководитель территориального органа),
 * выбор показывается: угадать, какое из них имелось в виду, нельзя.
 */
export default async function ForecastEntryPage() {
  const session = await getServerSession();
  if (!session) return null;

  const scope = session.unitScope;

  if (scope.length === 1) {
    redirect(`/compensation/regions/${scope[0]}/forecast`);
  }

  if (scope.length === 0) {
    return (
      <>
        <PageHeader title="Прогноз затрат" />
        <EmptyState
          title="Подразделение не назначено"
          description="Область видимости учётной записи пуста: обратитесь к администратору системы."
        />
      </>
    );
  }

  const units: Unit[] = await listUnits({}, { token: session.token, cache: "no-store" }).catch(
    () => [],
  );
  const byId = new Map(units.map((unit) => [unit.id, unit]));

  return (
    <>
      <PageHeader
        title="Прогноз затрат"
        description="Прогноз строится по подразделению. Выберите, по какому из доступных вам."
      />

      <ul className="max-w-xl divide-y divide-rule border-y border-rule">
        {scope.map((unitId) => {
          const unit = byId.get(unitId);
          return (
            <li key={unitId}>
              <Link
                href={`/compensation/regions/${unitId}/forecast`}
                className="flex items-baseline justify-between gap-4 py-3 hover:bg-paper-sunken"
              >
                <span>{unit?.name ?? "Подразделение"}</span>
                <span className="font-mono text-xs text-ink-faint">
                  {unit?.code ?? unitId}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
