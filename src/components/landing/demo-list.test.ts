import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ABSENCE_LABELS,
  CALLOUT_LABELS,
} from "@/features/shift/schemas";

import { DEMO_LIST, rowOf } from "./demo-list";

/**
 * Перечень на главной обязан называть виды так же, как перечень в расчёте:
 * названия записаны здесь отдельно (схемы тянут домен, а лендинг лёгкий),
 * и разойтись им можно только молча — эта сверка и есть «не молча».
 */
describe("перечень видов на главной", () => {
  const label = (key: string) => DEMO_LIST.find((row) => row.key === key)?.label;

  it("названия отсутствий и вызова — настоящие", () => {
    expect(label("annual_leave")).toBe(ABSENCE_LABELS.annual_leave);
    expect(label("extra_leave")).toBe(ABSENCE_LABELS.extra_leave);
    expect(label("study_leave")).toBe(ABSENCE_LABELS.study_leave);
    expect(label("business_trip")).toBe(ABSENCE_LABELS.business_trip);
    expect(label("sick_leave")).toBe(ABSENCE_LABELS.sick_leave);
    expect(label("callout")).toBe(CALLOUT_LABELS.callout);
  });

  it("строки смены и заметки — те же слова, что в перечне у клетки", () => {
    const source = readFileSync(
      new URL("../../features/shift/components/day-ring.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain(`label: "${label("shift")}"`);
    expect(source).toContain(`short: "${label("note")}"`);
  });

  it("порядок строк — как у перечня графика, без отгула", () => {
    expect(DEMO_LIST.map((row) => row.key)).toEqual([
      "annual_leave",
      "extra_leave",
      "study_leave",
      "business_trip",
      "sick_leave",
      "callout",
      "shift",
      "note",
    ]);
    expect(rowOf("sick_leave")).toBe(4);
    expect(rowOf("callout")).toBe(5);
  });
});
