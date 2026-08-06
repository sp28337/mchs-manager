/**
 * FE017 — обёртки над GET-эндпоинтами `time-accounting`.
 *
 * Функции чистые: принимают параметры и токен, возвращают данные. Они не
 * знают ни про TanStack Query, ни про React, и потому вызываются
 * одинаково из Server Component (где кеш не нужен) и из хука (где нужен).
 *
 * Разделение сделано ради первого случая. Страница «Мой табель» — Server
 * Component (DoD FE019: «отдаёт HTML со сводкой без лишнего JS»), и
 * тащить туда клиентский кеш означало бы отправить в браузер библиотеку
 * ради данных, которые уже отрисованы.
 */

import { apiClient, type RequestOptions } from "@/lib/api-client/client";

import type {
  HoursBreakdown,
  Timesheet,
  UnitTimesheetDashboard,
} from "../schemas";

const BASE = "/time-accounting";

export interface PeriodParams {
  periodStart: string;
  /** Граница ИСКЛЮЧАЮЩАЯ — как во всём API. */
  periodEnd: string;
}

export function getTimesheet(
  timesheetId: string,
  options?: RequestOptions,
): Promise<Timesheet> {
  return apiClient.get<Timesheet>(`${BASE}/timesheets/${timesheetId}`, options);
}

export function getTimesheetSummary(
  employeeId: string,
  period: PeriodParams,
  options?: RequestOptions,
): Promise<HoursBreakdown> {
  return apiClient.get<HoursBreakdown>(
    `${BASE}/employees/${employeeId}/timesheet-summary`,
    { ...options, query: { ...period } },
  );
}

export function getHoursBreakdownHistory(
  employeeId: string,
  paging: { page?: number; pageSize?: number } = {},
  options?: RequestOptions,
): Promise<HoursBreakdown[]> {
  return apiClient.get<HoursBreakdown[]>(
    `${BASE}/employees/${employeeId}/hours-breakdown-history`,
    { ...options, query: { page: paging.page, pageSize: paging.pageSize } },
  );
}

export function getUnitDashboard(
  unitId: string,
  period: PeriodParams,
  options?: RequestOptions,
): Promise<UnitTimesheetDashboard> {
  return apiClient.get<UnitTimesheetDashboard>(
    `${BASE}/units/${unitId}/timesheet-dashboard`,
    { ...options, query: { ...period } },
  );
}
