import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { getEmployee, getServiceRecord, getUnit } from "@/features/personnel/api";
import { ServiceRecordTimeline } from "@/features/personnel/components/service-record-timeline";
import {
  EMPLOYMENT_STATUS_LABELS,
  LEGAL_BASE_LABELS,
  SERVICE_CONDITION_LABELS,
  type ServiceRecordEntry,
  type Unit,
} from "@/features/personnel/schemas";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Карточка сотрудника — Учёт служебного времени" };

/**
 * FE037 — карточка сотрудника (UC-11).
 *
 * DoD: «карточка показывает историю службы».
 *
 * --- Про выслугу --------------------------------------------------------
 *
 * Полных лет службы здесь НЕ показано, хотя число напрашивается: от
 * выслуги зависит продолжительность основного отпуска (Приказ МЧС № 410,
 * ФЗ-141 ст. 63). Причина в том, что выслуга по ст. 38 складывается не
 * только из службы в этой должности: в неё входят военная служба, служба
 * в других органах, учёба — периоды, которых карточка сотрудника не
 * знает. Разница между `hiredAt` и сегодняшним днём — это стаж В ЭТОМ
 * подразделении, и подписать его словом «выслуга» значило бы дать
 * кадровику число, на которое он сошлётся в приказе.
 *
 * Там, где выслуга всё же нужна для расчёта (предоставление отпуска), она
 * приходит с сервера отдельным полем и подписана как допущение.
 *
 * --- Чего здесь нет и почему --------------------------------------------
 *
 * Ссылок на баланс суток отдыха, отпуска и компенсации ЭТОГО сотрудника.
 * Соблазн очевиден — карточка для того и открыта, — но экраны
 * `/rest-balance/my`, `/leave/my` и `/compensation/my` показывают данные
 * ВЛАДЕЛЬЦА СЕССИИ и параметр в адресе не читают. Ссылка отсюда открыла
 * бы кадровику его собственный баланс под чужой фамилией — худший из
 * возможных исходов, потому что выглядит он правдоподобно.
 *
 * Сделать эти экраны параметрическими нельзя мимоходом: «кто вправе
 * видеть чужой баланс» — вопрос авторизации, которой в системе пока нет
 * вовсе. Ссылки появятся вместе с ней.
 */
export default async function EmployeeCardPage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  const { employeeId } = await params;

  let employee: Awaited<ReturnType<typeof getEmployee>>;
  try {
    employee = await getEmployee(employeeId, { token: session.token, cache: "no-store" });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) notFound();
    return (
      <>
        <PageHeader title="Карточка сотрудника" />
        <ErrorPanel
          error={
            cause instanceof ApiError
              ? cause
              : new ApiError({
                  type: "about:blank",
                  title: "Сервер недоступен",
                  status: 0,
                  detail: "Не удалось получить карточку сотрудника.",
                })
          }
        />
      </>
    );
  }

  // История службы и подразделение — независимые запросы, и ни один из
  // них не должен ронять страницу: карточка полезна и без ленты.
  const [record, unit] = await Promise.all([
    getServiceRecord(employeeId, { token: session.token, cache: "no-store" }).catch(
      (): ServiceRecordEntry[] => [],
    ),
    getUnit(employee.currentUnitId, { token: session.token, cache: "no-store" }).catch(
      (): Unit | null => null,
    ),
  ]);

  const timeZone = unit?.timeZone ?? "Europe/Moscow";

  return (
    <>
      <PageHeader
        eyebrow={`Табельный № ${employee.personnelNumber}`}
        title={employee.fullName}
        description={employee.rank}
        actions={
          <StatusBadge
            status={employee.employmentStatus}
            label={EMPLOYMENT_STATUS_LABELS[employee.employmentStatus]}
          />
        }
      />

      <section aria-labelledby="employee-facts" className="space-y-3">
        <h2 id="employee-facts" className="font-display text-sm font-bold uppercase tracking-wide text-ink-muted">
          Служебное положение
        </h2>

        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-[auto_1fr] sm:max-w-2xl">
          <dt className="text-sm text-ink-muted">Подразделение</dt>
          <dd className="text-sm">
            {unit ? (
              <Link
                href={`/personnel/units?unitId=${unit.id}`}
                className="text-trace underline underline-offset-2"
              >
                {unit.name} ({unit.code})
              </Link>
            ) : (
              <span className="font-mono text-xs">{employee.currentUnitId}</span>
            )}
          </dd>

          <dt className="text-sm text-ink-muted">Часовой пояс подразделения</dt>
          <dd className="font-mono text-xs">{timeZone}</dd>

          <dt className="text-sm text-ink-muted">Основание прохождения службы</dt>
          <dd className="text-sm">
            {LEGAL_BASE_LABELS[employee.legalBase] ?? employee.legalBase}
          </dd>

          {employee.serviceConditionCategory ? (
            <>
              <dt className="text-sm text-ink-muted">Условия службы</dt>
              <dd className="text-sm">
                {SERVICE_CONDITION_LABELS[employee.serviceConditionCategory] ??
                  employee.serviceConditionCategory}
              </dd>
            </>
          ) : null}

          <dt className="text-sm text-ink-muted">Принят на службу</dt>
          <dd className="font-mono text-sm">{formatDate(employee.hiredAt)}</dd>

          {employee.dismissedAt ? (
            <>
              <dt className="text-sm text-ink-muted">Уволен</dt>
              <dd className="font-mono text-sm">{formatDate(employee.dismissedAt)}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="service-record" className="space-y-3">
        <h2
          id="service-record"
          className="font-display text-sm font-bold uppercase tracking-wide text-ink-muted"
        >
          История прохождения службы
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">
          Записи не изменяются и не удаляются: ошибка исправляется следующей
          записью, и обе остаются видны. На этих датах строится выслуга (ФЗ-141
          ст. 38), от которой зависит продолжительность отпуска.
        </p>
        <ServiceRecordTimeline entries={record} timeZone={timeZone} />
      </section>
    </>
  );
}
