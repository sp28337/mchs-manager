/** FE023 — обёртки над эндпоинтами `scheduling`. Покрыты все шесть. */

import { apiClient, type RequestOptions } from "@/lib/api-client/client";

import type { DutySchedule, DutyType, PlannedShift } from "../schemas";

const BASE = "/scheduling";

export function getSchedule(
  scheduleId: string,
  options?: RequestOptions,
): Promise<DutySchedule> {
  return apiClient.get<DutySchedule>(`${BASE}/duty-schedules/${scheduleId}`, options);
}

export function getUnitSchedules(
  unitId: string,
  period: { periodStart: string; periodEnd: string },
  options?: RequestOptions,
): Promise<DutySchedule[]> {
  return apiClient.get<DutySchedule[]>(`${BASE}/units/${unitId}/duty-schedules`, {
    ...options,
    query: { ...period },
  });
}

export interface CreateScheduleInput {
  unitId: string;
  periodType: DutySchedule["periodType"];
  periodStart: string;
  periodEnd: string;
}

export function createSchedule(
  input: CreateScheduleInput,
  context: RequestOptions & { idempotencyKey: string },
): Promise<DutySchedule> {
  return apiClient.post<DutySchedule>(`${BASE}/duty-schedules`, input, context);
}

export interface AddShiftInput {
  employeeId: string;
  startTime: string;
  endTime: string;
  dutyType: DutyType;
}

export function addPlannedShift(
  scheduleId: string,
  input: AddShiftInput,
  context: RequestOptions & { idempotencyKey: string },
): Promise<PlannedShift> {
  return apiClient.post<PlannedShift>(
    `${BASE}/duty-schedules/${scheduleId}/shifts`,
    input,
    context,
  );
}

export function approveSchedule(
  scheduleId: string,
  input: { approvalOrderRef: string },
  context: RequestOptions & { idempotencyKey: string },
): Promise<DutySchedule> {
  return apiClient.post<DutySchedule>(
    `${BASE}/duty-schedules/${scheduleId}/approve`,
    input,
    context,
  );
}

export function reviseSchedule(
  scheduleId: string,
  input: { reason: string },
  context: RequestOptions & { idempotencyKey: string },
): Promise<DutySchedule> {
  return apiClient.post<DutySchedule>(
    `${BASE}/duty-schedules/${scheduleId}/revise`,
    input,
    context,
  );
}
