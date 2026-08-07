/** Формы данных приложения сверки табеля. */

export type EmploymentKind = "attested" | "civilian";
export type Gender = "male" | "female";
export type WorkingConditions = "normal" | "harmful_or_dangerous";

export type AbsenceKind =
  | "annual_leave"
  | "sick_leave"
  | "study_leave"
  | "unpaid_leave"
  | "business_trip"
  | "other_excused";

export const EMPLOYMENT_LABELS: Record<EmploymentKind, string> = {
  attested: "Аттестованный сотрудник ФПС ГПС",
  civilian: "Вольнонаёмный работник",
};

/** Чем различие важно — а не просто как называется. */
export const EMPLOYMENT_HINT: Record<EmploymentKind, string> = {
  attested:
    "Служба по ФЗ-141. Режим сменной службы — Приказ МЧС России от 24.04.2026 № 308.",
  civilian:
    "Работа по трудовому договору. Режим сменной работы — Приказ МЧС России от 24.04.2026 № 307.",
};

export type AccountingPeriodKind = "quarter" | "half_year" | "year";

export const ACCOUNTING_PERIOD_LABELS: Record<AccountingPeriodKind, string> = {
  quarter: "квартал",
  half_year: "полугодие",
  year: "год",
};

export const GENDER_LABELS: Record<Gender, string> = {
  male: "Мужской",
  female: "Женский",
};

export const CONDITIONS_LABELS: Record<WorkingConditions, string> = {
  normal: "Обычные",
  harmful_or_dangerous: "Вредные (3-4 степень) или опасные",
};

export const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  annual_leave: "Отпуск",
  sick_leave: "Больничный",
  study_leave: "Учебный отпуск",
  unpaid_leave: "Отпуск без сохранения",
  business_trip: "Командировка",
  other_excused: "Иное освобождение",
};

export interface Profile {
  id: string;
  displayName: string;
  employmentKind: EmploymentKind;
  gender: Gender;
  workingConditions: WorkingConditions;
  northernLocality: boolean;
  disabilityGroupIorII: boolean;
  accountingPeriodKinds: AccountingPeriodKind[];
  guardNumber: number;
  firstShiftDate: string;
  accountingYear: number;
  weeklyNormHours: string;
  weeklyNormBasis: string;
}

export interface Absence {
  id: string;
  kind: AbsenceKind;
  startsOn: string;
  endsOn: string;
  note?: string | null;
  basis: string;
}

export interface Shift {
  startedOn: string;
  hours: string;
  nightHours: string;
  holidayHours: string;
  absenceKind?: AbsenceKind | null;
}

export interface Calculation {
  periodStart: string;
  periodEnd: string;
  weeklyNormHours: string;
  weeklyNormBasis: string;
  workingDays: number;
  preHolidayDays: number;
  baseNormHours: string;
  excludedHours: string;
  normHours: string;
  actualHours: string;
  overtimeHours: string;
  undertimeHours: string;
  wrongNormUndertimeHours: string;
  nightHours: string;
  holidayHours: string;
  scheduledShifts: number;
  workedShifts: number;
  absentShifts: number;
  calendarPublished: boolean;
  shifts: Shift[];
}

export interface Discrepancy {
  field: string;
  label: string;
  expected: string;
  reported: string;
  delta: string;
  favoursEmployer: boolean;
  explanation: string;
  basis: string;
}

export interface Reconciliation {
  calculation: Calculation;
  reported: {
    periodStart: string;
    periodEnd: string;
    normHours?: string | null;
    actualHours?: string | null;
    overtimeHours?: string | null;
  };
  discrepancies: Discrepancy[];
}

/** Часы с двумя знаками — как в табеле. */
export function hours(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  return parsed.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
