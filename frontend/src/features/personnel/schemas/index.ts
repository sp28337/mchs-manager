/** Формы ответов `personnel`. */

export type EmploymentStatus = "active" | "on_leave" | "sick" | "dismissed";

export type LegalBase = "fps_service" | "labor_code";

export type ServiceConditionCategory = "normal" | "hazardous_or_dangerous" | "pedagogical";

export interface Employee {
  id: string;
  personnelNumber: string;
  fullName: string;
  rank: string;
  legalBase: LegalBase;
  serviceConditionCategory?: ServiceConditionCategory;
  currentPositionId: string;
  currentUnitId: string;
  hiredAt: string;
  employmentStatus: EmploymentStatus;
  dismissedAt?: string | null;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  parentUnitId: string | null;
  /** Точечный ltree-путь: `u<hex>.u<hex>…`. Позиция в иерархии целиком. */
  hierarchyPath: string;
  timeZone: string;
}

export type ServiceRecordEventType =
  | "hire"
  | "assignment"
  | "transfer"
  | "rank_change"
  | "secondment"
  | "dismissal";

export interface ServiceRecordEntry {
  id: string;
  employeeId: string;
  eventType: ServiceRecordEventType;
  effectiveDate: string;
  positionId: string | null;
  unitId: string | null;
  rank: string | null;
  legalBase: LegalBase | null;
  recordedAt: string;
}

export interface PageEnvelope<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  active: "На службе",
  on_leave: "В отпуске",
  sick: "На больничном",
  dismissed: "Уволен",
};

/**
 * Основание прохождения службы решает, каким законом считается время.
 *
 * Это не справочная подробность: сотрудник ФПС ГПС служит по ФЗ-141, а
 * работник по трудовому договору — по ТК РФ, и нормы про сверхурочные,
 * ночные и выходные у них разные. Столбец с этим значением стоит в
 * списке сотрудников именно поэтому.
 */
export const LEGAL_BASE_LABELS: Record<LegalBase, string> = {
  fps_service: "ФЗ-141 (служба)",
  labor_code: "ТК РФ (труд. договор)",
};

/**
 * Категория условий службы — одно из измерений области действия правила
 * (`scope`), то есть она решает, КАКАЯ редакция нормы применится к
 * сотруднику. Поэтому она стоит в карточке, а не выводится при расчёте.
 */
export const SERVICE_CONDITION_LABELS: Record<ServiceConditionCategory, string> = {
  normal: "Обычные",
  hazardous_or_dangerous: "Вредные или опасные",
  pedagogical: "Педагогическая деятельность",
};

export const SERVICE_RECORD_EVENT_LABELS: Record<ServiceRecordEventType, string> = {
  hire: "Приём на службу",
  assignment: "Назначение на должность",
  transfer: "Перевод",
  rank_change: "Присвоение звания",
  secondment: "Прикомандирование",
  dismissal: "Увольнение",
};

/** Глубина подразделения в иерархии: 1 — корень. */
export function unitDepth(unit: Unit): number {
  return unit.hierarchyPath.split(".").length;
}
