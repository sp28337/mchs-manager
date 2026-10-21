import { describe, expect, it } from "vitest";

import type { IsoDate } from "../domain/plain-date";
import { spanOn, timelineOf } from "./stats-timeline";

/**
 * Лента периода — арифметика долей ширины.
 *
 * Ошибка здесь тихая: сдвиг на сутки глазом не виден, а событие июня оказывается
 * в июле. Поэтому проверяются края, обрезка и високосный год.
 */

const YEAR = Array.from({ length: 12 }, (_, month) => month);
const day = (iso: string) => iso as IsoDate;

describe("лента года", () => {
  it("весь год: 365 суток, январь с нуля, июль после 181 суток", () => {
    const timeline = timelineOf(2026, YEAR, day("2026-03-01"));

    expect(timeline.days).toBe(365);
    expect(timeline.months).toHaveLength(12);
    expect(timeline.months[0]).toEqual({ month: 0, left: 0 });
    // До 1 июля прошло 31+28+31+30+31+30 = 181 сутки.
    expect(timeline.months[6]!.left).toBeCloseTo((181 / 365) * 100, 6);
  });

  it("високосный год длиннее на сутки", () => {
    expect(timelineOf(2028, YEAR, day("2028-01-01")).days).toBe(366);
  });

  it("квартал: лента только на его три месяца", () => {
    const timeline = timelineOf(2026, [3, 4, 5], day("2026-05-10"));

    expect(timeline.start).toBe("2026-04-01");
    expect(timeline.end).toBe("2026-07-01");
    expect(timeline.days).toBe(30 + 31 + 30);
    expect(timeline.months.map((it) => it.month)).toEqual([3, 4, 5]);
    expect(timeline.months[0]!.left).toBe(0);
  });

  it("сегодня — середина своих суток, а вне ленты его нет", () => {
    const first = timelineOf(2026, YEAR, day("2026-01-01"));
    expect(first.today).toBeCloseTo((0.5 / 365) * 100, 6);

    const last = timelineOf(2026, YEAR, day("2026-12-31"));
    expect(last.today).toBeCloseTo((364.5 / 365) * 100, 6);

    // Лента второго квартала, а сегодня — в январе года.
    expect(timelineOf(2026, [3, 4, 5], day("2026-01-15")).today).toBeNull();
    // И на сутки после конца ленты тоже: конец не включается.
    expect(timelineOf(2026, [3, 4, 5], day("2026-07-01")).today).toBeNull();
    expect(timelineOf(2026, [3, 4, 5], day("2026-03-31")).today).toBeNull();
  });
});

describe("отрезок на ленте", () => {
  const timeline = timelineOf(2026, YEAR, day("2026-06-01"));

  it("одни сутки — одна 365-я ширины", () => {
    const span = spanOn(timeline, day("2026-01-01"), day("2026-01-01"))!;

    expect(span.left).toBe(0);
    expect(span.width).toBeCloseTo(100 / 365, 6);
  });

  it("включительно с обоих концов: 6–26 июля — двадцать одни сутки", () => {
    const span = spanOn(timeline, day("2026-07-06"), day("2026-07-26"))!;

    expect(span.left).toBeCloseTo(((181 + 5) / 365) * 100, 6);
    expect(span.width).toBeCloseTo((21 / 365) * 100, 6);
  });

  it("последние сутки года кончаются ровно на правом краю", () => {
    const span = spanOn(timeline, day("2026-12-25"), day("2026-12-31"))!;

    expect(span.left + span.width).toBeCloseTo(100, 6);
  });

  it("запись, вышедшая за край, обрезается по нему", () => {
    const quarter = timelineOf(2026, [6, 7, 8], day("2026-07-10"));

    // Отпуск с 20 июня по 10 июля: на ленте с 1 июля — только десять суток.
    const span = spanOn(quarter, day("2026-06-20"), day("2026-07-10"))!;
    expect(span.left).toBe(0);
    expect(span.width).toBeCloseTo((10 / quarter.days) * 100, 6);

    // А выходящий вправо — до последних суток ленты.
    const tail = spanOn(quarter, day("2026-09-25"), day("2026-10-05"))!;
    expect(tail.left + tail.width).toBeCloseTo(100, 6);
  });

  it("целиком вне ленты — нечего рисовать", () => {
    const quarter = timelineOf(2026, [6, 7, 8], day("2026-07-10"));

    expect(spanOn(quarter, day("2026-03-01"), day("2026-03-05"))).toBeNull();
    expect(spanOn(quarter, day("2026-06-25"), day("2026-06-30"))).toBeNull();
    expect(spanOn(quarter, day("2026-10-01"), day("2026-10-03"))).toBeNull();
  });
});
