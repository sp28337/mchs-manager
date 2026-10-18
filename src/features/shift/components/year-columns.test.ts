import { describe, expect, it } from "vitest";

import type { IsoDate } from "../domain/plain-date";
import { balancedColumns, monthsInPeriod } from "./year-columns";

const day = (iso: string) => iso as IsoDate;

describe("monthsInPeriod", () => {
  it("год, полугодие и квартал — по числу месяцев", () => {
    expect(monthsInPeriod(day("2026-01-01"), day("2027-01-01"))).toBe(12);
    expect(monthsInPeriod(day("2026-07-01"), day("2027-01-01"))).toBe(6);
    expect(monthsInPeriod(day("2026-07-01"), day("2026-10-01"))).toBe(3);
  });

  it("частичный первый и последний месяцы считаются целыми", () => {
    // Начало отсчёта в середине марта — март на сетке есть.
    expect(monthsInPeriod(day("2026-03-15"), day("2027-01-01"))).toBe(10);
    // «Онлайн» обрезает отрезок серединой месяца — этот месяц тоже.
    expect(monthsInPeriod(day("2026-01-01"), day("2026-05-12"))).toBe(5);
  });

  it("пустой отрезок — ноль", () => {
    expect(monthsInPeriod(day("2026-05-01"), day("2026-05-01"))).toBe(0);
  });
});

describe("balancedColumns", () => {
  it("шесть месяцев при пяти в ряду — два ряда по три", () => {
    expect(balancedColumns(6, 5)).toBe(3);
    expect(balancedColumns(6, 4)).toBe(3);
  });

  it("двенадцать месяцев — ровные ряды при любом масштабе", () => {
    expect(balancedColumns(12, 4)).toBe(4);
    expect(balancedColumns(12, 5)).toBe(4);
    expect(balancedColumns(12, 7)).toBe(6);
    expect(balancedColumns(12, 8)).toBe(6);
    expect(balancedColumns(12, 2)).toBe(2);
  });

  it("всё влезает в один ряд — столько колонок, сколько месяцев", () => {
    expect(balancedColumns(3, 4)).toBe(3);
    expect(balancedColumns(6, 6)).toBe(6);
    expect(balancedColumns(1, 8)).toBe(1);
  });

  it("не делится поровну — последний ряд короче, колонок не больше нужного", () => {
    expect(balancedColumns(7, 5)).toBe(4);
    expect(balancedColumns(3, 2)).toBe(2);
  });

  it("пустой период не ломает расчёт", () => {
    expect(balancedColumns(0, 4)).toBe(4);
  });
});
