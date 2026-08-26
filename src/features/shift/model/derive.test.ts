import { describe, expect, it } from "vitest";

import { createProfile } from "../storage/profile";
import { calculateFor, withShiftAt, withShiftMoved } from "./derive";

/**
 * Правки графика в профиле.
 *
 * Проверяется одно правило и его следствие: в профиле лежит только то,
 * что человек утверждает ВОПРЕКИ циклу. Совпало с циклом — записи нет.
 *
 * Правило не косметическое. Запись, подтверждающая цикл, однажды зажила
 * бы своей жизнью: сдвинь человек известную смену на день, и старые
 * «подтверждения» превратились бы в чужие смены посреди года.
 */
describe("правки графика", () => {
  // Известная смена 1 января 2026-го: цикл — 1, 5, 9, 13…
  const profile = createProfile({
    displayName: "Тест",
    workingConditions: "normal",
    disabilityGroupIorII: false,
    firstShiftDate: "2026-01-01",
    accountingYear: 2026,
    shiftStartTime: "08:00",
    schedulePattern: "1/3",
    shiftDurationHours: "24",
    customWorkDays: 1,
    customRestDays: 3,
  });

  it("снятая смена записывается", () => {
    expect(withShiftAt(profile, "2026-01-05", false).shiftOverrides).toEqual({
      "2026-01-05": "off",
    });
  });

  it("назначенная смена записывается", () => {
    expect(withShiftAt(profile, "2026-01-07", true).shiftOverrides).toEqual({
      "2026-01-07": "shift",
    });
  });

  it("совпадение с циклом ничего не записывает", () => {
    expect(withShiftAt(profile, "2026-01-05", true).shiftOverrides).toEqual({});
    expect(withShiftAt(profile, "2026-01-07", false).shiftOverrides).toEqual({});
  });

  it("возврат к циклу снимает прежнюю правку", () => {
    const without = withShiftAt(profile, "2026-01-05", false);
    expect(withShiftAt(without, "2026-01-05", true).shiftOverrides).toEqual({});
  });

  it("перенос — одна правка на двое суток", () => {
    expect(withShiftMoved(profile, "2026-01-05", "2026-01-07").shiftOverrides).toEqual({
      "2026-01-05": "off",
      "2026-01-07": "shift",
    });
  });

  it("перенос на те же сутки ничего не меняет", () => {
    expect(withShiftMoved(profile, "2026-01-05", "2026-01-05")).toBe(profile);
  });

  /**
   * Главное следствие: перенос не создаёт и не теряет часы. Смен столько
   * же, отработано столько же — сдвинулась только дата.
   */
  it("перенос не меняет ни числа смен, ни отработанного", () => {
    const before = calculateFor(profile, "2026-01-01", "2026-02-01");
    const after = calculateFor(
      withShiftMoved(profile, "2026-01-05", "2026-01-07"),
      "2026-01-01",
      "2026-02-01",
    );

    expect(after.scheduledShifts).toBe(before.scheduledShifts);
    expect(after.actualHours.toString()).toBe(before.actualHours.toString());
    expect(after.normHours.toString()).toBe(before.normHours.toString());
    expect(after.days.some((day) => day.day === "2026-01-07" && day.isShiftStart)).toBe(
      true,
    );
    expect(after.days.some((day) => day.day === "2026-01-05" && day.isShiftStart)).toBe(
      false,
    );
  });

  it("снятая смена уменьшает отработанное на сутки", () => {
    const before = calculateFor(profile, "2026-01-01", "2026-02-01");
    const after = calculateFor(
      withShiftAt(profile, "2026-01-05", false),
      "2026-01-01",
      "2026-02-01",
    );

    expect(before.actualHours.minus(after.actualHours).toString()).toBe("24");
    // Норма не трогается: она считается по производственному календарю, а
    // не по графику смен, и снятая смена на неё влиять не должна.
    expect(after.normHours.toString()).toBe(before.normHours.toString());
  });
});
