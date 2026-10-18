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

  it("места кольца — против часовой стрелки от верха", () => {
    const middles = ringSegments("quarter", 0).map(({ from, to }) => (from + to) / 2);
    // Середины мест: слева вверху, слева внизу, справа внизу, справа вверху.
    expect(middles).toEqual([315, 225, 135, 45]);
  });

  it("кварталы идут по часовой стрелке от нижней левой четверти", () => {
    const middle = (index: number) => {
      const lit = ringSegments("quarter", index).find((segment) => segment.on);
      if (lit === undefined) throw new Error("выбранной четверти нет");
      return (lit.from + lit.to) / 2;
    };
    // Первый — слева внизу, второй — слева вверху, третий — справа вверху,
    // четвёртый — справа внизу.
    expect([0, 1, 2, 3].map(middle)).toEqual([225, 315, 45, 135]);
  });

  it("два первых квартала лежат в первом полугодии, два последних — во втором", () => {
    const lit = (kind: "half_year" | "quarter", index: number) => {
      const found = ringSegments(kind, index).find((segment) => segment.on);
      if (found === undefined) throw new Error("выбранного отрезка нет");
      return found;
    };
    const first = lit("half_year", 0);
    const second = lit("half_year", 1);
    for (const index of [0, 1]) {
      const quarter = lit("quarter", index);
      expect(quarter.from).toBeGreaterThanOrEqual(first.from);
      expect(quarter.to).toBeLessThanOrEqual(first.to);
    }
    for (const index of [2, 3]) {
      const quarter = lit("quarter", index);
      expect(quarter.from).toBeGreaterThanOrEqual(second.from);
      expect(quarter.to).toBeLessThanOrEqual(second.to);
    }
  });

  it("горит ровно один отрезок, и у каждой доли свой", () => {
    const places = [0, 1, 2, 3].map((index) => {
      const lit = ringSegments("quarter", index).flatMap((segment, at) =>
        segment.on ? [at] : [],
      );
      expect(lit).toHaveLength(1);
      return lit[0];
    });
    expect(new Set(places).size).toBe(4);
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
