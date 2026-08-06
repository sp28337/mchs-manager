/**
 * Формы ответов `time-accounting`.
 *
 * --- Почему не только сгенерированные типы -----------------------------
 *
 * `schema.d.ts` описывает `openapi.yaml`, а реализация местами богаче —
 * каждое расхождение осознано и перечислено в контрактном тесте бэкенда
 * (`tests/contract/test_openapi_conformance.py`). Для `HoursBreakdown`
 * таких полей пять, и все они существенны:
 *
 * * `weekendHours` — результат Алгоритма Е. Спецификация про выходные
 *   молчит вовсе, а компенсация за работу в выходной (ТК РФ ст. 153)
 *   без этого поля неописуема;
 * * `underworkedExplainedHours` — часть недоработки, объяснённая
 *   больничным или командировкой. Без разделения «недоработал» звучит
 *   как обвинение;
 * * `computedFromLegalBase` — ФЗ-141 или ТК РФ. Нормы разные, и не
 *   показать, по какой считали, значит показать число без смысла;
 * * `computedInTimeZone` — ночные часы считаются в часовом поясе
 *   ПОДРАЗДЕЛЕНИЯ (ТК РФ ст. 96), и в Москве их 4, а во Владивостоке за
 *   ту же смену 1;
 * * `computedAt` — момент расчёта.
 *
 * Поэтому здесь объявлен собственный тип. Он ШИРЕ сгенерированного, а не
 * противоречит ему: всё, что обещает спецификация, в нём есть.
 */

import type { HoursBreakdown as SpecHoursBreakdown } from "@/lib/api-client/types";

/** Числа приходят JSON-числами; часы — `Decimal` на сервере. */
export interface HoursBreakdown extends SpecHoursBreakdown {
  weekendHours: number;
  underworkedExplainedHours: number;
  computedFromLegalBase: "fps_service" | "labor_code" | (string & {});
  computedInTimeZone: string;
}

export type TimesheetStatus = "open" | "pending_approval" | "approved" | "reopened";

export type ServiceTimeEventType =
  | "actual_shift"
  | "sickness"
  | "suspension"
  | "overtime_attraction"
  | "business_trip";

/** Подписи типов фактов — язык табеля, а не перечисления. */
export const EVENT_TYPE_LABELS: Record<ServiceTimeEventType, string> = {
  actual_shift: "Фактическое дежурство",
  sickness: "Временная нетрудоспособность",
  suspension: "Отстранение от службы",
  overtime_attraction: "Привлечение сверх нормы",
  business_trip: "Служебная командировка",
};

export interface ServiceTimeEvent {
  id: string;
  timesheetId: string;
  eventType: ServiceTimeEventType;
  startTime: string;
  endTime: string;
  overtimeOrderId?: string | null;
  businessTripPlace?: string | null;
}

export interface Timesheet {
  id: string;
  employeeId: string;
  periodType: "month" | "quarter" | "half_year" | "year";
  periodStart: string;
  periodEnd: string;
  status: TimesheetStatus;
  events: ServiceTimeEvent[];
  approvedAt?: string | null;
  approvedBy?: string | null;
}

export interface UnitTimesheetDashboard {
  unitId: string;
  periodStart: string;
  periodEnd: string;
  totalEmployees: number;
  totalOvertimeHours: number;
  totalUnderworkedHours: number;
  pendingApprovalCount: number;
}

export interface CorrectionEntry {
  id: string;
  timesheetId: string;
  originalEventId: string;
  reason: string;
  createdAt: string;
  createdBy: string;
}
