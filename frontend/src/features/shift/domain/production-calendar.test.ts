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

  test("все четырнадцать праздников ст. 112 размечены", () => {
    expect(counts(2026).holiday).toBe(14);
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
    expect(calendar.get("2026-12-31")).toBe("pre_holiday");
    expect(counts(2026).pre_holiday).toBe(5);
  });

  test("праздник в выходной переносит день отдыха вперёд", () => {
    // Ст. 112 ч. 2. В 2026 году 8 марта — воскресенье, и отдых переходит
    // на понедельник 9 марта.
    const calendar = statutoryCalendar(2026);
    expect(calendar.get("2026-03-08")).toBe("holiday");
    expect(calendar.get("2026-03-09")).toBe("weekend");
  });

  test("из новогодних каникул автоматического переноса нет", () => {
    // 3 и 4 января 2026 — суббота и воскресенье внутри каникул. Ст. 112
    // ч. 2 сюда не применяется: перенос задаёт постановление
    // Правительства, которого приложение не знает.
    expect(pendingTransfers(2026)).toEqual(["2026-01-03", "2026-01-04"]);
  });

  test("непроставленный перенос завышает годовую норму на 16 часов", () => {
    // Цена молчания, названная числом. Официальный календарь 2026 года
    // даёт 247 рабочих дней, базовый — 249.
    const facts = calendarFactsFor("2026-01-01", "2027-01-01", new Map());
    expect(facts.workingDays).toBe(249);
    expect(facts.preHolidayDays).toBe(5);
    expect(facts.workingDays - pendingTransfers(2026).length).toBe(247);
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
    expect(facts.holidays.size).toBe(8);
    expect(facts.holidays.has("2026-01-07")).toBe(true);
  });

  test("граница периода полуоткрытая", () => {
    const facts = calendarFactsFor("2026-03-01", "2026-03-02", new Map());
    // 1 марта 2026 — воскресенье.
    expect(facts.workingDays).toBe(0);
  });

  test("период через границу года берёт календари обоих лет", () => {
    const facts = calendarFactsFor("2026-12-31", "2027-01-02", new Map());
    // 31 декабря 2026 — предпраздничный рабочий, 1 января 2027 — праздник.
    expect(facts.workingDays).toBe(1);
    expect(facts.preHolidayDays).toBe(1);
    expect(facts.holidays.has("2027-01-01")).toBe(true);
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

  test("два перенесённых выходных дают официальную норму 2026 года", () => {
    // Ровно то, ради чего календарь редактируемый: человек проставляет
    // перенос, и годовая норма сходится с официальной — 1971 час.
    const overrides = new Map<IsoDate, DayType>([
      ["2026-01-09", "weekend"],
      ["2026-02-02", "weekend"],
    ]);
    const facts = calendarFactsFor(
      "2026-01-01",
      "2027-01-01",
      new Map([[2026, overrides]]),
    );

    expect(facts.workingDays).toBe(247);
    // 247 × 8 − 5 = 1971
    expect(facts.workingDays * 8 - facts.preHolidayDays).toBe(1971);
  });
});
