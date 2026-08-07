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

export type DayType = "working" | "weekend" | "holiday" | "pre_holiday";

export interface CalendarDay {
  day: string;
  dayType: DayType;
  /** `override` — правка человека, `calendar` — общий, `default` — по дню недели. */
  source: "override" | "calendar" | "default";
}

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  working: "Рабочий",
  pre_holiday: "Предпраздничный",
  holiday: "Праздничный",
  weekend: "Выходной",
};

/**
 * Что тип дня ДЕЛАЕТ с нормой. Подпись называет последствие, а не только
 * сам день: человек размечает календарь ради нормы, и «предпраздничный»
 * без пояснения ему ничего не говорит.
 */
export const DAY_TYPE_EFFECT: Record<DayType, string> = {
  working: "Входит в норму периода: +8 часов при 40-часовой неделе",
  pre_holiday: "Рабочий, но норма меньше на 1 час (ст. 95 ТК РФ)",
  holiday: "В норму не входит (ст. 112 ТК РФ)",
  weekend: "В норму не входит",
};

export const DAY_TYPE_TONE: Record<DayType, string> = {
  working: "border-rule bg-paper text-ink",
  pre_holiday: "border-trace bg-trace-soft text-trace",
  holiday: "border-signal bg-signal-soft text-signal",
  weekend: "border-rule-strong bg-paper-sunken text-ink-muted",
};

/** Буква в клетке: различие не должно держаться на одном цвете. */
export const DAY_TYPE_MARK: Record<DayType, string> = {
  working: "Р",
  pre_holiday: "П*",
  holiday: "П",
  weekend: "В",
};

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
