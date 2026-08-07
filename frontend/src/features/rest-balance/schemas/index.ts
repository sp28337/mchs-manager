/** Формы ответов `rest-balance` (модуль RestBalance, фаза 9). */

export type MovementType = "accrual" | "consumption";

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  accrual: "Начисление",
  consumption: "Списание",
};

export interface RestBalance {
  employeeId: string;
  balanceDays: number;
  /** `null` — остаток «на сейчас» из материализованного представления. */
  asOf: string | null;
  /**
   * Откуда получено число: по журналу движений (точно на дату) или по
   * представлению (быстро, но с отставанием до минуты). Потребитель
   * вправе знать, что именно ему показали.
   */
  computedFromJournal: boolean;
}

export interface BalanceMovement {
  id: string;
  employeeId: string;
  movementType: MovementType;
  amountDays: number;
  movementDate: string;
  compensationLineId?: string | null;
  leaveGrantId?: string | null;
  /**
   * Связь лежит на СТОРНИРУЮЩЕЙ строке и указывает на исправляемую —
   * иначе сторно требовало бы `UPDATE` неизменяемой записи (миграция
   * 0021). Имя спецификации (`reversedByMovementId`) означало бы
   * обратное тому, что в поле лежит.
   */
  reversesMovementId?: string | null;
  reversalReason?: string | null;
  createdAt: string;
}
