/**
 * Подписи и словарь приложения.
 *
 * Типы данных живут в `../domain` — здесь только то, как эти данные
 * называются по-русски. Формы запросов и ответов исчезли вместе с
 * сервером: расчёт считается на месте, и передавать наружу нечего.
 */

export type {
  AbsenceKind,
  CalloutKind,
  AccountingPeriodKind,
  WeeklyNorm,
  WorkingConditions,
} from "../domain/value-objects";
export type { DayType, CalendarDay } from "../domain/production-calendar";
export type { PeriodCalculation, ShiftRecord } from "../domain/calculation";
export type { Discrepancy } from "../domain/reconciliation";
export { formatHours as hours } from "../domain/decimal";

import type { AbsenceKind, CalloutKind } from "../domain/value-objects";
import type { DayType } from "../domain/production-calendar";

export const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  annual_leave: "Отпуск",
  sick_leave: "Больничный",
  study_leave: "Учебный отпуск",
  time_off_in_lieu: "Отгул за переработку",
};

export const CALLOUT_LABELS: Record<CalloutKind, string> = {
  competition: "Соревнования",
  training_camp: "Сбор",
  reserve: "Резерв",
  public_event: "Праздничное мероприятие",
  elections: "Выборы",
};

/** Что вид отсутствия или вызова ДЕЛАЕТ с расчётом. */
export const ABSENCE_EFFECT: Record<AbsenceKind, string> = {
  annual_leave: "часы по норме за эти дни исключаются из нормы",
  sick_leave: "часы по норме за эти дни исключаются из нормы",
  study_leave: "часы по норме за эти дни исключаются из нормы",
  time_off_in_lieu:
    "норма не меняется, а пропущенная смена уменьшает переработку — отгул и есть её погашение",
};

/**
 * Порядок видов дня в списках: от «входит в норму» к «не входит».
 *
 * Один на все места, где день выбирают или объясняют, — иначе легенда и
 * список в окне правки разошлись бы порядком, и человек искал бы в одном
 * то, что запомнил из другого.
 */
export const DAY_TYPES: DayType[] = ["working", "pre_holiday", "holiday", "weekend"];

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
  // Рабочий день — подложка, а не белое поле: в сомкнутой сетке месяц
  // выглядит одной плашкой, и день цвета страницы был бы в ней дырой.
  working: "border-rule bg-paper-raised text-ink",
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
