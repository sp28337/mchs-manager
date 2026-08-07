import type { Metadata } from "next";
import { Suspense } from "react";

import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { listUnits } from "@/features/personnel/api";
import { UnitBrowser } from "@/features/personnel/components/unit-browser";
import type { Unit } from "@/features/personnel/schemas";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Подразделения — Учёт служебного времени" };

/**
 * FE038 — структура подразделений (UC-11).
 *
 * DoD: «дерево раскрывается/сворачивается».
 *
 * Список грузится на сервере целиком и передаётся в клиентский
 * обозреватель. Справочник подразделений конечен и мал — гарнизоны,
 * части, караулы, — а раскрытие ветви без сетевого запроса означает, что
 * дерево реагирует на клавишу мгновенно. Постраничная выдача дерева к
 * тому же бессмысленна: страница, разрезающая ветвь, оставляет потомков
 * без родителей.
 */
export default async function UnitsPage() {
  const session = await getServerSession();
  if (!session) return null;

  let units: Unit[] = [];
  let error: ApiError | null = null;

  try {
    units = await listUnits({}, { token: session.token, cache: "no-store" });
  } catch (cause) {
    error =
      cause instanceof ApiError
        ? cause
        : new ApiError({
            type: "about:blank",
            title: "Сервер недоступен",
            status: 0,
            detail: "Не удалось получить структуру подразделений.",
          });
  }

  return (
    <>
      <PageHeader
        title="Подразделения"
        description="Иерархия хранится как ltree-путь, поэтому «все части под этим гарнизоном» — один индексированный запрос, а переименование подразделения не переписывает пути подчинённых."
      />

      {error ? <ErrorPanel error={error} /> : null}

      {/* `useSearchParams` в обозревателе требует границы Suspense: без
          неё вся страница выпала бы из статической отрисовки. */}
      <Suspense fallback={<p className="text-sm text-ink-muted">Загрузка структуры…</p>}>
        <UnitBrowser units={units} unitScope={session.unitScope} />
      </Suspense>
    </>
  );
}
