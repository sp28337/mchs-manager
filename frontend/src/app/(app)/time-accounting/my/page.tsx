import type { Metadata } from "next";

import { DateRangePicker } from "@/components/shared/date-range-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { HoursBreakdownCard } from "@/features/time-accounting/components/hours-breakdown-card";
import { getTimesheetSummary } from "@/features/time-accounting/api/queries";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatPeriod } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Мой табель — Учёт служебного времени" };

/**
 * FE019 — «Мой табель» (UC-13).
 *
 * DoD: «Server Component отдаёт HTML со сводкой без лишнего JS».
 *
 * --- Почему без клиентского кеша ----------------------------------------
 *
 * Сводка запрашивается прямо здесь, на сервере, и уходит человеку готовой
 * разметкой. Клиентский кеш добавил бы к странице библиотеку запросов и
 * повторный поход за теми же данными — ради экрана, который человек
 * открывает раз в день и не обновляет вживую.
 *
 * Интерактивных островов на странице два, и оба маленькие: выбор периода
 * (правит адрес) и подсказки правового следа.
 *
 * --- Период в адресе -----------------------------------------------------
 *
 * Не в состоянии компонента: сотрудник, увидевший расхождение за март,
 * должен иметь возможность прислать командиру ССЫЛКУ. По умолчанию —
 * текущий месяц.
 */

function currentMonth(): { periodStart: string; periodEnd: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

export default async function MyTimesheetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  const params = await searchParams;
  const fallback = currentMonth();
  const periodStart =
    typeof params.periodStart === "string" ? params.periodStart : fallback.periodStart;
  const periodEnd =
    typeof params.periodEnd === "string" ? params.periodEnd : fallback.periodEnd;

  let breakdown = null;
  let error: ApiError | null = null;

  try {
    breakdown = await getTimesheetSummary(
      session.employeeId,
      { periodStart, periodEnd },
      { token: session.token, cache: "no-store" },
    );
  } catch (cause) {
    // 404 — не ошибка: за период просто нет утверждённого расчёта, и это
    // обычное состояние в середине месяца. Всё остальное — настоящий
    // отказ, и его надо показать.
    if (cause instanceof ApiError && cause.status !== 404) error = cause;
    else if (!(cause instanceof ApiError)) {
      error = new ApiError({
        type: "about:blank",
        title: "Сервер недоступен",
        status: 0,
        detail: "Не удалось получить сводку. Проверьте соединение и обновите страницу.",
      });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={session.fullName}
        title="Мой табель"
        period={formatPeriod(periodStart, periodEnd)}
        description="Сводка служебного времени за учётный период по данным утверждённого расчёта."
      />

      <DateRangePicker />

      {error ? <ErrorPanel error={error} /> : null}

      {breakdown ? (
        <HoursBreakdownCard breakdown={breakdown} />
      ) : !error ? (
        <EmptyState
          title="Расчёт за период ещё не утверждён"
          description={
            "Сводка появляется после того, как табельщик закроет период, а командир " +
            "утвердит табель. До этого момента показывать нечего: незакрытый расчёт " +
            "не окончателен и может измениться."
          }
        />
      ) : null}
    </>
  );
}
