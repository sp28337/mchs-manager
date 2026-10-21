import { describe, expect, it } from "vitest";

import { addDays, weekday, type IsoDate } from "../domain/plain-date";
import { createProfile, type StoredProfile } from "../storage/profile";
import { shiftOn } from "./derive";
import {
  PREVIEW_WEEKS,
  previewCells,
  previewFirstDay,
  previewTotals,
} from "./schedule-preview";

/**
 * Предпросмотр графика в окне «Создать график».
 *
 * Проверяется то, на чём он держится: он показывает ровно те сутки сменами, что
 * назовёт сменами расчёт, — и считает итог тем же расчётом.
 */

function profileOf(over: Partial<StoredProfile> = {}): StoredProfile {
  return createProfile({
    displayName: "Тест",
    workingConditions: "normal",
    disabilityGroupIorII: false,
    firstShiftDate: "2026-10-21",
    accountingYear: 2026,
    shiftStartTime: "08:00",
    schedulePattern: "1|3",
    shiftDurationHours: "24",
    customWorkDays: 1,
    customRestDays: 3,
    ...over,
  });
}

// 21 октября 2026 — среда.
const TODAY: IsoDate = "2026-10-21";

describe("окно времени", () => {
  it("начинается с понедельника нынешней недели", () => {
    const first = previewFirstDay(TODAY);

    expect(weekday(first)).toBe(0);
    expect(first).toBe("2026-10-19");
  });

  it("пять недель, и сегодня среди них отмечено ровно одно", () => {
    const cells = previewCells(profileOf(), TODAY);

    expect(cells).toHaveLength(PREVIEW_WEEKS * 7);
    expect(cells.filter((cell) => cell.today).map((cell) => cell.day)).toEqual([TODAY]);
  });
});

describe("сутки через трое, смена с 08:00 на 24 часа", () => {
  const cells = previewCells(profileOf(), TODAY);
  const at = (day: IsoDate) => cells.find((cell) => cell.day === day)!;

  it("заступление — шестнадцать часов, продолжение на следующих сутках — восемь", () => {
    expect(at("2026-10-21")).toMatchObject({ kind: "start", hours: "16" });
    expect(at("2026-10-22")).toMatchObject({ kind: "tail", hours: "8" });
  });

  it("свободные сутки без часов", () => {
    expect(at("2026-10-23")).toMatchObject({ kind: "free", hours: "" });
    expect(at("2026-10-24")).toMatchObject({ kind: "free", hours: "" });
  });

  it("цикл повторяется через четыре дня", () => {
    expect(at("2026-10-25").kind).toBe("start");
    expect(at("2026-10-29").kind).toBe("start");
    expect(at("2026-11-02").kind).toBe("start");
  });

  it("цикл строится и назад от названной смены: до неё сутки свободны по тому же ритму", () => {
    // Предыдущая смена — 17 октября, до окна; её хвост ушёл на 18-е, так что
    // понедельник 19-го — свободные сутки.
    expect(at("2026-10-19").kind).toBe("free");
    expect(at("2026-10-20").kind).toBe("free");
  });

  it("заступления — ровно те сутки, которые расчёт считает сменой", () => {
    const profile = profileOf();

    for (const cell of cells) {
      expect(cell.kind === "start").toBe(shiftOn(profile, cell.day));
    }
  });
});

describe("другие графики", () => {
  it("два через два по двенадцать часов с восьми: смена не перевалила за полночь", () => {
    const cells = previewCells(
      profileOf({ schedulePattern: "2|2", shiftDurationHours: "12" }),
      TODAY,
    );
    const starts = cells.filter((cell) => cell.kind === "start");

    expect(starts.length).toBeGreaterThan(0);
    expect(starts.every((cell) => cell.hours === "12")).toBe(true);
    expect(cells.some((cell) => cell.kind === "tail")).toBe(false);
  });

  it("ночная двенадцатичасовая: вечером четыре часа, утром — остаток и снова четыре", () => {
    const cells = previewCells(
      profileOf({ schedulePattern: "2|2", shiftDurationHours: "12", shiftStartTime: "20:00" }),
      TODAY,
    );
    const first = cells.find((cell) => cell.kind === "start")!;

    expect(first.hours).toBe("4");
    const next = cells.find((cell) => cell.day === addDays(first.day, 1))!;
    // Вторые сутки пары: восемь часов хвоста первой смены и четыре начала второй.
    expect(next.kind).toBe("start");
    expect(next.hours).toBe("12");
  });

  it("рабочая неделя идёт по производственному календарю, а не по циклу", () => {
    const cells = previewCells(
      profileOf({ schedulePattern: "5|2", shiftDurationHours: "8" }),
      TODAY,
    );

    // Понедельник — пятница нынешней недели — смены, суббота и воскресенье — нет.
    expect(cells.slice(0, 5).every((cell) => cell.kind === "start")).toBe(true);
    expect(cells[5]?.kind).toBe("free");
    expect(cells[6]?.kind).toBe("free");
  });
});

describe("итог месяца", () => {
  it("нормы и часов столько, сколько насчитает расчёт за октябрь", () => {
    const totals = previewTotals(profileOf(), TODAY);

    expect(totals.month).toBe(9);
    expect(Number(totals.norm.replace(",", "."))).toBeGreaterThan(0);
    expect(Number(totals.actual.replace(",", "."))).toBeGreaterThan(0);
  });

  it("знак разницы взаимоисключающий: недоработка и переработка вместе не бывают", () => {
    const totals = previewTotals(profileOf(), TODAY);

    expect(totals.under && totals.over).toBe(false);
  });

  it("свой график той же длительности меняет итог", () => {
    const base = previewTotals(profileOf(), TODAY);
    const rare = previewTotals(profileOf({ schedulePattern: "1|4" }), TODAY);

    expect(rare.actual).not.toBe(base.actual);
  });
});
