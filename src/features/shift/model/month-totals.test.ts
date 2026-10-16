import { describe, expect, it } from "vitest";

import { Dec } from "../domain/decimal";
import { createProfile } from "../storage/profile";
import {
  calculateFor,
  monthTotalsFor,
  withAbsenceToggled,
  withAbsenceUntil,
} from "./derive";

/**
 * Итоги месяцев над сеткой.
 *
 * Над каждым месяцем стоят норма, факт и разница. Они обязаны сходиться с
 * полосой итога наверху: человек сверяет одно с другим, и норма года,
 * не равная сумме норм её месяцев, читалась бы как ошибка расчёта, а не
 * как округление.
 */
describe("итоги месяцев", () => {
  const profile = createProfile({
    displayName: "Тест",
    workingConditions: "normal",
    disabilityGroupIorII: false,
    firstShiftDate: "2026-01-01",
    accountingYear: 2026,
    shiftStartTime: "08:00",
    schedulePattern: "1|3",
    shiftDurationHours: "24",
    customWorkDays: 1,
    customRestDays: 3,
  });

  const сумма = (values: Iterable<InstanceType<typeof Dec>>) => {
    let total = new Dec(0);
    for (const value of values) total = total.plus(value);
    return total;
  };

  it("год — двенадцать месяцев, и нормы с фактами складываются в годовые", () => {
    const totals = monthTotalsFor(profile, "2026-01-01", "2027-01-01", null);
    const year = calculateFor(profile, "2026-01-01", "2027-01-01");

    expect([...totals.keys()]).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
    ]);
    expect(сумма([...totals.values()].map((t) => t.normHours)).toString()).toBe(
      year.normHours.toString(),
    );
    expect(сумма([...totals.values()].map((t) => t.actualHours)).toString()).toBe(
      year.actualHours.toString(),
    );
  });

  it("отпуск уменьшает норму именно своего месяца", () => {
    // Отпуск с 9 по 22 марта: отметка на первый день и срок к ней — так
    // же, как его ставит человек в перечне видов у дня.
    const withLeave = withAbsenceUntil(
      withAbsenceToggled(profile, "2026-03-09", "annual_leave"),
      "2026-03-09",
      "annual_leave",
      "2026-03-22",
    );
    const before = monthTotalsFor(profile, "2026-01-01", "2027-01-01", null);
    const after = monthTotalsFor(withLeave, "2026-01-01", "2027-01-01", null);

    expect(after.get("2026-03")!.normHours.lessThan(before.get("2026-03")!.normHours)).toBe(true);
    expect(after.get("2026-02")!.normHours.toString()).toBe(
      before.get("2026-02")!.normHours.toString(),
    );
    expect(after.get("2026-04")!.normHours.toString()).toBe(
      before.get("2026-04")!.normHours.toString(),
    );
  });

  it("разница месяца — его собственная: переработка или недоработка, не обе", () => {
    for (const total of monthTotalsFor(profile, "2026-01-01", "2027-01-01", null).values()) {
      expect(total.overtimeHours.isZero() || total.undertimeHours.isZero()).toBe(true);
      expect(
        total.actualHours.minus(total.normHours).toString(),
      ).toBe(total.overtimeHours.minus(total.undertimeHours).toString());
    }
  });

  it("«Онлайн»: месяц текущий — по сегодня, будущих нет вовсе", () => {
    const totals = monthTotalsFor(profile, "2026-01-01", "2027-01-01", "2026-04-16");

    expect([...totals.keys()]).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(totals.get("2026-04")!.normHours.toString()).toBe(
      calculateFor(profile, "2026-04-01", "2026-04-16").normHours.toString(),
    );
  });

  it("месяц на краю отрезка считается с того же числа, что и отрезок", () => {
    const totals = monthTotalsFor(profile, "2026-03-16", "2026-05-01", null);

    expect([...totals.keys()]).toEqual(["2026-03", "2026-04"]);
    expect(totals.get("2026-03")!.normHours.toString()).toBe(
      calculateFor(profile, "2026-03-16", "2026-04-01").normHours.toString(),
    );
  });
});
