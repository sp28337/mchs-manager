import { describe, expect, it } from "vitest";

import type { IsoDate } from "./plain-date";
import { addDays, weekday } from "./plain-date";
import {
  DEFAULT_SCHEDULE_PATTERN,
  SCHEDULE_PATTERNS,
  onPatternCycle,
  patternShiftDates,
  schedulePatternOf,
} from "./schedule-pattern";

const at = (day: string) => day as IsoDate;

/**
 * График задаёт весь календарь, и ошибка в нём тихая: смены просто встают
 * не туда, а числа при них выглядят как обычно. Поэтому здесь проверяется
 * не «работает», а сама арифметика цикла — в обе стороны от названной
 * смены и на границах периода.
 */
describe("графики сменности", () => {
  it("список и умолчание сходятся", () => {
    expect(SCHEDULE_PATTERNS.map((p) => p.id)).toEqual(["1/3", "1/4", "2/2", "5/2"]);
    expect(schedulePatternOf(DEFAULT_SCHEDULE_PATTERN).id).toBe("1/3");
  });

  it("неизвестное значение читается как график по умолчанию", () => {
    // Профиль мог быть записан версией, где список был другим. Белый экран
    // вместо расчёта человек не починит, а неверный график — увидит.
    expect(schedulePatternOf("7/7").id).toBe("1/3");
    expect(schedulePatternOf(undefined).id).toBe("1/3");
  });

  it("у каждого графика длина цикла больше числа рабочих суток", () => {
    // Иначе выходных не остаётся вовсе, и «график» перестаёт быть графиком.
    for (const pattern of SCHEDULE_PATTERNS) {
      expect(pattern.workDays, pattern.id).toBeGreaterThan(0);
      expect(pattern.cycleDays, pattern.id).toBeGreaterThan(pattern.workDays);
    }
  });
});

describe("цикл вокруг названной смены", () => {
  const anchor = at("2026-01-05");

  it("сутки через трое: рабочие каждые четвёртые", () => {
    const pattern = schedulePatternOf("1/3");
    for (const [day, expected] of [
      ["2026-01-05", true],
      ["2026-01-06", false],
      ["2026-01-07", false],
      ["2026-01-08", false],
      ["2026-01-09", true],
    ] as const) {
      expect(onPatternCycle(anchor, at(day), pattern), day).toBe(expected);
    }
  });

  it("два через два: названные сутки — ПЕРВЫЕ из двух", () => {
    // Вторые сутки череды цикл достраивает сам. Иначе человеку пришлось бы
    // называть каждую пару отдельно, и график перестал бы строиться.
    const pattern = schedulePatternOf("2/2");
    for (const [day, expected] of [
      ["2026-01-05", true],
      ["2026-01-06", true],
      ["2026-01-07", false],
      ["2026-01-08", false],
      ["2026-01-09", true],
    ] as const) {
      expect(onPatternCycle(anchor, at(day), pattern), day).toBe(expected);
    }
  });

  it("цикл идёт и НАЗАД от названной смены", () => {
    // Человек называет любую свою смену, в том числе завтрашнюю: график до
    // неё обязан строиться так же, как после.
    const pattern = schedulePatternOf("1/3");
    expect(onPatternCycle(anchor, at("2026-01-01"), pattern)).toBe(true);
    expect(onPatternCycle(anchor, at("2025-12-28"), pattern)).toBe(true);
    expect(onPatternCycle(anchor, at("2025-12-29"), pattern)).toBe(false);
  });

  it("пять через два с понедельника — это рабочая неделя", () => {
    // Ради этого 5/2 и оставлен скользящим циклом, без отдельного «графика
    // по дням недели»: назови понедельник — и выходные навсегда встанут на
    // субботу с воскресеньем.
    const monday = at("2026-01-05");
    expect(weekday(monday)).toBe(0);
    const pattern = schedulePatternOf("5/2");

    for (let i = 0; i < 28; i++) {
      const day = addDays(monday, i);
      const isWeekend = weekday(day) >= 5;
      expect(onPatternCycle(monday, day, pattern), day).toBe(!isWeekend);
    }
  });
});

describe("даты смен за период", () => {
  const anchor = at("2026-01-05");

  it("границы полуинтервала: левая входит, правая нет", () => {
    const pattern = schedulePatternOf("1/3");
    const dates = patternShiftDates(anchor, pattern, at("2026-01-05"), at("2026-01-09"));
    expect(dates).toEqual(["2026-01-05"]);
  });

  it("два через два отдаёт обе смены пары", () => {
    const pattern = schedulePatternOf("2/2");
    const dates = patternShiftDates(anchor, pattern, at("2026-01-05"), at("2026-01-13"));
    expect(dates).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-09",
      "2026-01-10",
    ]);
  });

  it("пара, начавшаяся ДО периода, отдаёт периоду свой хвост", () => {
    // Период начинается вторыми сутками чужой пары. Потеряй мы их — в
    // первом дне месяца пропала бы отработанная смена.
    const pattern = schedulePatternOf("2/2");
    const dates = patternShiftDates(anchor, pattern, at("2026-01-06"), at("2026-01-10"));
    expect(dates).toEqual(["2026-01-06", "2026-01-09"]);
  });

  it("известная смена ПОЗЖЕ периода строит его так же", () => {
    const later = at("2026-08-03");
    const pattern = schedulePatternOf("1/4");
    const dates = patternShiftDates(later, pattern, at("2026-01-01"), at("2026-01-16"));
    // Считано вручную: от 3 августа назад пятёрками — 5, 10 и 15 января.
    // Двадцатое уже за правой границей, а она исключающая.
    expect(dates).toEqual(["2026-01-05", "2026-01-10", "2026-01-15"]);
    for (const day of dates) {
      expect(onPatternCycle(later, at(day), pattern), day).toBe(true);
    }
  });

  it("пустой период не даёт смен", () => {
    const pattern = schedulePatternOf("1/3");
    expect(patternShiftDates(anchor, pattern, at("2026-01-05"), at("2026-01-05"))).toEqual([]);
    expect(patternShiftDates(anchor, pattern, at("2026-01-09"), at("2026-01-05"))).toEqual([]);
  });

  it("за год выходит ровно столько смен, сколько даёт цикл", () => {
    // Проверка на сдвиг: любая ошибка в отсчёте цикла меняет это число.
    for (const pattern of SCHEDULE_PATTERNS) {
      const dates = patternShiftDates(anchor, pattern, at("2026-01-01"), at("2027-01-01"));
      const expected = Math.round((365 * pattern.workDays) / pattern.cycleDays);
      expect(Math.abs(dates.length - expected), pattern.id).toBeLessThanOrEqual(1);
      // Каждая выданная дата и правда рабочая по циклу — и наоборот.
      const set = new Set(dates);
      for (let i = 0; i < 365; i++) {
        const day = addDays(at("2026-01-01"), i);
        expect(set.has(day), `${pattern.id} ${day}`).toBe(
          onPatternCycle(anchor, day, pattern),
        );
      }
    }
  });
});
