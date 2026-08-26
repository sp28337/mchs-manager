import { describe, expect, test } from "vitest";

import {
  calculatePeriod,
  type CalculatePeriodInput,
} from "./calculation";
import { addDays, weekday, type IsoDate } from "./plain-date";
import { spanMinutes, spanFrom, type ShiftSpan } from "./shift-hours";
import { deriveWeeklyNorm } from "./value-objects";

/**
 * Часы отдельной смены: со скольки и до скольки.
 *
 * Проверяется то, ради чего это и заведено: названные человеком часы
 * старше графика — и по длине смены, и по её началу, — а от начала зависит,
 * в какой месяц уйдут часы и сколько среди них ночных.
 */

const NO_DAYS: ReadonlySet<IsoDate> = new Set<IsoDate>();

const MARCH_WORKING: ReadonlySet<IsoDate> = new Set(
  Array.from({ length: 31 }, (_, index) => addDays("2026-03-01", index)).filter(
    (day) => weekday(day) < 5,
  ),
);

/** Март 2026: смены 2, 6, 10, 14, 18, 22, 26 и 30 числа. */
function march(overrides: Partial<CalculatePeriodInput> = {}) {
  return calculatePeriod({
    periodStart: "2026-03-01",
    periodEnd: "2026-04-01",
    cycle: { knownShiftDate: "2026-01-01" },
    weekly: deriveWeeklyNorm({ conditions: "normal" }),
    calendar: { workingDays: 21, preHolidayDays: 0 },
    absences: [],
    holidayDays: NO_DAYS,
    workingDays: MARCH_WORKING,
    preHolidayDays: NO_DAYS,
    ...overrides,
  });
}

const spans = (entries: Record<string, ShiftSpan>) =>
  new Map(Object.entries(entries) as [IsoDate, ShiftSpan][]);

// ------------------------------------------------------------ промежуток

describe("промежуток смены", () => {
  test("обычная смена считается по разности", () => {
    expect(spanMinutes({ startsAt: "08:00", endsAt: "20:00" })).toBe(720);
    expect(spanMinutes({ startsAt: "08:30", endsAt: "20:00" })).toBe(690);
  });

  /**
   * Конец раньше начала — не ошибка ввода, а ночная смена. Понять это как
   * отрицательную длину значило бы отказать человеку в самом частом случае
   * после суточного.
   */
  test("конец раньше начала — это следующее утро", () => {
    expect(spanMinutes({ startsAt: "20:00", endsAt: "08:00" })).toBe(720);
    expect(spanMinutes({ startsAt: "22:00", endsAt: "06:00" })).toBe(480);
  });

  /**
   * «С восьми до восьми» — то, как называют суточное дежурство. Ноль здесь
   * стёр бы человеку сутки работы за привычный оборот речи.
   */
  test("совпадение концов — ровно сутки, а не ноль", () => {
    expect(spanMinutes({ startsAt: "08:00", endsAt: "08:00" })).toBe(1440);
    expect(spanMinutes({ startsAt: "00:00", endsAt: "00:00" })).toBe(1440);
  });

  test("неразобранное время — это null, а не подставленное своё", () => {
    expect(spanMinutes({ startsAt: "25:00", endsAt: "08:00" })).toBeNull();
    expect(spanMinutes({ startsAt: "08:00", endsAt: "" })).toBeNull();
  });

  test("часы по графику собираются из начала и продолжительности", () => {
    expect(spanFrom("08:00", 1440)).toEqual({ startsAt: "08:00", endsAt: "08:00" });
    expect(spanFrom("08:00", 720)).toEqual({ startsAt: "08:00", endsAt: "20:00" });
    expect(spanFrom("20:00", 720)).toEqual({ startsAt: "20:00", endsAt: "08:00" });
    expect(spanFrom("08:30", 690)).toEqual({ startsAt: "08:30", endsAt: "20:00" });
  });

  /** Собранное из графика и разобранное обратно обязано сойтись. */
  test("сборка и разбор дают ту же продолжительность", () => {
    for (const minutes of [60, 480, 690, 720, 1380, 1440]) {
      expect(spanMinutes(spanFrom("08:00", minutes)), String(minutes)).toBe(minutes);
    }
  });
});

// -------------------------------------------------------------- в расчёте

