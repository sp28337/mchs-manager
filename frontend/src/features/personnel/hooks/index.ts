"use client";

/**
 * FE035 — query-хуки `personnel`.
 *
 * Модуль справочный: единственные мутации (создание подразделения,
 * регистрация сотрудника) в этих экранах не участвуют, поэтому здесь
 * только чтение. Ключи, как везде, начинаются с имени модуля.
 *
 * --- Про `staleTime` ----------------------------------------------------
 *
 * Справочник подразделений меняется приказом о реорганизации, то есть
 * раз в годы, а не в минуты. Держать его свежесть по умолчанию (ноль)
 * значило бы перезапрашивать дерево при каждом возврате фокуса в окно —
 * трафик ради данных, которые не изменились. Пять минут — компромисс,
 * заметный только тому, кто сам это подразделение и создал.
 */

import { useQuery } from "@tanstack/react-query";

import type { ApiError } from "@/lib/api-client/client";

import { getEmployee, getServiceRecord, getUnit, listEmployees, listUnits } from "../api";
import type { Employee, PageEnvelope, ServiceRecordEntry, Unit } from "../schemas";

const MODULE = "personnel" as const;

const REFERENCE_DATA_STALE_MS = 5 * 60 * 1000;

export const personnelKeys = {
  all: [MODULE] as const,
  employees: (unitId: string | undefined, page: number, pageSize: number) =>
    [MODULE, "employees", unitId ?? "all", page, pageSize] as const,
  employee: (id: string) => [MODULE, "employee", id] as const,
  serviceRecord: (employeeId: string) => [MODULE, "service-record", employeeId] as const,
  units: (rootUnitId: string | undefined) => [MODULE, "units", rootUnitId ?? "all"] as const,
  unit: (id: string) => [MODULE, "unit", id] as const,
};

export function useEmployeesQuery(
  filters: { unitId?: string; page?: number; pageSize?: number },
  token?: string | null,
) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;

  return useQuery<PageEnvelope<Employee>, ApiError>({
    queryKey: personnelKeys.employees(filters.unitId, page, pageSize),
    queryFn: () => listEmployees({ ...filters, page, pageSize }, { token }),
    // Предыдущая страница остаётся на экране, пока грузится следующая:
    // таблица, схлопывающаяся в пустоту на каждом «Вперёд», сбрасывает
    // прокрутку и заставляет искать место заново.
    placeholderData: (previous) => previous,
  });
}

export function useEmployeeQuery(employeeId: string, token?: string | null) {
  return useQuery<Employee, ApiError>({
    queryKey: personnelKeys.employee(employeeId),
    queryFn: () => getEmployee(employeeId, { token }),
  });
}

export function useServiceRecordQuery(employeeId: string, token?: string | null) {
  return useQuery<ServiceRecordEntry[], ApiError>({
    queryKey: personnelKeys.serviceRecord(employeeId),
    queryFn: () => getServiceRecord(employeeId, { token }),
  });
}

export function useUnitsQuery(rootUnitId?: string, token?: string | null) {
  return useQuery<Unit[], ApiError>({
    queryKey: personnelKeys.units(rootUnitId),
    queryFn: () => listUnits({ rootUnitId }, { token }),
    staleTime: REFERENCE_DATA_STALE_MS,
  });
}

export function useUnitQuery(unitId: string, token?: string | null) {
  return useQuery<Unit, ApiError>({
    queryKey: personnelKeys.unit(unitId),
    queryFn: () => getUnit(unitId, { token }),
    staleTime: REFERENCE_DATA_STALE_MS,
  });
}
