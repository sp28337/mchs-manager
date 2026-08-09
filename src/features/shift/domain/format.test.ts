import { describe, expect, test } from "vitest";

import {
  formatDateLongRu,
  formatDateRu,
  formatPeriodRu,
  maskDateRu,
  parseDateRu,
} from "./format";

describe("показ даты", () => {
  test("день, месяц, год — как в приказе", () => {
    expect(formatDateRu("2026-03-01")).toBe("01.03.2026");
    expect(formatDateLongRu("2026-03-01")).toBe("1 марта 2026 г.");
  });

  test("ровный месяц называется месяцем", () => {
    expect(formatPeriodRu("2026-03-01", "2026-04-01")).toBe("март 2026");
    expect(formatPeriodRu("2026-02-01", "2026-03-01")).toBe("февраль 2026");
    expect(formatPeriodRu("2026-12-01", "2027-01-01")).toBe("декабрь 2026");
  });

  test("верхняя граница показывается последним включённым днём", () => {
    // Полугодие кончается 30 июня, а не «1 июля»: соглашение о
    // полуинтервалах — наше, а не человека.
    expect(formatPeriodRu("2026-01-01", "2026-07-01")).toBe("01.01.2026 — 30.06.2026");
    expect(formatPeriodRu("2026-01-01", "2027-01-01")).toBe("01.01.2026 — 31.12.2026");
  });
});

describe("разбор введённого", () => {
  test("точки не обязательны", () => {
    expect(parseDateRu("01.03.2026")).toBe("2026-03-01");
    expect(parseDateRu("1.3.2026")).toBe("2026-03-01");
    expect(parseDateRu("01032026")).toBe("2026-03-01");
    expect(parseDateRu(" 01.03.2026 ")).toBe("2026-03-01");
  });

  test("несуществующая дата отвергается, а не исправляется", () => {
    // `new Date("2026-02-31")` дал бы 3 марта — день, которого человек не
    // вводил, и он попал бы в расчёт молча.
    expect(parseDateRu("31.02.2026")).toBeNull();
    expect(parseDateRu("29.02.2026")).toBeNull();
    expect(parseDateRu("29.02.2024")).toBe("2024-02-29");
    expect(parseDateRu("31.04.2026")).toBeNull();
    expect(parseDateRu("00.03.2026")).toBeNull();
    expect(parseDateRu("01.13.2026")).toBeNull();
  });

  test("недописанное — не дата", () => {
    expect(parseDateRu("")).toBeNull();
    expect(parseDateRu("01.03")).toBeNull();
    expect(parseDateRu("01.03.20")).toBeNull();
  });

  test("американский порядок не подставляется", () => {
    // Ровно та путаница, из-за которой нативный ввод и заменён: 03.01
    // здесь всегда третье января, а не первое марта.
    expect(parseDateRu("03.01.2026")).toBe("2026-01-03");
  });
});

describe("маска при наборе", () => {
  test("точки подставляются по ходу", () => {
    expect(maskDateRu("0")).toBe("0");
    expect(maskDateRu("01")).toBe("01");
    expect(maskDateRu("013")).toBe("01.3");
    expect(maskDateRu("0103")).toBe("01.03");
    expect(maskDateRu("01032026")).toBe("01.03.2026");
  });

  test("уже введённые точки не удваиваются", () => {
    expect(maskDateRu("01.03.2026")).toBe("01.03.2026");
    expect(maskDateRu("01.")).toBe("01");
  });

  test("лишние цифры отбрасываются", () => {
    expect(maskDateRu("010320269999")).toBe("01.03.2026");
  });
});
