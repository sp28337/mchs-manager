/** Формы ответов `scheduling` (модуль Scheduling, фаза 6). */

export type ScheduleStatus = "draft" | "approved" | "archived";

export type DutyType =
  | "twenty_four_hour_duty"
  | "day_shift"
  | "night_shift"
  | "standby";

export const DUTY_TYPE_LABELS: Record<DutyType, string> = {
  twenty_four_hour_duty: "Суточное дежурство",
  day_shift: "Дневная смена",
  night_shift: "Ночная смена",
  standby: "Резерв",
};

/**
 * Цвет вида дежурства в сетке. НЕ сигнальный ни у одного: вид смены — не
 * отклонение и решения не требует. Сигнальный цвет в этом интерфейсе
 * означает «требует действия», и раскрасить им расписание значило бы
 * обесценить его там, где он действительно нужен, — на конфликте.
 */
export const DUTY_TYPE_TONE: Record<DutyType, string> = {
  twenty_four_hour_duty: "bg-verify-soft border-verify text-verify",
  day_shift: "bg-paper-sunken border-rule-strong text-ink",
  night_shift: "bg-trace-soft border-trace text-trace",
  standby: "bg-transparent border-dashed border-rule-strong text-ink-muted",
};

export interface PlannedShift {
  id: string;
  dutyScheduleId: string;
  employeeId: string;
  startTime: string;
  endTime: string;
  dutyType: DutyType;
}

export interface DutySchedule {
  id: string;
  unitId: string;
  periodType: "month" | "quarter" | "half_year" | "year";
  periodStart: string;
  periodEnd: string;
  status: ScheduleStatus;
  approvalOrderRef?: string | null;
  /**
   * Номер редакции. Пересмотр утверждённого графика создаёт НОВЫЙ график
   * со ссылкой на предыдущий (инвариант 5.1.4), а не правит старый:
   * утверждённый график — приказ, и переписывать его задним числом
   * нельзя.
   */
  revisionNo: number;
  previousScheduleId?: string | null;
  revisionReason?: string | null;
  shifts: PlannedShift[];
}
