/** Формы ответов `leave` (модуль LeaveManagement, фаза 10). */

export type LeaveType =
  | "basic"
  | "additional"
  | "personal_circumstances_20y"
  | "maternity"
  | "child_care"
  | "educational";

export type LeaveStatus = "active" | "recalled" | "completed" | "cancelled";

/**
 * Подписи видов отпуска. У каждого своё правовое основание, и оно указано
 * рядом: кадровик, выбирающий вид, выбирает норму, а не строку списка.
 */
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  basic: "Основной отпуск",
  additional: "Дополнительный отпуск",
  personal_circumstances_20y: "По личным обстоятельствам (выслуга 20+ лет)",
  maternity: "По беременности и родам",
  child_care: "По уходу за ребёнком",
  educational: "Учебный отпуск",
};

export const LEAVE_TYPE_BASIS: Record<LeaveType, string> = {
  basic: "ФЗ-141 ст. 58",
  additional: "ФЗ-141 ст. 59",
  personal_circumstances_20y: "ФЗ-141 ст. 64 ч. 1 п. 2 — один раз за службу",
  maternity: "ФЗ-141 ст. 56 ч. 1, ТК РФ",
  child_care: "ТК РФ ст. 256",
  educational: "ФЗ-141 ст. 60",
};

export interface LeaveGrant {
  id: string;
  employeeId: string;
  leaveType: LeaveType;
  periodStart: string;
  /** Граница ИСКЛЮЧАЮЩАЯ: отпуск по 20 марта включительно — `2026-03-21`. */
  periodEnd: string;
  status: LeaveStatus;
  entitlementBasisRuleVersionId: string;
  entitledDays: number;
  seniorityYears?: number | null;
  attachedRestDays: number;
  /**
   * Использованные и НЕИСПОЛЬЗОВАННЫЕ дни. Второе существеннее: инвариант
   * 9.1.3 запрещает «тихое» аннулирование остатка, и остаток, невидимый в
   * карточке, — ровно то молчание, которое инвариант запрещает.
   */
  usedDays: number;
  unusedDays: number;
}

export interface RecallEvent {
  id: string;
  leaveGrantId: string;
  recallDate: string;
  effectiveFrom: string;
  usedDays: number;
  unusedDays: number;
}
