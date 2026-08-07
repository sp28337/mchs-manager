import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { getCalendarYear } from "@/features/service-calendar/api";
import { CalendarDayGridEditor } from "@/features/service-calendar/components/calendar-day-grid-editor";
import { CreateCalendarYearButton } from "@/features/service-calendar/components/create-calendar-year-button";
import { YearSwitcher } from "@/features/service-calendar/components/year-switcher";
import type { CalendarYear } from "@/features/service-calendar/schemas";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Производственный календарь — Учёт служебного времени",
};

/**
 * FE040 — производственный календарь года (UC-01).
 *
 * DoD: «после публикации редактор становится read-only».
 *
 * --- Почему год в адресе, а не в состоянии ------------------------------
 *
 * Календарь года — документ, а не вид. Ссылка на 2026 год обязана
 * открывать 2026, а не «последний просмотренный»: администратор,
 * обнаруживший ошибку в разметке майских, присылает юристу ссылку.
 */
export default async function ServiceCalendarYearPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  const { year: raw } = await params;
  const year = Number(raw);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return (
      <>
        <PageHeader title="Производственный календарь" />
        <EmptyState
          title="Год указан неверно"
          description="Календарь ведётся с 2000 по 2100 год. Проверьте адрес."
        />
      </>
    );
  }

  const editable = session.roles.includes("system_admin");

  let calendar: CalendarYear | null = null;
  let error: ApiError | null = null;
  try {
    calendar = await getCalendarYear(year, { token: session.token, cache: "no-store" });
  } catch (cause) {
    // 404 — «года ещё нет», и это не ошибка, а состояние: год заводится
    // администратором. Всё остальное — настоящий сбой.
    if (cause instanceof ApiError && cause.status !== 404) error = cause;
    else if (!(cause instanceof ApiError))
      error = new ApiError({
        type: "about:blank",
        title: "Сервер недоступен",
        status: 0,
        detail: "Не удалось получить производственный календарь.",
      });
  }

  return (
    <>
      <PageHeader
        eyebrow="Производственный календарь"
        title={String(year)}
        description="Тип каждого дня — вход алгоритма расчёта нормы: рабочий день умножает норму, предпраздничный вычитает из неё час, праздничный и выходной меняют классификацию часов (ТК РФ ст. 112 и 153)."
        actions={
          calendar ? (
            <StatusBadge
              status={calendar.published ? "published" : "draft"}
              label={calendar.published ? "Опубликован" : "Черновик"}
            />
          ) : null
        }
      />

      <YearSwitcher year={year} />

      {error ? <ErrorPanel error={error} /> : null}

      {!calendar && !error ? (
        <EmptyState
          title={`Календарь ${year} года не заведён`}
          description={
            editable
              ? "Заведите год, затем разметьте праздничные и предпраздничные дни по производственному календарю Российской Федерации."
              : "Календарь заводит администратор системы. До этого расчёт нормы за периоды этого года невозможен."
          }
          action={
            editable ? (
              <CreateCalendarYearButton year={year} token={session.token} />
            ) : null
          }
        />
      ) : null}

      {calendar ? (
        <CalendarDayGridEditor
          calendar={calendar}
          token={session.token}
          editable={editable}
        />
      ) : null}
    </>
  );
}
