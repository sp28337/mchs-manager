import { describe, expect, it } from "vitest";

import { RING_GAP, arcPath, ringSegments } from "./period-ring";

/**
 * Кольцо знака периода.
 *
 * Знак — единственное, что на кнопке периода показывает выбор без слов, и
 * ошибка в нём молчаливая: квартал, нарисованный не на своём месте, никто
 * не заметит, пока не перепутает. Поэтому проверяется сама раскладка:
 * какой отрезок где стоит и какой горит.
 */
describe("кольцо периода", () => {
  it("год — одно кольцо целиком, без просветов", () => {
    expect(ringSegments("year", 0)).toEqual([{ from: 0, to: 360, on: true }]);
  });

  it("первое полугодие — левая половина, второе — правая", () => {
    const [first, second] = ringSegments("half_year", 0);
    // Левая половина — от 6 часов через 9 к 12, то есть от 180° до 360°.
    expect(first).toEqual({ from: 180 + RING_GAP / 2, to: 360 - RING_GAP / 2, on: true });
    expect(second).toEqual({ from: RING_GAP / 2, to: 180 - RING_GAP / 2, on: false });
  });

  it("кварталы — против часовой стрелки от верха", () => {
    const middles = ringSegments("quarter", 0).map(({ from, to }) => (from + to) / 2);
    // Середины: слева вверху, слева внизу, справа внизу, справа вверху.
    expect(middles).toEqual([315, 225, 135, 45]);
  });

  it("два первых квартала лежат в первом полугодии", () => {
    const [half] = ringSegments("half_year", 0);
    if (half === undefined) throw new Error("полугодий нет");
    for (const quarter of ringSegments("quarter", 0).slice(0, 2)) {
      expect(quarter.from).toBeGreaterThanOrEqual(half.from);
      expect(quarter.to).toBeLessThanOrEqual(half.to);
    }
  });

  it("горит ровно выбранный отрезок", () => {
    for (let index = 0; index < 4; index += 1) {
      const lit = ringSegments("quarter", index).flatMap((segment, at) =>
        segment.on ? [at] : [],
      );
      expect(lit).toEqual([index]);
    }
  });

  it("просвет между соседями везде один и тот же", () => {
    const quarters = ringSegments("quarter", 0).toSorted((a, b) => a.from - b.from);
    const gaps = quarters.map((segment, at) => {
      const next = quarters[(at + 1) % quarters.length] ?? segment;
      return (next.from - segment.to + 360) % 360;
    });
    expect(new Set(gaps)).toEqual(new Set([RING_GAP]));
  });

  it("дуга идёт по часовой стрелке и знает, когда она больше половины", () => {
    // Верхняя правая четверть: от 12 часов к 3 — малая дуга.
    expect(arcPath(0, 90)).toBe("M12 2A10 10 0 0 1 22 12");
    // Почти полный круг — большая.
    expect(arcPath(10, 350)).toMatch(/A10 10 0 1 1 /);
  });
});
