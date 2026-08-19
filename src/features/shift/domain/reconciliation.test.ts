/**
 * Сверка с выданным табелем.
 *
 * Проверяется не арифметика — она в `calculation.test.ts`, — а то, ради
 * чего сверка существует: расхождение обязано быть названо, объяснено и
 * подкреплено нормой, иначе с ним не пойдёшь к начальнику.
 */

import { expect, test } from "vitest";

import { Dec } from "./decimal";
import { calculatePeriod, type AbsencePeriod } from "./calculation";
import { reconcile, type EmployerFigures } from "./reconciliation";
import { deriveWeeklyNorm } from "./value-objects";
import { addDays, weekday, type IsoDate } from "./plain-date";

const WEEKLY = deriveWeeklyNorm({
  conditions: "normal",
  northernLocality: false,
});

function march(absences: AbsencePeriod[] = []) {
  return calculatePeriod({
    periodStart: "2026-03-01",
    periodEnd: "2026-04-01",
    cycle: { guard: 1, knownShiftDate: "2026-01-01" },
    weekly: WEEKLY,
    calendar: { workingDays: 21, preHolidayDays: 0 },
    absences,
    holidayDays: new Set<IsoDate>(),
    // Рабочие дни марта 2026 — будни; по ним считается, сколько нормы
    // приходится на отпуск.
    workingDays: new Set(
      Array.from({ length: 31 }, (_, i) => addDays("2026-03-01", i)).filter(
        (d) => weekday(d) < 5,
      ),
    ),
    preHolidayDays: new Set<IsoDate>(),
  });
}

const ANNUAL_LEAVE_FIRST_HALF: AbsencePeriod = {
  start: "2026-03-01",
  endInclusive: "2026-03-14",
  kind: "annual_leave",
};

function figures(values: {
  norm?: string;
  actual?: string;
  overtime?: string;
}): EmployerFigures {
  return {
    normHours: values.norm === undefined ? null : new Dec(values.norm),
    actualHours: values.actual === undefined ? null : new Dec(values.actual),
    overtimeHours: values.overtime === undefined ? null : new Dec(values.overtime),
  };
}

test("сходящийся табель не даёт расхождений", () => {
  // «Всё сходится» — полноценный ответ, а не пустой экран.
  const found = reconcile(
    march(),
    figures({ norm: "168", actual: "192", overtime: "24" }),
  );
  expect(found).toEqual([]);
});

test("округление в пределах получаса — не спор", () => {
  expect(reconcile(march(), figures({ norm: "168.4" }))).toEqual([]);
  expect(reconcile(march(), figures({ norm: "169" }))).not.toEqual([]);
});

test("неуменьшенная норма названа вместе с причиной", () => {
  // Самый частый случай обмана. Человек был в отпуске 1-14 марта; норма
  // должна была уменьшиться на 96 часов, а в табеле стоит полная. Сверка
  // обязана не просто заметить разницу, а сказать, ОТКУДА она взялась и
  // какой нормой опровергается.
  const calculation = march([ANNUAL_LEAVE_FIRST_HALF]);
  expect(calculation.normHours.toString()).toBe("88");

  const found = reconcile(calculation, figures({ norm: "168" }));
  expect(found).toHaveLength(1);

  const [discrepancy] = found;
  expect(discrepancy!.field).toBe("norm_hours");
  expect(discrepancy!.delta.toString()).toBe("80");
  expect(discrepancy!.favoursEmployer).toBe(true);
  expect(discrepancy!.explanation).toContain("80");
  expect(discrepancy!.basis).toContain("550-6-1");
});

test("приём «минус 24 часа» распознаётся по имени", () => {
  // Именно тот приём, о котором просили. Сверка должна объяснить, почему
  // так нельзя, а не просто показать разницу.
  const calculation = march([ANNUAL_LEAVE_FIRST_HALF]);

  // Работодатель уменьшил факт ещё на одну «штрафную» смену.
  const found = reconcile(calculation, {
    actualHours: calculation.actualHours.minus(24),
  });

  expect(found).toHaveLength(1);
  expect(found[0]!.field).toBe("actual_hours");
  expect(found[0]!.explanation).toContain("24 часа");
  expect(found[0]!.favoursEmployer).toBe(true);
});

test("ошибка в пользу человека тоже показывается", () => {
  // Сверка честна в обе стороны. Инструмент, который находит только
  // выгодные владельцу расхождения, не выдержит первого же разбора.
  const found = reconcile(march(), figures({ norm: "100" }));
  expect(found).toHaveLength(1);
  expect(found[0]!.favoursEmployer).toBe(false);
});

test("все три числа сверяются независимо", () => {
  // Ошибки в норме и факте могут скомпенсировать друг друга в итоговой
  // переработке. Сверяя только её, мы объявили бы верным табель с двумя
  // неверными числами.
  const calculation = march();
  const found = reconcile(calculation, {
    normHours: calculation.normHours.plus(24),
    actualHours: calculation.actualHours.plus(24),
    overtimeHours: calculation.overtimeHours,
  });

  expect(new Set(found.map((item) => item.field))).toEqual(
    new Set(["norm_hours", "actual_hours"]),
  );
});

test("незаполненные числа просто не сравниваются", () => {
  // Человек может знать из табеля не всё. Отсутствие числа — не ноль.
  expect(reconcile(march(), {})).toEqual([]);
});
