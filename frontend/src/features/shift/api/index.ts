/** Обёртки над эндпоинтами `shift-accounting`. */

import { apiClient, type RequestOptions } from "@/lib/api-client/client";

import type {
  Absence,
  AbsenceKind,
  CalendarDay,
  DayType,
  Calculation,
  EmploymentKind,
  Gender,
  Profile,
  Reconciliation,
  WorkingConditions,
} from "../schemas";

const BASE = "/shift-accounting";

export interface RegisterInput {
  displayName: string;
  employmentKind: EmploymentKind;
  gender: Gender;
  workingConditions: WorkingConditions;
  northernLocality: boolean;
  disabilityGroupIorII: boolean;
  guardNumber: number;
  firstShiftDate: string;
}

export function registerProfile(
  input: RegisterInput,
  options?: RequestOptions,
): Promise<Profile> {
  return apiClient.post<Profile>(`${BASE}/profiles`, input, options);
}

export function getProfile(id: string, options?: RequestOptions): Promise<Profile> {
  return apiClient.get<Profile>(`${BASE}/profiles/${id}`, options);
}

export function listAbsences(id: string, options?: RequestOptions): Promise<Absence[]> {
  return apiClient.get<Absence[]>(`${BASE}/profiles/${id}/absences`, options);
}

export function addAbsence(
  id: string,
  input: { kind: AbsenceKind; startsOn: string; endsOn: string; note?: string },
  options?: RequestOptions,
): Promise<Absence> {
  return apiClient.post<Absence>(`${BASE}/profiles/${id}/absences`, input, options);
}

export function removeAbsence(
  id: string,
  absenceId: string,
  options?: RequestOptions,
): Promise<void> {
  return apiClient.delete<void>(`${BASE}/profiles/${id}/absences/${absenceId}`, options);
}

export function getCalendar(id: string, options?: RequestOptions): Promise<CalendarDay[]> {
  return apiClient.get<CalendarDay[]>(`${BASE}/profiles/${id}/calendar`, options);
}

/** Замещает личные правки целиком — см. `PUT` на сервере. */
export function setCalendar(
  id: string,
  days: { day: string; dayType: DayType }[],
  options?: RequestOptions,
): Promise<CalendarDay[]> {
  return apiClient.put<CalendarDay[]>(`${BASE}/profiles/${id}/calendar`, { days }, options);
}

export function getCalculation(
  id: string,
  period: { periodStart: string; periodEnd: string },
  options?: RequestOptions,
): Promise<Calculation> {
  return apiClient.get<Calculation>(`${BASE}/profiles/${id}/calculation`, {
    ...options,
    query: period,
  });
}

export function reconcile(
  id: string,
  input: {
    periodStart: string;
    periodEnd: string;
    normHours?: number | null;
    actualHours?: number | null;
    overtimeHours?: number | null;
  },
  options?: RequestOptions,
): Promise<Reconciliation> {
  return apiClient.put<Reconciliation>(`${BASE}/profiles/${id}/reconciliation`, input, options);
}
