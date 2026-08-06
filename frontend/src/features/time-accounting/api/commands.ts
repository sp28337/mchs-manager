/**
 * FE018 — обёртки над командами `time-accounting`.
 *
 * У каждой обязателен `idempotencyKey`, и он приходит СНАРУЖИ, а не
 * создаётся здесь. Причина та же, что в `api-client`: ключ, созданный
 * внутри команды, менялся бы при каждом повторе — то есть означал бы «это
 * другая операция», ровно наоборот тому, ради чего заголовок существует.
 *
 * Отсюда тип `Command<T>`: подпись не даёт вызвать команду, забыв ключ.
 */

import { apiClient, type RequestOptions } from "@/lib/api-client/client";

import type { CorrectionEntry, ServiceTimeEvent, ServiceTimeEventType, Timesheet } from "../schemas";

const BASE = "/time-accounting";

export interface CommandContext extends RequestOptions {
  idempotencyKey: string;
}

export interface CreateTimesheetInput {
  employeeId: string;
  periodType: Timesheet["periodType"];
  periodStart: string;
  periodEnd: string;
}

export function createTimesheet(
  input: CreateTimesheetInput,
  context: CommandContext,
): Promise<Timesheet> {
  return apiClient.post<Timesheet>(`${BASE}/timesheets`, input, context);
}

export interface RegisterEventInput {
  eventType: ServiceTimeEventType;
  startTime: string;
  endTime: string;
  /** Обязателен для `overtime_attraction` — иначе сервер ответит 422. */
  overtimeOrderId?: string;
  /** Обязателен для `business_trip`. */
  businessTripPlace?: string;
}

export function registerEvent(
  timesheetId: string,
  input: RegisterEventInput,
  context: CommandContext,
): Promise<ServiceTimeEvent> {
  return apiClient.post<ServiceTimeEvent>(
    `${BASE}/timesheets/${timesheetId}/events`,
    input,
    context,
  );
}

export function correctEvent(
  timesheetId: string,
  input: { originalEventId: string; reason: string },
  context: CommandContext,
): Promise<CorrectionEntry> {
  return apiClient.post<CorrectionEntry>(
    `${BASE}/timesheets/${timesheetId}/corrections`,
    input,
    context,
  );
}

export function approveTimesheet(
  timesheetId: string,
  context: CommandContext,
): Promise<Timesheet> {
  return apiClient.post<Timesheet>(
    `${BASE}/timesheets/${timesheetId}/approve`,
    undefined,
    context,
  );
}

export function reopenTimesheet(
  timesheetId: string,
  input: { reason: string },
  context: CommandContext,
): Promise<Timesheet> {
  return apiClient.post<Timesheet>(
    `${BASE}/timesheets/${timesheetId}/reopen`,
    input,
    context,
  );
}
