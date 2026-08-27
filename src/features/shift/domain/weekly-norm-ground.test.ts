import { describe, expect, it } from "vitest";

import {
  WEEKLY_NORM_GROUNDS,
  WEEKLY_NORM_GROUND_LABELS,
  deriveWeeklyNorm,
  weeklyNormGroundOf,
  weeklyNormGroundToFacts,
  type WeeklyNormGround,
} from "./value-objects";
import {
  weeklyNormGroundFacts,
  weeklyNormGroundOfProfile,
  weeklyNormOf,
} from "../model/derive";
import type { StoredProfile } from "../storage/profile";

/**
 * Норма выбирается напрямую — основанием, — и выбор этот раскладывается в
 * признаки, из которых норму потом выводит `deriveWeeklyNorm`. Двух списков
 * здесь быть не должно: разойдись они — и человек увидит в настройках
 * «36 часов», а в расчёте получит 40.
 */
const EXPECTED_HOURS: Record<WeeklyNormGround, string> = {
  base: "40",
  harmful: "36",
  disability: "35",
};

describe("основание недельной нормы", () => {
  /**
   * Список оснований один — доменный. Раньше тест держал свою копию, и
   * добавить основание можно было, не заметив, что тест его не проверяет.
   */
  it("проверяются все основания, какие есть в домене", () => {
    expect([...WEEKLY_NORM_GROUNDS].sort()).toEqual(
      Object.keys(EXPECTED_HOURS).sort(),
    );
  });

  it("каждое основание даёт ровно те часы, которые обещает его подпись", () => {
    for (const ground of WEEKLY_NORM_GROUNDS) {
      const norm = deriveWeeklyNorm(weeklyNormGroundToFacts(ground));
      expect(norm.hours.toFixed(0), ground).toBe(EXPECTED_HOURS[ground]);
      // Подпись начинается с того же числа: человек выбирает по нему.
      //
      // Проверяется ЧИСЛО, а не вся строка целиком. Слово при нём — дело
      // вёрстки: в списке настроек, где подпись стоит справа от вопроса,
      // «40 часов» не влезало, и осталось «40 ч». Привязывать тест к
      // такому значило бы ломать его при каждой правке ширины колонки.
      expect(WEEKLY_NORM_GROUND_LABELS[ground]).toMatch(
        new RegExp(`^${EXPECTED_HOURS[ground]}\\s`),
      );
    }
  });

  it("обратное чтение возвращает то же основание", () => {
    for (const ground of WEEKLY_NORM_GROUNDS) {
      expect(weeklyNormGroundOf(weeklyNormGroundToFacts(ground)), ground).toBe(ground);
    }
  });

  it("у основания всегда есть норма-источник", () => {
    for (const ground of WEEKLY_NORM_GROUNDS) {
      const norm = deriveWeeklyNorm(weeklyNormGroundToFacts(ground));
      expect(norm.basis.length, ground).toBeGreaterThan(10);
    }
  });

  /**
   * Порядок проверок в `weeklyNormGroundOf` обязан совпадать с порядком в
   * `deriveWeeklyNorm`. Самый показательный случай — инвалидность во
   * вредных условиях: там срабатывают сразу два основания, и показать нужно
   * то, которое победило в расчёте.
   */
  it("при двух основаниях сразу показывается победившее — 35 часов", () => {
    const both = {
      conditions: "harmful_or_dangerous" as const,
      disabilityGroupIorII: true,
    };
    expect(deriveWeeklyNorm(both).hours.toFixed(0)).toBe("35");
    expect(weeklyNormGroundOf(both)).toBe("disability");
  });

  /**
   * Основание раскладывается в признаки ПРОФИЛЯ, а профиль зовёт условия
   * труда `workingConditions`, тогда как домен — `conditions`. Первая
   * версия подмешивала доменные имена прямо в профиль, и «36 часов —
   * вредные условия» молча оставляли 40: посторонний ключ записывался,
   * настоящий — нет. Проверка лишних полей при расширении объекта такое не
   * ловит, поэтому ловит тест.
   */
  it("основание раскладывается именно в те поля, которые читает расчёт", () => {
    const base: StoredProfile = {
      schemaVersion: 1,
      displayName: "Тест",
      workingConditions: "normal",
      disabilityGroupIorII: false,
      firstShiftDate: "2026-01-01",
      shiftStartTime: "08:00",
      schedulePattern: "1|3",
      shiftDurationHours: "24",
      customWorkDays: 1,
      customRestDays: 3,
      accountingYear: 2026,
      absences: [],
      callouts: [],
      calendarOverrides: {},
      shiftOverrides: {},
      shiftTimes: {},
      dayNotes: {},
      liveMode: false,
      overtimeInDays: false,
      savedAt: "2026-01-01T00:00:00.000Z",
    };

    for (const ground of WEEKLY_NORM_GROUNDS) {
      const next: StoredProfile = { ...base, ...weeklyNormGroundFacts(ground) };
      expect(weeklyNormOf(next).hours.toFixed(0), ground).toBe(EXPECTED_HOURS[ground]);
      expect(weeklyNormGroundOfProfile(next), ground).toBe(ground);
    }
  });
});
