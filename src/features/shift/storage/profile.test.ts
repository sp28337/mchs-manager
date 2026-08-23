import { describe, expect, it } from "vitest";

import type { IsoDate } from "../domain/plain-date";
import { createProfile, resetCalendar, type StoredProfile } from "./profile";

/**
 * Сброс — единственное необратимое действие внутри профиля, и граница у
 * него ровно одна: отмеченное на сетках стирается, человек и его ответы
 * остаются. Обе половины проверяются здесь, потому что ошибка в любой из
 * них молча уносит то, чего человек не отдавал: не то год отпусков, не то
 * дату смены вместе со всем графиком.
 */
function filledProfile(): StoredProfile {
  const profile = createProfile({
    displayName: "Смена А",
    workingConditions: "harmful_or_dangerous",
    disabilityGroupIorII: true,
    firstShiftDate: "2025-01-02" as IsoDate,
    accountingYear: 2025,
    shiftStartTime: "09:00",
  });
  return {
    ...profile,
    absences: [
      {
        id: "a1",
        kind: "annual_leave",
        startsOn: "2025-06-01" as IsoDate,
        endsOn: "2025-06-14" as IsoDate,
      },
    ],
    callouts: [
      {
        id: "c1",
        kind: "competition",
        startsOn: "2025-05-05" as IsoDate,
        endsOn: "2025-05-06" as IsoDate,
        hoursPerDay: "7.5",
      },
    ],
    calendarOverrides: { "2025-03-10": "holiday" },
    shiftOverrides: { "2025-04-04": "off", "2025-04-07": "shift" },
    dayNotes: { "2025-04-07": "подменял Петрова" },
    liveMode: true,
    overtimeInDays: true,
  };
}

describe("сброс календаря и графика", () => {
  it("снимает всё отмеченное на сетках", () => {
    const reset = resetCalendar(filledProfile());

    expect(reset.absences).toEqual([]);
    expect(reset.callouts).toEqual([]);
    expect(reset.calendarOverrides).toEqual({});
    expect(reset.shiftOverrides).toEqual({});
    expect(reset.dayNotes).toEqual({});
  });

  it("не трогает человека и его настройки", () => {
    const before = filledProfile();
    const after = resetCalendar(before);

    // Дата смены отдельной строкой: она задаёт сам цикл, и потерять её
    // значит показать человеку чужой график вместо пустого своего.
    expect(after.firstShiftDate).toBe(before.firstShiftDate);
    expect(after.displayName).toBe(before.displayName);
    expect(after.workingConditions).toBe(before.workingConditions);
    expect(after.disabilityGroupIorII).toBe(before.disabilityGroupIorII);
    expect(after.shiftStartTime).toBe(before.shiftStartTime);
    expect(after.accountingYear).toBe(before.accountingYear);
    expect(after.liveMode).toBe(before.liveMode);
    expect(after.overtimeInDays).toBe(before.overtimeInDays);
  });

  it("не правит профиль на месте — прежний остаётся прежним", () => {
    const before = filledProfile();
    resetCalendar(before);

    expect(before.absences).toHaveLength(1);
    expect(before.dayNotes).toEqual({ "2025-04-07": "подменял Петрова" });
  });
});
