/** FE033 — обёртки над эндпоинтами `leave`. */

import { apiClient, type RequestOptions } from "@/lib/api-client/client";

import type { LeaveGrant, LeaveType, RecallEvent } from "../schemas";

const BASE = "/leave";

export function getEmployeeGrants(
  employeeId: string,
  options?: RequestOptions,
): Promise<LeaveGrant[]> {
  return apiClient.get<LeaveGrant[]>(`${BASE}/employees/${employeeId}/grants`, options);
}

export function getGrant(grantId: string, options?: RequestOptions): Promise<LeaveGrant> {
  return apiClient.get<LeaveGrant>(`${BASE}/grants/${grantId}`, options);
}

export interface CreateGrantInput {
  employeeId: string;
  leaveType: LeaveType;
  periodStart: string;
  /** Исключающая граница. */
  periodEnd: string;
  attachedRestDays?: number;
}

export function createGrant(
  input: CreateGrantInput,
  context: RequestOptions & { idempotencyKey: string },
): Promise<LeaveGrant> {
  return apiClient.post<LeaveGrant>(`${BASE}/grants`, input, context);
}

export function recallFromLeave(
  grantId: string,
  input: { recallDate: string; effectiveFrom: string },
  context: RequestOptions & { idempotencyKey: string },
): Promise<RecallEvent> {
  return apiClient.post<RecallEvent>(`${BASE}/grants/${grantId}/recall`, input, context);
}
