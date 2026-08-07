/** FE027 — обёртки над эндпоинтами `compensation`. */

import { apiClient, type RequestOptions } from "@/lib/api-client/client";

import type {
  CompensationCase,
  CompensationForm,
  HourCategory,
  RegionalForecast,
} from "../schemas";

const BASE = "/compensation";

export function getCase(caseId: string, options?: RequestOptions): Promise<CompensationCase> {
  return apiClient.get<CompensationCase>(`${BASE}/cases/${caseId}`, options);
}

export function getEmployeeHistory(
  employeeId: string,
  paging: { page?: number; pageSize?: number } = {},
  options?: RequestOptions,
): Promise<CompensationCase[]> {
  return apiClient.get<CompensationCase[]>(`${BASE}/employees/${employeeId}/history`, {
    ...options,
    query: { page: paging.page, pageSize: paging.pageSize },
  });
}

export function getRegionalForecast(
  regionUnitId: string,
  period: { periodStart: string; periodEnd: string },
  options?: RequestOptions,
): Promise<RegionalForecast> {
  return apiClient.get<RegionalForecast>(`${BASE}/regions/${regionUnitId}/forecast`, {
    ...options,
    query: { ...period },
  });
}

export function recordElection(
  caseId: string,
  input: { hourCategory: HourCategory; compensationForm: CompensationForm },
  context: RequestOptions & { idempotencyKey: string },
): Promise<CompensationCase> {
  return apiClient.post<CompensationCase>(`${BASE}/cases/${caseId}/elections`, input, context);
}

export function finalizeCase(
  caseId: string,
  context: RequestOptions & { idempotencyKey: string },
): Promise<CompensationCase> {
  return apiClient.post<CompensationCase>(`${BASE}/cases/${caseId}/finalize`, undefined, context);
}
