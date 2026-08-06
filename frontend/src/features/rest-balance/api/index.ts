/** FE031 — обёртки над эндпоинтами `rest-balance`. */

import { apiClient, type RequestOptions } from "@/lib/api-client/client";

import type { BalanceMovement, RestBalance } from "../schemas";

const BASE = "/rest-balance";

export function getBalance(
  employeeId: string,
  asOf?: string,
  options?: RequestOptions,
): Promise<RestBalance> {
  return apiClient.get<RestBalance>(`${BASE}/employees/${employeeId}/balance`, {
    ...options,
    query: asOf ? { asOf } : undefined,
  });
}

export function getMovements(
  employeeId: string,
  paging: { page?: number; pageSize?: number } = {},
  options?: RequestOptions,
): Promise<BalanceMovement[]> {
  return apiClient.get<BalanceMovement[]>(`${BASE}/employees/${employeeId}/movements`, {
    ...options,
    query: { page: paging.page, pageSize: paging.pageSize },
  });
}

export interface ConsumptionInput {
  amountDays: number;
  movementDate: string;
  leaveGrantId?: string;
}

export function requestConsumption(
  employeeId: string,
  input: ConsumptionInput,
  context: RequestOptions & { idempotencyKey: string },
): Promise<BalanceMovement> {
  return apiClient.post<BalanceMovement>(
    `${BASE}/employees/${employeeId}/consumption-requests`,
    input,
    context,
  );
}
