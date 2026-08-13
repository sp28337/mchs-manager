/**
 * Производственный календарь, посчитанный по закону.
 *
 * Проверяется против ОФИЦИАЛЬНОГО календаря 2026 года там, где он выводим
 * из закона, и отдельно — там, где не выводим: непроставленный перенос
 * новогодних выходных обязан быть виден как недостача, а не молча
 * завышать норму.
 */

import { describe, expect, test } from "vitest";

import { datesOfYear, isWeekend, weekday, type IsoDate } from "./plain-date";
import {
  calendarFactsFor,
  calendarWithOverrides,
  pendingTransfers,
  statutoryCalendar,
  type DayType,
} from "./production-calendar";

function counts(year: number): Record<DayType, number> {
  const tally: Record<DayType, number> = {
    working: 0,
    weekend: 0,
    holiday: 0,
    pre_holiday: 0,
  };
  for (const type of statutoryCalendar(year).values()) tally[type] += 1;
  return tally;
}

describe("даты", () => {
  test("понедельник считается нулём, как в исходном коде", () => {
    // 1 января 2026 — четверг. Сдвиг нумерации на день переставил бы все
    // выходные года.
    expect(weekday("2026-01-01")).toBe(3);
    expect(weekday("2026-01-03")).toBe(5);
    expect(isWeekend("2026-01-03")).toBe(true);
    expect(isWeekend("2026-01-05")).toBe(false);
  });

  test("год отдаётся целиком и по порядку", () => {
    expect(datesOfYear(2026)).toHaveLength(365);
    expect(datesOfYear(2024)).toHaveLength(366);
    expect(datesOfYear(2026)[0]).toBe("2026-01-01");
    expect(datesOfYear(2026).at(-1)).toBe("2026-12-31");
  });
});

describe("календарь 2026 года", () => {
  test("покрывает год без дыр", () => {
    const tally = counts(2026);
    const total = Object.values(tally).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(365);
  });

  test("праздники ст. 112 размечены, плюс два перенесённых дня", () => {
    // Четырнадцать по ст. 112 ч. 1 и два по постановлению о переносе.
    expect(counts(2026).holiday).toBe(16);
  });

  test("предпраздничные дни найдены по ст. 95", () => {
    const calendar = statutoryCalendar(2026);
    // 22 февраля 2026 — воскресенье, поэтому предпраздничного перед 23-м
    // нет: сокращается РАБОЧИЙ день, а не выходной.
    expect(calendar.get("2026-02-22")).toBe("weekend");
    // 30 апреля — четверг перед 1 мая; 3 ноября — вторник перед 4-м;
    // 31 декабря смотрит через границу года на 1 января.
    expect(calendar.get("2026-04-30")).toBe("pre_holiday");
    expect(calendar.get("2026-11-03")).toBe("pre_holiday");
    // 31 декабря 2026 предпраздничным не будет: постановление сделало его
    // выходным, и проверка этого — в разделе про переносы.
    expect(counts(2026).pre_holiday).toBe(4);
  });

  test("праздник в выходной переносит день отдыха вперёд", () => {
    // Ст. 112 ч. 2. В 2026 году 8 марта — воскресенье, и отдых переходит
    // на понедельник 9 марта.
    const calendar = statutoryCalendar(2026);
    expect(calendar.get("2026-03-08")).toBe("holiday");
    expect(calendar.get("2026-03-09")).toBe("weekend");
  });

  test("перенос новогодних выходных на 2026 год учтён", () => {
    // Постановление переносит субботу 3 и воскресенье 4 января на пятницу
    // 9 января и четверг 31 декабря. Недостачи больше нет.
    const calendar = statutoryCalendar(2026);
    expect(calendar.get("2026-01-09")).toBe("holiday");
    expect(calendar.get("2026-12-31")).toBe("holiday");
    expect(pendingTransfers(2026)).toEqual([]);
  });

  test("перенесённый выходной не становится предпраздничным", () => {
    // 31 декабря — нерабочий, и сокращать его на час по ст. 95 незачем.
    // Порядок шагов в расчёте календаря именно за этим и следит.
    expect(statutoryCalendar(2026).get("2026-12-31")).not.toBe("pre_holiday");
    expect(counts(2026).pre_holiday).toBe(4);
  });

  test("годовая норма 2026 сходится с официальным календарём", () => {
    const facts = calendarFactsFor("2026-01-01", "2027-01-01", new Map());
    expect(facts.workingDays).toBe(247);
    expect(facts.preHolidayDays).toBe(4);
    // 247 × 8 − 4 = 1972
    expect(facts.workingDays * 8 - facts.preHolidayDays).toBe(1972);
  });
});

describe("факты периода", () => {
  test("предпраздничный день считается и рабочим, и сокращённым", () => {
    // Апрель 2026: 22 рабочих дня и 175 часов, то есть 22 × 8 − 1.
    // Исключить 30 апреля из рабочих значило бы вычесть девять часов.
    const facts = calendarFactsFor("2026-04-01", "2026-05-01", new Map());
    expect(facts.workingDays).toBe(22);
    expect(facts.preHolidayDays).toBe(1);
  });

  test("праздники периода отдаются отдельным множеством", () => {
    const facts = calendarFactsFor("2026-01-01", "2026-02-01", new Map());
    // Восемь по ст. 112 ч. 1 плюс 9 января — перенесённый день.
    expect(facts.holidays.size).toBe(9);
    expect(facts.holidays.has("2026-01-07")).toBe(true);
    expect(facts.holidays.has("2026-01-09")).toBe(true);
  });

  test("граница периода полуоткрытая", () => {
    const facts = calendarFactsFor("2026-03-01", "2026-03-02", new Map());
    // 1 марта 2026 — воскресенье.
    expect(facts.workingDays).toBe(0);
  });

  test("период через границу года берёт календари обоих лет", () => {
    // Взят декабрь 2029: 31 декабря там понедельник, то есть рабочий
    // предпраздничный день, а 1 января 2030 — праздник. Годы с 2023 по
    // 2027 для этой проверки не годятся: их 31 декабря либо выходной по
    // календарю, либо сделан нерабочим по постановлению.
    const facts = calendarFactsFor("2029-12-31", "2030-01-02", new Map());
    expect(facts.workingDays).toBe(1);
    expect(facts.preHolidayDays).toBe(1);
    expect(facts.holidays.has("2030-01-01")).toBe(true);
  });
});

describe("правки человека", () => {
  test("правка перекрывает закон и помечается как своя", () => {
    const overrides = new Map<IsoDate, DayType>([["2026-06-11", "weekend"]]);
    const days = new Map(
      calendarWithOverrides(2026, overrides).map((item) => [item.day, item]),
    );

    expect(days.get("2026-06-11")?.dayType).toBe("weekend");
    expect(days.get("2026-06-11")?.source).toBe("override");
    expect(days.get("2026-06-10")?.source).toBe("statutory");
  });

  test("правка человека сильнее и постановления", () => {
    // Если в его части календарь всё-таки другой, правка обязана победить.
    const overrides = new Map<IsoDate, DayType>([["2026-01-09", "working"]]);
    const facts = calendarFactsFor(
      "2026-01-01",
      "2027-01-01",
      new Map([[2026, overrides]]),
    );
    expect(facts.workingDays).toBe(248);
  });
});
