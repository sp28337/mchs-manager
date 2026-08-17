import { describe, expect, it } from "vitest";

import {
  WEEKLY_NORM_GROUND_LABELS,
  deriveWeeklyNorm,
  weeklyNormGroundApplies,
  weeklyNormGroundOf,
  weeklyNormGroundToFacts,
  type EmploymentKind,
  type Gender,
  type WeeklyNormGround,
} from "./value-objects";
import {
  weeklyNormGroundFacts,
  weeklyNormGroundOfProfile,
  weeklyNormOf,
} from "../model/derive";
import type { StoredProfile } from "../storage/profile";

/**
 * Настройки дают выбрать норму напрямую, и выбор этот раскладывается в
 * признаки человека, из которых норму потом выводит `deriveWeeklyNorm`.
 * Двух списков здесь быть не должно: разойдись они — и человек увидит в
 * настройках «36 часов», а в расчёте получит 40.
 */
const GROUNDS: readonly WeeklyNormGround[] = [
  "base",
  "harmful",
  "northern",
  "disability",
];

const EXPECTED_HOURS: Record<WeeklyNormGround, string> = {
  base: "40",
  harmful: "36",
  northern: "36",
  disability: "35",
};

/** Тот, кому доступны все основания сразу. */
const ANYONE = { employment: "civilian" as EmploymentKind, gender: "female" as Gender };

describe("основание недельной нормы", () => {
  it("каждое основание даёт ровно те часы, которые обещает его подпись", () => {
    for (const ground of GROUNDS) {
      const norm = deriveWeeklyNorm({ ...ANYONE, ...weeklyNormGroundToFacts(ground) });
      expect(norm.hours.toFixed(0), ground).toBe(EXPECTED_HOURS[ground]);
      // Подпись начинается с того же числа: человек выбирает по нему.
      expect(WEEKLY_NORM_GROUND_LABELS[ground]).toMatch(
        new RegExp(`^${EXPECTED_HOURS[ground]} часов`),
      );
    }
  });

  it("обратное чтение возвращает то же основание", () => {
    for (const ground of GROUNDS) {
      const facts = { ...ANYONE, ...weeklyNormGroundToFacts(ground) };
      expect(weeklyNormGroundOf(facts), ground).toBe(ground);
    }
  });

  it("у основания всегда есть норма-источник", () => {
    for (const ground of GROUNDS) {
      const norm = deriveWeeklyNorm({ ...ANYONE, ...weeklyNormGroundToFacts(ground) });
      expect(norm.basis.length, ground).toBeGreaterThan(10);
    }
  });

  /**
   * Порядок проверок в `weeklyNormGroundOf` обязан совпадать с порядком в
   * `deriveWeeklyNorm`. Самый показательный случай — работник с
   * инвалидностью во вредных условиях: там срабатывают сразу два
   * основания, и показать нужно то, которое победило в расчёте.
   */
  it("при двух основаниях сразу показывается победившее — 35 часов", () => {
    const both = {
      employment: "civilian" as EmploymentKind,
      gender: "male" as Gender,
      conditions: "harmful_or_dangerous" as const,
      northernLocality: false,
      disabilityGroupIorII: true,
    };
    expect(deriveWeeklyNorm(both).hours.toFixed(0)).toBe("35");
    expect(weeklyNormGroundOf(both)).toBe("disability");
  });

  it("северное основание — только женщинам, инвалидность — только работникам", () => {
    expect(weeklyNormGroundApplies("northern", { employment: "attested", gender: "male" }))
      .toBe(false);
    expect(weeklyNormGroundApplies("northern", { employment: "attested", gender: "female" }))
      .toBe(true);
    expect(
      weeklyNormGroundApplies("disability", { employment: "attested", gender: "male" }),
    ).toBe(false);
    expect(
      weeklyNormGroundApplies("disability", { employment: "civilian", gender: "male" }),
    ).toBe(true);
  });

  /**
   * Недоступное основание не должно молча превращаться в другую норму: у
   * мужчины северный признак к 36 часам не приводит, и настройки, показав
   * «36», соврали бы.
   */
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
      employmentKind: "civilian",
      gender: "female",
      workingConditions: "normal",
      northernLocality: false,
      disabilityGroupIorII: false,
      guardNumber: 1,
      firstShiftDate: "2026-01-01",
      shiftStartTime: "08:00",
      monthlyPayBase: "",
      accountingYear: 2026,
      absences: [],
      callouts: [],
      calendarOverrides: {},
      dayNotes: {},
      liveMode: false,
      reported: null,
      savedAt: "2026-01-01T00:00:00.000Z",
    };

    for (const ground of GROUNDS) {
      const next: StoredProfile = { ...base, ...weeklyNormGroundFacts(ground) };
      expect(weeklyNormOf(next).hours.toFixed(0), ground).toBe(EXPECTED_HOURS[ground]);
      expect(weeklyNormGroundOfProfile(next), ground).toBe(ground);
    }
  });

  it("недоступное основание не даёт сокращения, и чтение это признаёт", () => {
    const manOnNorth = {
      employment: "attested" as EmploymentKind,
      gender: "male" as Gender,
      ...weeklyNormGroundToFacts("northern"),
    };
    expect(deriveWeeklyNorm(manOnNorth).hours.toFixed(0)).toBe("40");
    expect(weeklyNormGroundOf(manOnNorth)).toBe("base");
  });
});
