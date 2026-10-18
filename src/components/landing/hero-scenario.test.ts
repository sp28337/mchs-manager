import { describe, expect, it } from "vitest";

import { calculatePeriod } from "../../features/shift/domain/calculation";
import { calendarFactsFor } from "../../features/shift/domain/production-calendar";
import { FULL_WEEKLY_HOURS } from "../../features/shift/domain/value-objects";
import { addDays, datesOfMonth, weekday } from "../../features/shift/domain/plain-date";
import type { AbsencePeriod } from "../../features/shift/domain/calculation";
import type { IsoDate } from "../../features/shift/domain/plain-date";

import {
  HERO_FIGURE_STEPS,
  HERO_KNOWN_SHIFT,
  HERO_LEAVE,
  HERO_MARK_AT,
  HERO_MONTHS,
  HERO_REST,
  HERO_STAGES,
  HERO_YEAR,
  type HeroTotals,
} from "./hero-scenario";

/**
 * Числа первого экрана — настоящие.
 *
 * Посадочная страница не считает их у себя: домен расчёта в её выдаче был
 * бы лишним весом. Значит, они записаны руками — и единственное, что
 * удерживает их от расхождения с приложением, это проверка. Здесь тот же
 * расчёт прогоняется заново, для тех же суток и тех же отсутствий — и для
 * периода целиком, и для каждого месяца над сеткой.
 *
 * Упадёт она — значит, правило в домене изменилось, а первый экран об
 * этом ещё не знает. Поправить надо ЕГО, а не проверку.
 */
