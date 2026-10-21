import { describe, expect, it } from "vitest";

import { statisticsOf } from "@/features/shift/model/statistics";
import { createProfile } from "@/features/shift/storage/profile";

import { PERIOD_FIGURES, PERIOD_FROM, PERIOD_TO } from "./how-it-works-demos";

/**
 * Показ «Учётный период» на главной обещает числа, которые человек увидит
 * внутри. Они выписаны в разметку руками — страница отдаётся статикой, — и
 * без этой проверки разошлись бы с расчётом при первой же его правке, а
 * заметил бы это только тот, кто сравнил бы главную с приложением.
 *
 * График — тот, что назван в комментарии к показу: «сутки через трое»,
 * смена с 08:00 длиной в сутки, первая смена 2 января 2026-го.
 */
const PROFILE = createProfile({
  displayName: "Показ",
  workingConditions: "normal",
  disabilityGroupIorII: false,
  firstShiftDate: "2026-01-02",
  accountingYear: 2026,
  shiftStartTime: "08:00",
  schedulePattern: "1|3",
  shiftDurationHours: "24",
  customWorkDays: 1,
  customRestDays: 3,
});

function figuresOf(kind: "year" | "quarter", index: number) {
  const { total } = statisticsOf(PROFILE, "2026-12-31", { kind, index });
  return {
    norm: total.normHours.toString(),
    actual: total.actualHours.toString(),
    balance: total.actualHours.minus(total.normHours).toString(),
  };
}

describe("показ «Учётный период»", () => {
  it("начинает с года и нажимает на второй квартал", () => {
    expect(PERIOD_FROM).toMatchObject({ kind: "year", label: "Весь год" });
    expect(PERIOD_TO).toMatchObject({ kind: "quarter", index: 1, label: "2-й квартал" });
  });

  it("числа за год — те, что считает приложение", () => {
    expect(figuresOf(PERIOD_FROM.kind as "year", PERIOD_FROM.index)).toEqual(PERIOD_FIGURES.year);
  });

  it("числа за второй квартал — те, что считает приложение", () => {
    expect(figuresOf(PERIOD_TO.kind as "quarter", PERIOD_TO.index)).toEqual(PERIOD_FIGURES.quarter);
  });

  it("переработка на показе — разница отработанного и нормы", () => {
    for (const figures of Object.values(PERIOD_FIGURES)) {
      expect(Number(figures.actual) - Number(figures.norm)).toBe(Number(figures.balance));
    }
  });
});
