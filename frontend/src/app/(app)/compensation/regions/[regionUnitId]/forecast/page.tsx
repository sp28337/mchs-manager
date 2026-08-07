import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getRegionalForecast } from "@/features/compensation/api";
import {
  ForecastChart,
  type ForecastPoint,
} from "@/features/compensation/components/forecast-chart";
import type { RegionalForecast } from "@/features/compensation/schemas";
import { getUnit } from "@/features/personnel/api";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatMoment, formatPeriod } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Прогноз затрат — Учёт служебного времени" };

/** Сколько месяцев показывать. Год — период, за который сравнивают бюджет. */
const MONTHS = 12;

function monthsBack(count: number): { periodStart: string; periodEnd: string }[] {
  const now = new Date();
  const periods: { periodStart: string; periodEnd: string }[] = [];

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    periods.push({
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
    });
  }
  return periods;
}

/**
 * FE030 — прогноз затрат по региону (UC-08).
 *
 * --- Пропуск не равен нулю ----------------------------------------------
 *
 * Проекция строится ночной задачей, и 404 по периоду означает «прогноз не
 * построен», а не «затрат нет». Это различие проведено насквозь: в
 * таблице стоит прочерк, в диаграмме — штриховка, и ни одно из
 * отсутствующих значений не участвует в итогах. Показать финансисту ноль
 * там, где данных нет, значит дать ему цифру, на которую он сошлётся.
 *
 * --- Почему это два числа, а не одна сумма в рублях ---------------------
 *
 * Прогноз даёт часы под денежную компенсацию и сутки отдыха раздельно, и
 * свести их в рубли здесь нельзя: размер выплаты считается от оклада
 * конкретного сотрудника (Приказ МЧС России от 27.06.2024 № 539 п. 104),
 * а сутки отдыха бюджет не расходуют вовсе — они расходуют людей.
 * Умножить часы на «средний оклад» значило бы выдать оценку за расчёт.
 */
