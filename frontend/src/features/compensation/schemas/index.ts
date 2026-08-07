/** Формы ответов `compensation` (модуль Compensation, фаза 8). */

export type HourCategory = "night" | "holiday" | "weekend" | "overtime";
export type CompensationForm = "monetary" | "additional_rest_time";
export type CaseStatus = "draft" | "finalized";

export const HOUR_CATEGORY_LABELS: Record<HourCategory, string> = {
  night: "Ночные часы",
  holiday: "Праздничные часы",
  weekend: "Выходные часы",
  overtime: "Переработка",
};

/**
 * Правовое основание по категории. Разные нормы, и это существенно:
 * Приказ МЧС России № 410 п. 14 исключает ночные, праздничные и выходные
 * часы сменного состава из компенсации вовсе, а п. 11 даёт их
 * пятидневному режиму. Одна строка «компенсация» скрывала бы это
 * различие.
 */
export const HOUR_CATEGORY_BASIS: Record<HourCategory, string> = {
  night: "Приказ № 410 п. 11 (ТК РФ ст. 96)",
  holiday: "Приказ № 410 п. 11 (ТК РФ ст. 112)",
  weekend: "Приказ № 410 п. 11 (ТК РФ ст. 153)",
  overtime: "Приказ № 410 пп. 10-11",
};

export const COMPENSATION_FORM_LABELS: Record<CompensationForm, string> = {
  monetary: "Денежная компенсация",
  additional_rest_time: "Дополнительное время отдыха",
};

export interface CompensationLine {
  id: string;
  hourCategory: HourCategory;
  hoursAmount: number;
  compensationForm: CompensationForm;
  legalBasisRuleVersionId: string;
  employeeElectionAt?: string | null;
  /**
   * Допускает ли действующая норма выбор формы по этой категории
   * (инвариант 7.1.3). Без этого поля клиент предлагал бы выбор везде —
   * то есть обещал бы право, которого правило не даёт.
   */
  electionAllowed: boolean;
}

export interface CompensationCase {
  id: string;
  employeeId: string;
  timesheetId: string;
  unitId: string;
  periodStart: string;
  periodEnd: string;
  status: CaseStatus;
  correctsCaseId?: string | null;
  finalizedAt?: string | null;
  lines: CompensationLine[];
}

export interface RegionalForecast {
  regionUnitId: string;
  periodStart: string;
  periodEnd: string;
  forecastMonetaryHours: number;
  forecastRestDays: number;
  employeeCount: number;
  caseCount: number;
  computedAt: string;
}