describe("числа первого экрана", () => {
  const pad = (value: number) => String(value).padStart(2, "0");
  const iso = (month: number, day: number) => `${HERO_YEAR}-${pad(month)}-${pad(day)}` as IsoDate;

  /** Первое число месяца и первое число следующего — граница исключающая. */
  const bounds = (month: number) => {
    const days = datesOfMonth(HERO_YEAR, month);
    return { start: days[0]!, end: addDays(days[days.length - 1]!, 1), days };
  };

  const first = bounds(HERO_MONTHS[0]);
  const last = bounds(HERO_MONTHS[HERO_MONTHS.length - 1]!);

  const inputs = (periodStart: IsoDate, periodEnd: IsoDate, absences: readonly AbsencePeriod[]) => {
    const facts = calendarFactsFor(periodStart, periodEnd, new Map());
    return {
      periodStart,
      periodEnd,
      cycle: { knownShiftDate: HERO_KNOWN_SHIFT as IsoDate },
      weekly: { hours: FULL_WEEKLY_HOURS, basis: "ст. 91 ТК РФ" },
      calendar: { workingDays: facts.workingDays, preHolidayDays: facts.preHolidayDays },
      holidayDays: facts.holidays,
      workingDays: facts.workingDaySet,
      preHolidayDays: facts.preHolidayDaySet,
      shiftStartTime: "08:00",
      absences,
    };
  };

  // Отпуск и отгул — ровно те, что нарисованы на сетке.
  const leave: AbsencePeriod = {
    start: iso(HERO_LEAVE.month, HERO_LEAVE.from),
    endInclusive: iso(HERO_LEAVE.month, HERO_LEAVE.to),
    kind: "annual_leave",
  };
  const rest: AbsencePeriod = {
    start: iso(HERO_REST.month, HERO_REST.day),
    endInclusive: iso(HERO_REST.month, HERO_REST.day),
    kind: "time_off_in_lieu",
  };

  const totals = (periodStart: IsoDate, periodEnd: IsoDate, absences: readonly AbsencePeriod[]) => {
    const result = calculatePeriod(inputs(periodStart, periodEnd, absences));
    return {
      norm: Number(result.normHours.toString()),
      actual: Number(result.actualHours.toString()),
      overtime: Number(result.overtimeHours.toString()),
      undertime: Number(result.undertimeHours.toString()),
    } satisfies HeroTotals;
  };

  /** Весь расчёт на этапе: итог периода и итог каждого месяца. */
  const stage = (absences: readonly AbsencePeriod[]) => ({
    ...totals(first.start, last.end, absences),
    months: HERO_MONTHS.map((month) => {
      const { start, end } = bounds(month);
      return totals(start, end, absences);
    }),
  });

  /**
   * Месяцы обязаны быть чистыми.
   *
   * На этом держится вся понятность первого экрана: норма выводится из
   * числа рабочих дней, и только. Появись в месяце праздник или
   * предпраздничный день — числа сойдутся с доменом, но перестанут
   * сходиться с тем, что человек может пересчитать глазами.
   */
  it("месяцы без праздников: норма — это рабочие дни на восемь", () => {
    HERO_MONTHS.forEach((month, index) => {
      const { start, end, days } = bounds(month);
      const facts = calendarFactsFor(start, end, new Map());
      expect(facts.holidays.size).toBe(0);
      expect(facts.preHolidayDays).toBe(0);
      // Ни одного перенесённого выходного: рабочие дни — ровно будни.
      expect(facts.workingDays).toBe(days.filter((day) => weekday(day) < 5).length);
      expect(HERO_STAGES[0]!.months[index]!.norm).toBe(facts.workingDays * 8);
    });
  });

  it("до отсутствий — смены целиком", () => {
    expect(stage([])).toEqual(HERO_STAGES[0]);
  });

  it("отпуск уменьшает и отработанное, и норму", () => {
    expect(stage([leave])).toEqual(HERO_STAGES[1]);
    // Он накрывает пять рабочих дней и две смены: 40 часов нормы и 48 факта.
    expect(HERO_STAGES[0]!.norm - HERO_STAGES[1]!.norm).toBe(40);
    expect(HERO_STAGES[0]!.actual - HERO_STAGES[1]!.actual).toBe(48);
  });

  it("отгул после него уменьшает только отработанное", () => {
    expect(stage([leave, rest])).toEqual(HERO_STAGES[2]);
    expect(HERO_STAGES[1]!.norm).toBe(HERO_STAGES[2]!.norm);
    expect(HERO_STAGES[1]!.actual - HERO_STAGES[2]!.actual).toBe(24);
  });

  /**
   * Месяц уходит в минус, а период остаётся в плюсе: разницы месяцев в
   * разницу периода не складываются, и экран показывает это сам.
   */
  it("в октябре недоработка, а в периоде всё равно переработка", () => {
    const final = HERO_STAGES[HERO_STAGES.length - 1]!;
    expect(final.months[HERO_MONTHS.indexOf(10)]!.undertime).toBe(8);
    expect(final.undertime).toBe(0);
    expect(final.overtime).toBe(16);
  });

  it("нормы и факты месяцев складываются в норму и факт периода", () => {
    for (const each of HERO_STAGES) {
      expect(each.months.reduce((sum, month) => sum + month.norm, 0)).toBe(each.norm);
      expect(each.months.reduce((sum, month) => sum + month.actual, 0)).toBe(each.actual);
    }
  });

  /**
   * Отметки на сетке — те же, что считает домен.
   *
   * Расчёт помечает только СМЕНЫ (заступление и продолжение): свободные
   * сутки внутри отпуска записей не имеют, но сетка их показывает тоже — и
   * первый экран, как и она, закрашивает весь отпуск.
   */
  it("помеченные смены — те же, что считает домен", () => {
    const marked = (absences: readonly AbsencePeriod[], month: number) => {
      const { start, end } = bounds(month);
      return calculatePeriod(inputs(start, end, absences)).days
        .filter((day) => day.absenceKind !== null)
        .map((day) => Number(day.day.slice(8, 10)));
    };

    // Отгул: одна смена с продолжением — отсутствие ложится на смену по дате
    // её начала, и помечены обе половины.
    expect(marked([rest], HERO_REST.month)).toEqual([...HERO_REST.days]);

    // Отпуск: четыре суток со сменами — два заступления и два продолжения.
    const shifts = marked([leave], HERO_LEAVE.month);
    expect(shifts).toEqual([14, 15, 18, 19]);
    // Все они — среди нарисованных, а нарисованное лежит внутри отпуска.
    for (const day of shifts) expect(HERO_LEAVE.days).toContain(day);
    for (const day of HERO_LEAVE.days) {
      expect(day).toBeGreaterThanOrEqual(HERO_LEAVE.from);
      expect(day).toBeLessThanOrEqual(HERO_LEAVE.to);
    }
    expect(HERO_LEAVE.days.length).toBe(HERO_LEAVE.to - HERO_LEAVE.from + 1);
  });

  it("отпуск — во втором месяце, отгул — в четвёртом", () => {
    expect(HERO_MONTHS.indexOf(HERO_LEAVE.month)).toBe(1);
    expect(HERO_MONTHS.indexOf(HERO_REST.month)).toBe(3);
  });

  /**
   * Смена не переходит границу месяца.
   *
   * Иначе итог месяца — сумма его суток — разошёлся бы с «смен × 24», на
   * которых держится объяснение чисел в шапке `hero-scenario.ts`.
   */
  it("ни одна смена не лежит в двух месяцах", () => {
    const result = calculatePeriod(inputs(first.start, last.end, []));
    for (const day of result.days) {
      if (!day.isShiftStart) continue;
      expect(day.day.slice(0, 7)).toBe(addDays(day.day, 1).slice(0, 7));
    }
  });

  it("расписание истории идёт по порядку", () => {
    expect(HERO_MARK_AT[1]!).toBeLessThan(HERO_MARK_AT[2]!);
    const at = HERO_FIGURE_STEPS.map((step) => step.at);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Числа отвечают на отметку, а не опережают её.
    expect(at[1]!).toBeGreaterThan(HERO_MARK_AT[1]!);
    expect(at[2]!).toBeGreaterThan(HERO_MARK_AT[2]!);
    expect(HERO_FIGURE_STEPS.map((step) => step.stage)).toEqual([0, 1, 2]);
  });
});