export default async function RegionalForecastPage({
  params,
}: {
  params: Promise<{ regionUnitId: string }>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  const { regionUnitId } = await params;
  const periods = monthsBack(MONTHS);

  const unit = await getUnit(regionUnitId, {
    token: session.token,
    cache: "no-store",
  }).catch(() => null);

  // Отсутствие прогноза за месяц — обычное дело (ночная задача ещё не
  // отработала, дел не было), поэтому 404 гасится здесь, а не роняет
  // страницу. Всё остальное — настоящая ошибка, и она видна.
  let error: ApiError | null = null;

  const results = await Promise.all(
    periods.map(async (period): Promise<RegionalForecast | null> => {
      try {
        return await getRegionalForecast(regionUnitId, period, {
          token: session.token,
          cache: "no-store",
        });
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) return null;
        if (cause instanceof ApiError) error = cause;
        return null;
      }
    }),
  );

  const points: ForecastPoint[] = periods.map((period, index) => {
    const row = results[index];
    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      label: formatPeriod(period.periodStart, period.periodEnd),
      shortLabel: `${period.periodStart.slice(5, 7)}.${period.periodStart.slice(2, 4)}`,
      monetaryHours: row ? Number(row.forecastMonetaryHours) : null,
      restDays: row ? Number(row.forecastRestDays) : null,
    };
  });

  const built = results.filter((row): row is RegionalForecast => row !== null);
  const latest = built.at(-1) ?? null;

  const totals = built.reduce(
    (accumulator, row) => ({
      hours: accumulator.hours + Number(row.forecastMonetaryHours),
      days: accumulator.days + Number(row.forecastRestDays),
      cases: accumulator.cases + row.caseCount,
    }),
    { hours: 0, days: 0, cases: 0 },
  );

  return (
    <>
      <PageHeader
        eyebrow={unit ? `${unit.name} (${unit.code})` : `Подразделение ${regionUnitId}`}
        title="Прогноз затрат на компенсации"
        description="Строится ночной задачей по финализированным делам. Часы под денежную компенсацию и сутки отдыха показаны раздельно: свести их в одну сумму нельзя — выплата считается от оклада сотрудника, а сутки отдыха бюджет не расходуют."
      />

      {error ? <ErrorPanel error={error} /> : null}

      {built.length === 0 ? (
        <EmptyState
          title="Прогноз не построен"
          description="За последние 12 месяцев проекция не содержит ни одного периода. Это не значит, что затрат нет: либо финализированных дел не было, либо ночная задача ещё не отрабатывала."
        />
      ) : (
        <>
          <section aria-labelledby="forecast-latest" className="space-y-3">
            <h2
              id="forecast-latest"
              className="font-display text-sm font-bold uppercase tracking-wide text-ink-muted"
            >
              Последний построенный период
            </h2>

            {latest ? (
              <div className="flex flex-wrap gap-x-10 gap-y-4">
                <Figure
                  value={Number(latest.forecastMonetaryHours).toLocaleString("ru-RU", {
                    maximumFractionDigits: 1,
                  })}
                  unit="ч"
                  caption="Под денежную компенсацию"
                />
                <Figure
                  value={Number(latest.forecastRestDays).toLocaleString("ru-RU", {
                    maximumFractionDigits: 1,
                  })}
                  unit="сут"
                  caption="Дополнительное время отдыха"
                />
                <Figure
                  value={String(latest.employeeCount)}
                  unit="чел."
                  caption="Сотрудников в расчёте"
                />
                <Figure value={String(latest.caseCount)} unit="дел" caption="Дел учтено" />
              </div>
            ) : null}

            {latest ? (
              <p className="text-xs text-ink-muted">
                {formatPeriod(latest.periodStart, latest.periodEnd)} · проекция построена{" "}
                {formatMoment(latest.computedAt, unit?.timeZone ?? "Europe/Moscow")} (
                {unit?.timeZone ?? "Europe/Moscow"})
              </p>
            ) : null}
          </section>

          <section aria-labelledby="forecast-chart" className="space-y-3">
            <h2
              id="forecast-chart"
              className="font-display text-sm font-bold uppercase tracking-wide text-ink-muted"
            >
              Динамика за 12 месяцев
            </h2>
            <ForecastChart points={points} />
          </section>

          <section aria-labelledby="forecast-table" className="space-y-3">
            <h2
              id="forecast-table"
              className="font-display text-sm font-bold uppercase tracking-wide text-ink-muted"
            >
              Периоды
            </h2>

            <Table caption="Прогноз затрат по периодам">
              <TableHeader>
                <TableRow>
                  <TableHead>Период</TableHead>
                  <TableHead className="text-right">Часов под выплату</TableHead>
                  <TableHead className="text-right">Суток отдыха</TableHead>
                  <TableHead className="text-right">Сотрудников</TableHead>
                  <TableHead className="text-right">Дел</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period, index) => {
                  const row = results[index];
                  return (
                    <TableRow key={period.periodStart}>
                      <TableCell>
                        {formatPeriod(period.periodStart, period.periodEnd)}
                      </TableCell>
                      {row ? (
                        <>
                          <TableCell className="text-right font-mono">
                            {Number(row.forecastMonetaryHours).toLocaleString("ru-RU", {
                              maximumFractionDigits: 2,
                            })}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {Number(row.forecastRestDays).toLocaleString("ru-RU", {
                              maximumFractionDigits: 2,
                            })}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {row.employeeCount}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {row.caseCount}
                          </TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={4} className="text-right text-xs text-ink-faint">
                          прогноз не построен
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <p className="text-sm text-ink-muted">
              Итого по {built.length}{" "}
              {built.length === 1 ? "построенному периоду" : "построенным периодам"}:{" "}
              <span className="font-mono">
                {totals.hours.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
              </span>{" "}
              ч под выплату,{" "}
              <span className="font-mono">
                {totals.days.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
              </span>{" "}
              сут отдыха, <span className="font-mono">{totals.cases}</span> дел. Периоды без
              прогноза в сумму не входят.
            </p>
          </section>
        </>
      )}
    </>
  );
}

function Figure({
  value,
  unit,
  caption,
}: {
  value: string;
  unit: string;
  caption: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-3xl leading-none">
        {value}
        <span className="ml-1 text-base text-ink-muted">{unit}</span>
      </p>
      <p className="text-xs text-ink-muted">{caption}</p>
    </div>
  );
}
