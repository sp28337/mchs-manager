import { describe, expect, it } from "vitest";

import { Dec } from "./decimal";
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
const EXPECTED_HOURS: Record<Exclude<WeeklyNormGround, "custom">, string> = {
  base: "40",
  harmful: "36",
  disability: "35",
};

/**
 * Основания из закона — те, у которых число известно заранее. «Настроить» в них
 * не входит: у неё числа нет, пока человек его не назвал, и проверяется она
 * отдельно, ниже.
 */
const LAWFUL = WEEKLY_NORM_GROUNDS.filter((g) => g !== "custom");

/** Профиль-образец: от него отталкиваются проверки, трогающие хранилище. */
function profile(): StoredProfile {
  return {
    schemaVersion: 1,
    displayName: "Тест",
    workingConditions: "normal",
    disabilityGroupIorII: false,
    firstShiftDate: "2026-01-01",
    countFrom: null,
    shiftStartTime: "08:00",
    schedulePattern: "1|3",
    shiftDurationHours: "24",
    weeklyNormHours: null,
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
}

describe("основание недельной нормы", () => {
  /**
   * Список оснований один — доменный. Раньше тест держал свою копию, и
   * добавить основание можно было, не заметив, что тест его не проверяет.
   */
  it("проверяются все основания, какие есть в домене", () => {
    expect([...WEEKLY_NORM_GROUNDS].sort()).toEqual(
      [...Object.keys(EXPECTED_HOURS), "custom"].sort(),
    );
  });

  it("каждое основание даёт ровно те часы, которые обещает его подпись", () => {
    for (const ground of LAWFUL) {
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
    for (const ground of LAWFUL) {
      expect(weeklyNormGroundOf(weeklyNormGroundToFacts(ground)), ground).toBe(ground);
    }
  });

  it("у основания всегда есть норма-источник", () => {
    for (const ground of LAWFUL) {
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
    const base = profile();

    for (const ground of LAWFUL) {
      const next: StoredProfile = { ...base, ...weeklyNormGroundFacts(ground) };
      expect(weeklyNormOf(next).hours.toFixed(0), ground).toBe(
        EXPECTED_HOURS[ground as Exclude<WeeklyNormGround, "custom">],
      );
      expect(weeklyNormGroundOfProfile(next), ground).toBe(ground);
    }
  });
});

/**
 * Своя норма — та, что человек назвал сам. Оснований сокращённой недели
 * больше трёх: её ставят коллективным договором, отраслевым соглашением,
 * приказом по части. Перечислить всё списком нельзя, поэтому и заведено
 * поле — а раз заведено, оно обязано перебивать выведенное из закона.
 */
describe("своя недельная норма", () => {
  it("перебивает основание из закона", () => {
    const norm = deriveWeeklyNorm({
      conditions: "harmful_or_dangerous",
      disabilityGroupIorII: true,
      customHours: new Dec("30"),
    });
    expect(norm.hours.toFixed(0)).toBe("30");
    expect(norm.basis.length).toBeGreaterThan(10);
  });

  it("опознаётся обратным чтением", () => {
    expect(weeklyNormGroundOf({ conditions: "normal", customHours: new Dec("30") })).toBe(
      "custom",
    );
  });

  /**
   * Поле принимает набранное как есть — человек печатает по знаку, — и
   * бессмысленное в расчёт попасть не должно. Тогда действует основание из
   * закона, как будто своей нормы и не называли.
   */
  it("пустое, нулевое и запредельное не считаются нормой", () => {
    for (const hours of [null, new Dec("0"), new Dec("-5"), new Dec("41")]) {
      const norm = deriveWeeklyNorm({ conditions: "normal", customHours: hours });
      expect(norm.hours.toFixed(0), String(hours)).toBe("40");
    }
    // Сорок ровно — можно: это верхняя граница, а не запрет.
    expect(
      deriveWeeklyNorm({ conditions: "normal", customHours: new Dec("40") }).hours.toFixed(0),
    ).toBe("40");
  });

  it("живёт в профиле строкой и читается расчётом", () => {
    const next: StoredProfile = {
      ...profile(),
      ...weeklyNormGroundFacts("custom", "39,5"),
    };
    expect(next.weeklyNormHours).toBe("39,5");
    expect(weeklyNormOf(next).hours.toFixed(1)).toBe("39.5");
    expect(weeklyNormGroundOfProfile(next)).toBe("custom");
  });

  /**
   * Выбор основания из закона обязан СНИМАТЬ свою норму: останься она —
   * список показывал бы «36 ч», а расчёт продолжал считать по своей.
   */
  it("выбор основания из закона снимает своё число", () => {
    const custom: StoredProfile = {
      ...profile(),
      ...weeklyNormGroundFacts("custom", "30"),
    };
    const back: StoredProfile = { ...custom, ...weeklyNormGroundFacts("harmful") };
    expect(back.weeklyNormHours).toBeNull();
    expect(weeklyNormOf(back).hours.toFixed(0)).toBe("36");
    expect(weeklyNormGroundOfProfile(back)).toBe("harmful");
  });
});
