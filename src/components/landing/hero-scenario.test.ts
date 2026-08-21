import { describe, expect, it } from "vitest";

import { calculatePeriod } from "../../features/shift/domain/calculation";
import { calendarFactsFor } from "../../features/shift/domain/production-calendar";
import { FULL_WEEKLY_HOURS, type GuardNumber } from "../../features/shift/domain/value-objects";
import type { AbsencePeriod } from "../../features/shift/domain/calculation";
import type { IsoDate } from "../../features/shift/domain/plain-date";

import {
  HERO_KNOWN_SHIFT,
  HERO_LEAVE_DAYS,
  HERO_MONTH,
  HERO_REST_DAYS,
  HERO_STAGES,
  HERO_YEAR,
} from "./hero-scenario";

/**
 * Числа первого экрана — настоящие.
 *
 * Посадочная страница не считает их у себя: домен расчёта в её выдаче был
 * бы лишним весом. Значит, они записаны руками — и единственное, что
 * удерживает их от расхождения с приложением, это проверка. Здесь тот же
 * расчёт прогоняется заново, для тех же суток и тех же отсутствий.
 *
 * Упадёт она — значит, правило в домене изменилось, а первый экран об
 * этом ещё не знает. Поправить надо ЕГО, а не проверку.
 */
describe("числа первого экрана", () => {
  const month = String(HERO_MONTH).padStart(2, "0");
  const periodStart = `${HERO_YEAR}-${month}-01` as IsoDate;
  const periodEnd = `${HERO_YEAR}-${month}-31` as IsoDate;
  const facts = calendarFactsFor(periodStart, periodEnd, new Map());

  const base = {
    periodStart,
    periodEnd,
    cycle: { guard: 1 as GuardNumber, knownShiftDate: HERO_KNOWN_SHIFT as IsoDate },
    weekly: { hours: FULL_WEEKLY_HOURS, basis: "ст. 91 ТК РФ" },
    calendar: { workingDays: facts.workingDays, preHolidayDays: facts.preHolidayDays },
    holidayDays: facts.holidays,
    workingDays: facts.workingDaySet,
    preHolidayDays: facts.preHolidayDaySet,
    shiftStartTime: "08:00",
  };

  const rest: AbsencePeriod = {
    start: `${HERO_YEAR}-${month}-13` as IsoDate,
    endInclusive: `${HERO_YEAR}-${month}-13` as IsoDate,
    kind: "time_off_in_lieu",
  };
  const leave: AbsencePeriod = {
    start: `${HERO_YEAR}-${month}-01` as IsoDate,
    endInclusive: `${HERO_YEAR}-${month}-07` as IsoDate,
    kind: "annual_leave",
  };

  const stage = (absences: readonly AbsencePeriod[]) => {
    const result = calculatePeriod({ ...base, absences });
    return {
      norm: Number(result.normHours.toString()),
      actual: Number(result.actualHours.toString()),
      overtime: Number(result.overtimeHours.toString()),
    };
  };

  it("до отсутствий — восемь смен целиком", () => {
    expect(stage([])).toEqual(HERO_STAGES[0]);
  });

  it("отгул уменьшает отработанное, но не норму", () => {
    expect(stage([rest])).toEqual(HERO_STAGES[1]);
  });

  it("отпуск уменьшает и норму тоже", () => {
    expect(stage([rest, leave])).toEqual(HERO_STAGES[2]);
  });

  it("помеченные сутки — те же, что считает домен", () => {
    const marked = (absences: readonly AbsencePeriod[]) => {
      const result = calculatePeriod({ ...base, absences });
      return result.days
        .filter((day) => day.absenceKind !== null)
        .map((day) => Number(day.day.slice(8, 10)));
    };

    expect(marked([rest])).toEqual(HERO_REST_DAYS);
    expect(marked([leave])).toEqual(HERO_LEAVE_DAYS);
  });
});
