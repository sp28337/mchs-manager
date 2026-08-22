import { describe, expect, it } from "vitest";

import { calculatePeriod } from "../../features/shift/domain/calculation";
import { calendarFactsFor } from "../../features/shift/domain/production-calendar";
import { FULL_WEEKLY_HOURS } from "../../features/shift/domain/value-objects";
import { addDays, datesOfMonth, weekday } from "../../features/shift/domain/plain-date";
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
  const days = datesOfMonth(HERO_YEAR, HERO_MONTH);
  const periodStart = days[0]!;
  // Граница периода исключающая, как во всём домене: чтобы месяц вошёл
  // целиком, концом берётся первое число следующего.
  const periodEnd = addDays(days[days.length - 1]!, 1);
  const facts = calendarFactsFor(periodStart, periodEnd, new Map());

  const base = {
    periodStart,
    periodEnd,
    cycle: { knownShiftDate: HERO_KNOWN_SHIFT as IsoDate },
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
  // Отпуск ровно на те сутки, что помечены на сетке: первое и второе.
  // Возьми он хоть день сверх — и норма уменьшится на дни, которых на
  // экране не видно.
  const leave: AbsencePeriod = {
    start: `${HERO_YEAR}-${month}-01` as IsoDate,
    endInclusive: `${HERO_YEAR}-${month}-02` as IsoDate,
    kind: "annual_leave",
  };

  const stage = (absences: readonly AbsencePeriod[]) => {
    const result = calculatePeriod({ ...base, absences });
    return {
      norm: Number(result.normHours.toString()),
      actual: Number(result.actualHours.toString()),
      overtime: Number(result.overtimeHours.toString()),
      undertime: Number(result.undertimeHours.toString()),
    };
  };

  /**
   * Месяц обязан быть чистым.
   *
   * На этом держится вся понятность первого экрана: норма выводится из
   * числа рабочих дней, и только. Появись в месяце праздник или
   * предпраздничный день — числа сойдутся с доменом, но перестанут
   * сходиться с тем, что человек может пересчитать глазами.
   */
  it("месяц без праздников: норма — это рабочие дни на восемь", () => {
    expect(facts.holidays.size).toBe(0);
    expect(facts.preHolidayDays).toBe(0);
    // Ни одного перенесённого выходного: рабочие дни — ровно будни.
    expect(facts.workingDays).toBe(days.filter((day) => weekday(day) < 5).length);
    expect(HERO_STAGES[0]!.norm).toBe(facts.workingDays * 8);
  });

  it("до отсутствий — восемь смен целиком", () => {
    expect(stage([])).toEqual(HERO_STAGES[0]);
  });

  it("отпуск уменьшает отработанное, а норму — нет", () => {
    expect(stage([leave])).toEqual(HERO_STAGES[1]);
  });

  it("отгул после него тоже уменьшает только отработанное", () => {
    expect(stage([leave, rest])).toEqual(HERO_STAGES[2]);
  });

  /**
   * Отпуск обязан лежать на выходных целиком.
   *
   * На этом держится вся история: норма не меняется потому, что исключать
   * из неё нечего. Захвати отпуск хоть один будний день — норма уменьшится
   * на восемь часов, которых на сетке не видно, и первый экран начнёт
   * врать ровно в том месте, ради которого он есть.
   */
  it("в отпуске нет ни одного рабочего дня", () => {
    for (const day of [leave.start, leave.endInclusive]) {
      expect(facts.workingDaySet.has(day)).toBe(false);
    }
    expect(HERO_STAGES[1]!.norm).toBe(HERO_STAGES[0]!.norm);
  });

  /**
   * Недоработка в конце — не случайность, а показанное правило: отгул
   * берут сменой в двадцать четыре часа, а переработки к тому моменту
   * восемь.
   */
  it("история кончается недоработкой, а не переработкой", () => {
    const result = calculatePeriod({ ...base, absences: [leave, rest] });
    expect(result.overtimeHours.toString()).toBe("0");
    expect(result.undertimeHours.toString()).toBe("16");
  });

  it("помеченные сутки — те же, что считает домен", () => {
    const marked = (absences: readonly AbsencePeriod[]) => {
      const result = calculatePeriod({ ...base, absences });
      return result.days
        .filter((day) => day.absenceKind !== null)
        .map((day) => Number(day.day.slice(8, 10)));
    };

    expect(marked([rest])).toEqual(HERO_REST_DAYS);
    // Помечена одна смена с продолжением: отсутствие ложится на смену по
    // дате её начала.
    expect(marked([leave])).toEqual(HERO_LEAVE_DAYS);
  });
});