describe("названные часы в расчёте", () => {
  test("без названных часов смена идёт по графику", () => {
    const result = march({ shiftDurationHours: "24" });
    expect(result.actualHours.toString()).toBe("192"); // 8 смен × 24
  });

  /**
   * Смена, которую сдали раньше, — самый частый случай спора: человек
   * отработал меньше, чем стоит в графике, и приложение обязано показать
   * именно это, а не повторить график.
   */
  test("названные часы заменяют продолжительность по графику", () => {
    const result = march({
      shiftDurationHours: "24",
      shiftSpans: spans({ "2026-03-02": { startsAt: "08:00", endsAt: "23:00" } }),
    });
    // Семь суточных смен и одна пятнадцатичасовая.
    expect(result.actualHours.toString()).toBe("183");
    const second = result.shifts.find((shift) => shift.startedOn === "2026-03-02");
    expect(second?.hours.toString()).toBe("15");
  });

  /**
   * Начало смены названные часы меняют тоже — и это не мелочь: от него
   * зависит, сколько в смене ночных (ст. 96 ТК РФ).
   */
  test("названное начало меняет ночные часы", () => {
    const bySchedule = march({ shiftDurationHours: "12" });
    const byHand = march({
      shiftDurationHours: "12",
      shiftSpans: spans({ "2026-03-02": { startsAt: "20:00", endsAt: "08:00" } }),
    });

    // Дневная смена с восьми утра до восьми вечера ночных не даёт вовсе.
    const day = bySchedule.shifts.find((shift) => shift.startedOn === "2026-03-02");
    expect(day?.nightHours.toString()).toBe("0");

    // Та же смена, отработанная с восьми вечера: с 22:00 до 06:00 — восемь
    // часов ночных, из них два в первых сутках и шесть во вторых.
    const night = byHand.shifts.find((shift) => shift.startedOn === "2026-03-02");
    expect(night?.hours.toString()).toBe("12");
    expect(night?.nightHours.toString()).toBe("8");
  });

  /**
   * Смена, переваленная за полночь названными часами, обязана отдать хвост
   * следующим суткам — иначе месячный итог разойдётся с табелем ровно на
   * стыке месяцев.
   */
  test("названные часы раскладываются по двум суткам", () => {
    const result = march({
      shiftDurationHours: "12",
      shiftSpans: spans({ "2026-03-02": { startsAt: "20:00", endsAt: "08:00" } }),
    });
    const parts = result.days.filter(
      (record) => record.day === "2026-03-02" || record.day === "2026-03-03",
    );
    expect(parts.map((part) => part.hours.toString())).toEqual(["4", "8"]);
    expect(parts.map((part) => part.isShiftStart)).toEqual([true, false]);
  });

  /**
   * Хвост, ушедший за границу периода, в него и не попадает: смена
   * 31 марта с двадцати ноль-ноль отдаёт марту четыре часа, а не двенадцать.
   */
  test("хвост за границей месяца в месяц не попадает", () => {
    const result = march({
      shiftDurationHours: "12",
      cycle: { knownShiftDate: "2026-03-31" },
      shiftSpans: spans({ "2026-03-31": { startsAt: "20:00", endsAt: "08:00" } }),
    });
    const last = result.shifts.find((shift) => shift.startedOn === "2026-03-31");
    expect(last?.hours.toString()).toBe("4");
  });

  /**
   * Часы названы на дату ЗАСТУПЛЕНИЯ. Назвать их на вторых сутках смены —
   * значит не назвать ничего: там лежит хвост чужой смены, а не своя.
   */
  test("часы ищутся по дате заступления, а не по любым суткам смены", () => {
    const result = march({
      shiftDurationHours: "24",
      shiftSpans: spans({ "2026-03-03": { startsAt: "08:00", endsAt: "12:00" } }),
    });
    // Третьего марта смена не начинается — она началась второго. Значит
    // ничего не изменилось: все восемь смен суточные.
    expect(result.actualHours.toString()).toBe("192");
  });

  /**
   * Предпраздничный час снимается с суток, которые календарь считает
   * рабочими, — но названные часы это отменяют: человек утверждает факт, а
   * сокращение относится к графику.
   */
  test("названные часы старше предпраздничного сокращения", () => {
    const preHoliday: ReadonlySet<IsoDate> = new Set<IsoDate>(["2026-03-02"]);
    const cycle = {
      knownShiftDate: "2026-03-02" as IsoDate,
      pattern: {
        id: "5/2" as const,
        source: "calendar" as const,
        cycleDays: 7,
        workDays: 5,
        defaultShiftHours: "8",
        label: "5/2",
        title: "Рабочая неделя",
      },
      workingDays: MARCH_WORKING,
    };

    const shortened = march({ cycle, shiftDurationHours: "8", preHolidayDays: preHoliday });
    const named = march({
      cycle,
      shiftDurationHours: "8",
      preHolidayDays: preHoliday,
      shiftSpans: spans({ "2026-03-02": { startsAt: "08:00", endsAt: "16:00" } }),
    });

    expect(
      shortened.shifts.find((shift) => shift.startedOn === "2026-03-02")?.hours.toString(),
    ).toBe("7");
    expect(
      named.shifts.find((shift) => shift.startedOn === "2026-03-02")?.hours.toString(),
    ).toBe("8");
  });

  /**
   * Норма от названных часов не двигается: она считается по
   * производственному календарю (ст. 104 ТК РФ) и о чьём-либо распорядке
   * не знает. Двигается только факт — а значит и переработка.
   */
  test("норма остаётся прежней, меняется факт", () => {
    const clean = march({ shiftDurationHours: "24" });
    const named = march({
      shiftDurationHours: "24",
      shiftSpans: spans({ "2026-03-02": { startsAt: "08:00", endsAt: "23:00" } }),
    });

    expect(named.normHours.toString()).toBe(clean.normHours.toString());
    expect(clean.overtimeHours.toString()).toBe("24"); // 192 − 168
    expect(named.overtimeHours.toString()).toBe("15"); // 183 − 168
  });
});
