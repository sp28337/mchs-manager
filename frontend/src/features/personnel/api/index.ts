/** Обёртки над эндпоинтами `personnel`. */

import { apiClient, type RequestOptions } from "@/lib/api-client/client";

import type { Employee, PageEnvelope } from "../schemas";

const BASE = "/personnel";

export function listEmployees(
  filters: { unitId?: string; page?: number; pageSize?: number } = {},
  options?: RequestOptions,
): Promise<PageEnvelope<Employee>> {
  return apiClient.get<PageEnvelope<Employee>>(`${BASE}/employees`, {
    ...options,
    query: {
      unitId: filters.unitId,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });
}
