/**
 * Сверка расчёта с табелем, который выдали на работе.
 *
 * --- Почему сверка отдельно от расчёта ----------------------------------
 *
 * Расчёт отвечает «как должно быть». Сверка отвечает на другой вопрос —
 * «где расходится и на сколько», — и у неё своя цена ошибки: человек
 * понесёт её результат к начальнику. Поэтому расхождение не просто
 * называется, а КВАЛИФИЦИРУЕТСЯ: указывается, какая именно норма нарушена
 * и на сколько часов. «У вас неверно» — это спор, «норма периода завышена
 * на 48 часов, потому что 2 смены отпуска не исключены (письмо Роструда
 * от 01.03.2010 № 550-6-1)» — это довод.
 *
 * --- Почему сравниваются три числа, а не одно ---------------------------
 *
 * Работодатель может ошибиться в норме, в факте или в обоих. Сравнение
 * одной итоговой переработки скрыло бы взаимную компенсацию ошибок: норма
 * завышена на 24 и факт завышен на 24 дают ту же переработку при двух
 * неверных числах. Поэтому сверяются норма, факт и переработка раздельно.
 */

import { Dec, formatHours, type Decimal } from "./decimal";
import type { PeriodCalculation } from "./calculation";

/**
 * Табель ведут в часах с округлением; расхождение меньше получаса
 * осмысленно считать округлением, а не спором.
 */
export const TOLERANCE_HOURS = new Dec("0.5");

export type DiscrepancyField = "norm_hours" | "actual_hours" | "overtime_hours";

/** Числа из выданного табеля. Любое может отсутствовать. */
export interface EmployerFigures {
  readonly normHours?: Decimal | null;
  readonly actualHours?: Decimal | null;
  readonly overtimeHours?: Decimal | null;
}

/** Одно расхождение с объяснением и правовым основанием. */
export interface Discrepancy {
  readonly field: DiscrepancyField;
  readonly label: string;
  readonly expected: Decimal;
  readonly reported: Decimal;
  readonly explanation: string;
  readonly basis: string;

  /** Насколько в табеле больше нашего расчёта. */
  readonly delta: Decimal;

  /**
   * Играет ли расхождение против человека.
   *
   * Завышенная норма и заниженные факт или переработка — все против него.
   * Обратное направление тоже показывается: сверка обязана быть честной в
   * обе стороны, иначе ей не поверят там, где она права.
   */
  readonly favoursEmployer: boolean;
}

function make(
  field: DiscrepancyField,
  label: string,
  expected: Decimal,
  reported: Decimal,
  explanation: string,
  basis: string,
): Discrepancy {
  const delta = reported.minus(expected);
  return {
    field,
    label,
    expected,
    reported,
    explanation,
    basis,
    delta,
    favoursEmployer: field === "norm_hours" ? delta.greaterThan(0) : delta.lessThan(0),
  };
}

function differs(expected: Decimal, reported: Decimal): boolean {
  return reported.minus(expected).abs().greaterThan(TOLERANCE_HOURS);
}

/**
 * Расхождения между расчётом и выданным табелем.
 *
 * Пустой список означает «сходится в пределах получаса», и это
 * полноценный ответ: человеку важно узнать и что всё верно.
 */
export function reconcile(
  calculation: PeriodCalculation,
  reported: EmployerFigures,
): Discrepancy[] {
  const found: Discrepancy[] = [];

  const reportedNorm = reported.normHours ?? null;
  if (reportedNorm !== null && differs(calculation.normHours, reportedNorm)) {
    const overstated = reportedNorm.greaterThan(calculation.normHours);
    let explanation: string;
    let basis: string;

    // Самая частая причина завышенной нормы — неисключённое отсутствие, и
    // если оно в периоде было, названо будет именно оно: догадка здесь
    // уместна ровно потому, что проверяема — цифра исключённых часов
    // стоит рядом.
    if (overstated && calculation.excludedHours.greaterThan(0)) {
      explanation =
        `Норма завышена. За период ${calculation.absentShifts} ` +
        `смен(ы) пришлись на отсутствие с сохранением места службы — ` +
        `это ${formatHours(calculation.excludedHours)} ч по графику, и они должны ` +
        `исключаться из нормы, а не отрабатываться позже.`;
      basis = "письмо Роструда от 01.03.2010 № 550-6-1; ст. 104 ТК РФ";
    } else if (overstated) {
      explanation =
        "Норма завышена. Она считается по производственному календарю: " +
        `${calculation.calendar.workingDays} рабочих дней × ` +
        `${formatHours(calculation.weeklyNorm.hours)} ч ÷ 5 − ` +
        `${calculation.calendar.preHolidayDays} ч за предпраздничные дни.`;
      basis = `${calculation.weeklyNorm.basis}; ст. 95, 104 ТК РФ`;
    } else {
      explanation =
        "Норма занижена относительно производственного календаря. " +
        "Заниженная норма увеличивает переработку — проверьте, не " +
        "ошибка ли это в вашу пользу.";
      basis = `${calculation.weeklyNorm.basis}; ст. 104 ТК РФ`;
    }

    found.push(
      make("norm_hours", "Норма периода", calculation.normHours, reportedNorm, explanation, basis),
    );
  }

  const reportedActual = reported.actualHours ?? null;
  if (reportedActual !== null && differs(calculation.actualHours, reportedActual)) {
    const understated = reportedActual.lessThan(calculation.actualHours);
    let explanation: string;

    if (understated && calculation.absentShifts > 0) {
      explanation =
        "Факт занижен. Частая ошибка — вычесть по 24 часа за каждую " +
        "смену, попавшую в отпуск или на больничный. Так делать нельзя: " +
        "эти часы не отработаны и не должны попадать в факт, но и " +
        "вычитаться из него они не могут — они исключаются из НОРМЫ.";
    } else if (understated) {
      explanation =
        `Факт занижен. По графику караула за период ` +
        `${calculation.workedShifts} отработанных смен, что даёт ` +
        `${formatHours(calculation.actualHours)} ч.`;
    } else {
      explanation =
        "Факт завышен относительно графика караула. Возможны смены, " +
        "не учтённые в вашем профиле, — подмены или привлечения.";
    }

    found.push(
      make(
        "actual_hours",
        "Фактически отработано",
        calculation.actualHours,
        reportedActual,
        explanation,
        "ст. 91 ТК РФ (обязанность вести точный учёт)",
      ),
    );
  }

  const reportedOvertime = reported.overtimeHours ?? null;
  if (reportedOvertime !== null && differs(calculation.overtimeHours, reportedOvertime)) {
    found.push(
      make(
        "overtime_hours",
        "Переработка",
        calculation.overtimeHours,
        reportedOvertime,
        "Переработка — это разница между фактом и нормой к отработке: " +
          `${formatHours(calculation.actualHours)} − ${formatHours(calculation.normHours)} = ` +
          `${formatHours(calculation.overtimeHours)} ч. Если норму не уменьшили на ` +
          "часы отсутствий, переработка окажется меньше действительной.",
        "ст. 99, 104 ТК РФ; ст. 55 ФЗ-141",
      ),
    );
  }

  return found;
}
