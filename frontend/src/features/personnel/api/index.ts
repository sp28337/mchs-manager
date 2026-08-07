/** FE035 — обёртки над эндпоинтами `personnel`. */

import { apiClient, type RequestOptions } from "@/lib/api-client/client";

import type { Employee, PageEnvelope, ServiceRecordEntry, Unit } from "../schemas";

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

export function getEmployee(
  employeeId: string,
  options?: RequestOptions,
): Promise<Employee> {
  return apiClient.get<Employee>(`${BASE}/employees/${employeeId}`, options);
}

export function getServiceRecord(
  employeeId: string,
  options?: RequestOptions,
): Promise<ServiceRecordEntry[]> {
  return apiClient.get<ServiceRecordEntry[]>(
    `${BASE}/employees/${employeeId}/service-record-entries`,
    options,
  );
}

/**
 * Плоский список подразделений, упорядоченный по ltree-пути.
 *
 * `rootUnitId` сужает выдачу до поддерева. Дерево на клиенте собирается
 * из этого порядка за один проход — родитель гарантированно идёт раньше
 * потомка (см. `buildUnitTree`).
 */
export function listUnits(
  filters: { rootUnitId?: string } = {},
  options?: RequestOptions,
): Promise<Unit[]> {
  return apiClient.get<Unit[]>(`${BASE}/units`, {
    ...options,
    query: { rootUnitId: filters.rootUnitId },
  });
}

export function getUnit(unitId: string, options?: RequestOptions): Promise<Unit> {
  return apiClient.get<Unit>(`${BASE}/units/${unitId}`, options);
}
