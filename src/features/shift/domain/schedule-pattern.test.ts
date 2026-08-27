import { describe, expect, it } from "vitest";

import type { IsoDate } from "./plain-date";
import { addDays, weekday } from "./plain-date";
import {
  CUSTOM_PATTERN_ID,
  DEFAULT_SCHEDULE_PATTERN,
  MAX_CUSTOM_DAYS,
  MIN_CUSTOM_DAYS,
  SCHEDULE_PATTERNS,
  customSchedulePattern,
  resolveSchedulePattern,
  onPatternCycle,
  patternShiftDates,
  schedulePatternOf,
} from "./schedule-pattern";
import { calendarFactsFor } from "./production-calendar";
import { calculatePeriod } from "./calculation";
import { deriveWeeklyNorm } from "./value-objects";

const at = (day: string) => day as IsoDate;

/**
 * График задаёт весь календарь, и ошибка в нём тихая: смены просто встают
 * не туда, а числа при них выглядят как обычно. Поэтому здесь проверяется
 * не «работает», а сама арифметика цикла — в обе стороны от названной
 * смены и на границах периода.
 */
describe("графики сменности", () => {
  it("список и умолчание сходятся", () => {
    expect(SCHEDULE_PATTERNS.map((p) => p.id)).toEqual(["1|3", "1|4", "2|2", "5|2"]);
    expect(schedulePatternOf(DEFAULT_SCHEDULE_PATTERN).id).toBe("1|3");
  });

  it("неизвестное значение читается как график по умолчанию", () => {
    // Профиль мог быть записан версией, где список был другим. Белый экран
    // вместо расчёта человек не починит, а неверный график — увидит.
    expect(schedulePatternOf("7|7").id).toBe("1|3");
    expect(schedulePatternOf(undefined).id).toBe("1|3");
  });

  /**
   * Опознания графиков писались через косую черту, пока знак не поменяли на
   * вертикальную черту — ту же, что разделяет цифры в названии сайта.
   * Старое написание лежит в профилях у людей, поэтому опознаётся здесь же,
   * а не только при чтении профиля: строка со старым знаком приходит и из
   * файла, и из вкладки, открытой до обновления.
   */
  it("старое написание через косую черту опознаётся", () => {
    expect(schedulePatternOf("1/3").id).toBe("1|3");
    expect(schedulePatternOf("1/4").id).toBe("1|4");
    expect(schedulePatternOf("2/2").id).toBe("2|2");
    expect(schedulePatternOf("5/2").id).toBe("5|2");
  });

  it("у каждого графика длина цикла больше числа рабочих суток", () => {
    // Иначе выходных не остаётся вовсе, и «график» перестаёт быть графиком.
    for (const pattern of SCHEDULE_PATTERNS) {
      expect(pattern.workDays, pattern.id).toBeGreaterThan(0);
      expect(pattern.cycleDays, pattern.id).toBeGreaterThan(pattern.workDays);
    }
  });
});

describe("цикл вокруг названной смены", () => {
  const anchor = at("2026-01-05");

  it("сутки через трое: рабочие каждые четвёртые", () => {
    const pattern = schedulePatternOf("1|3");
    for (const [day, expected] of [
      ["2026-01-05", true],
      ["2026-01-06", false],
      ["2026-01-07", false],
      ["2026-01-08", false],
      ["2026-01-09", true],
    ] as const) {
      expect(onPatternCycle(anchor, at(day), pattern), day).toBe(expected);
    }
  });

  it("два через два: названные сутки — ПЕРВЫЕ из двух", () => {
    // Вторые сутки череды цикл достраивает сам. Иначе человеку пришлось бы
    // называть каждую пару отдельно, и график перестал бы строиться.
    const pattern = schedulePatternOf("2|2");
    for (const [day, expected] of [
      ["2026-01-05", true],
      ["2026-01-06", true],
      ["2026-01-07", false],
      ["2026-01-08", false],
      ["2026-01-09", true],
    ] as const) {
      expect(onPatternCycle(anchor, at(day), pattern), day).toBe(expected);
    }
  });

  it("цикл идёт и НАЗАД от названной смены", () => {
    // Человек называет любую свою смену, в том числе завтрашнюю: график до
    // неё обязан строиться так же, как после.
    const pattern = schedulePatternOf("1|3");
    expect(onPatternCycle(anchor, at("2026-01-01"), pattern)).toBe(true);
    expect(onPatternCycle(anchor, at("2025-12-28"), pattern)).toBe(true);
    expect(onPatternCycle(anchor, at("2025-12-29"), pattern)).toBe(false);
  });

  it("пятидневка не считает цикл, а спрашивает календарь", () => {
    // Скользящим циклом её сделать нельзя: пятидневка — это рабочая
    // НЕДЕЛЯ, и определяет её производственный календарь, а не арифметика.
    // Названная дата смены на неё не влияет вовсе — здесь она заведомо
    // «неудобная», суббота, и всё равно ничего не меняет.
    const pattern = schedulePatternOf("5|2");
    const saturday = at("2026-01-03");
    expect(weekday(saturday)).toBe(5);

    const working = new Set([at("2026-01-12"), at("2026-01-13")]);
    expect(onPatternCycle(saturday, at("2026-01-12"), pattern, working)).toBe(true);
    expect(onPatternCycle(saturday, at("2026-01-14"), pattern, working)).toBe(false);
  });

  it("без календаря пятидневка не выдумывает смен", () => {
    // Выдумать рабочий день, не зная, не праздник ли он, нельзя. Молча
    // показать его сменой значило бы соврать — а врать этому приложению
    // нельзя по определению.
    const pattern = schedulePatternOf("5|2");
    expect(onPatternCycle(at("2026-01-05"), at("2026-01-06"), pattern)).toBe(false);
    expect(
      patternShiftDates(at("2026-01-05"), pattern, at("2026-01-01"), at("2026-02-01")),
    ).toEqual([]);
  });
});

describe("даты смен за период", () => {
  const anchor = at("2026-01-05");

  it("границы полуинтервала: левая входит, правая нет", () => {
    const pattern = schedulePatternOf("1|3");
    const dates = patternShiftDates(anchor, pattern, at("2026-01-05"), at("2026-01-09"));
    expect(dates).toEqual(["2026-01-05"]);
  });

  it("два через два отдаёт обе смены пары", () => {
    const pattern = schedulePatternOf("2|2");
    const dates = patternShiftDates(anchor, pattern, at("2026-01-05"), at("2026-01-13"));
    expect(dates).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-09",
      "2026-01-10",
    ]);
  });

  it("пара, начавшаяся ДО периода, отдаёт периоду свой хвост", () => {
    // Период начинается вторыми сутками чужой пары. Потеряй мы их — в
    // первом дне месяца пропала бы отработанная смена.
    const pattern = schedulePatternOf("2|2");
    const dates = patternShiftDates(anchor, pattern, at("2026-01-06"), at("2026-01-10"));
    expect(dates).toEqual(["2026-01-06", "2026-01-09"]);
  });

  it("известная смена ПОЗЖЕ периода строит его так же", () => {
    const later = at("2026-08-03");
    const pattern = schedulePatternOf("1|4");
    const dates = patternShiftDates(later, pattern, at("2026-01-01"), at("2026-01-16"));
    // Считано вручную: от 3 августа назад пятёрками — 5, 10 и 15 января.
    // Двадцатое уже за правой границей, а она исключающая.
    expect(dates).toEqual(["2026-01-05", "2026-01-10", "2026-01-15"]);
    for (const day of dates) {
      expect(onPatternCycle(later, at(day), pattern), day).toBe(true);
    }
  });

  it("пустой период не даёт смен", () => {
    const pattern = schedulePatternOf("1|3");
    expect(patternShiftDates(anchor, pattern, at("2026-01-05"), at("2026-01-05"))).toEqual([]);
    expect(patternShiftDates(anchor, pattern, at("2026-01-09"), at("2026-01-05"))).toEqual([]);
  });

  it("за год выходит ровно столько смен, сколько даёт цикл", () => {
    // Проверка на сдвиг: любая ошибка в отсчёте цикла меняет это число.
    for (const pattern of SCHEDULE_PATTERNS) {
      if (pattern.source === "calendar") continue;
      const dates = patternShiftDates(anchor, pattern, at("2026-01-01"), at("2027-01-01"));
      const expected = Math.round((365 * pattern.workDays) / pattern.cycleDays);
      expect(Math.abs(dates.length - expected), pattern.id).toBeLessThanOrEqual(1);
      // Каждая выданная дата и правда рабочая по циклу — и наоборот.
      const set = new Set(dates);
      for (let i = 0; i < 365; i++) {
        const day = addDays(at("2026-01-01"), i);
        expect(set.has(day), `${pattern.id} ${day}`).toBe(
          onPatternCycle(anchor, day, pattern),
        );
      }
    }
  });
});

/**
 * Пятидневка по настоящему производственному календарю.
 *
 * Здесь проверяется то, ради чего она и переведена с цикла на календарь:
 * праздники, предпраздничные дни и ПЕРЕНОСЫ. Цикл в семь дней ни о чём из
 * этого не знает и разъезжается с календарём в первый же праздник.
 *
 * Сильнее всего говорит последняя проверка: у пятидневки факт обязан
 * сойтись с нормой в ноль. Норма считается по календарю, факт — по сменам,
 * и если они сходятся, значит смены встали ровно на рабочие дни, а
 * предпраздничный час снят и там, и там.
 */
describe("пятидневка по производственному календарю", () => {
  const YEAR_START = at("2026-01-01");
  const YEAR_END = at("2027-01-01");
  const pattern = schedulePatternOf("5|2");

  const facts = calendarFactsFor(YEAR_START, YEAR_END, new Map());
  const shifts = patternShiftDates(
    at("2026-01-05"),
    pattern,
    YEAR_START,
    YEAR_END,
    facts.workingDaySet,
  );

  it("смен ровно столько, сколько рабочих дней в году", () => {
    expect(facts.workingDays).toBe(247);
    expect(shifts).toHaveLength(247);
  });

  it("в праздники смен нет", () => {
    // Новогодние, 23 февраля, 8 марта, 1 и 9 мая, 12 июня, 4 ноября.
    for (const day of ["2026-01-01", "2026-01-07", "2026-02-23", "2026-03-09",
                       "2026-05-01", "2026-05-11", "2026-06-12", "2026-11-04"]) {
      expect(shifts.includes(at(day)), day).toBe(false);
    }
  });

  it("перенесённые выходные сняты со смен", () => {
    // 8 марта 2026-го — воскресенье, выходной переносится на понедельник
    // 9-го; 9 мая — суббота, перенос на понедельник 11-го. Оба понедельника
    // рабочие по циклу и НЕрабочие по календарю: ровно тот случай, из-за
    // которого цикл здесь и не годится.
    for (const day of ["2026-03-09", "2026-05-11"]) {
      expect(weekday(at(day)), day).toBe(0);
      expect(shifts.includes(at(day)), day).toBe(false);
    }
  });

  it("предпраздничные дни остаются рабочими", () => {
    // Они рабочие, просто короче на час (ст. 95 ТК РФ). Выбрось их из
    // смен — и человек «недоработает» по восемь часов вместо одного.
    for (const day of ["2026-04-30", "2026-05-08", "2026-06-11", "2026-11-03"]) {
      expect(shifts.includes(at(day)), day).toBe(true);
    }
  });

  it("факт сходится с нормой в ноль", () => {
    const calculation = calculatePeriod({
      periodStart: YEAR_START,
      periodEnd: YEAR_END,
      cycle: {
        knownShiftDate: at("2026-01-05"),
        pattern,
        workingDays: facts.workingDaySet,
      },
      weekly: deriveWeeklyNorm({ conditions: "normal" }),
      calendar: {
        workingDays: facts.workingDays,
        preHolidayDays: facts.preHolidayDays,
      },
      absences: [],
      holidayDays: facts.holidays,
      workingDays: facts.workingDaySet,
      preHolidayDays: facts.preHolidayDaySet,
      shiftStartTime: "08:00",
      shiftDurationHours: "8",
    });

    // 247 рабочих дней × 8 часов минус час за каждый из четырёх
    // предпраздничных — и норма, и факт дают одно и то же число.
    expect(calculation.normHours.toFixed(1)).toBe("1972.0");
    expect(calculation.actualHours.toFixed(1)).toBe("1972.0");
    expect(calculation.overtimeHours.toFixed(1)).toBe("0.0");
    expect(calculation.undertimeHours.toFixed(1)).toBe("0.0");
  });
});

/**
 * Свой график — цикл, названный человеком двумя числами.
 *
 * Заготовок четыре, а циклов в жизни больше: 3|1, 2|1, 4|4 на вахте.
 * Проверяется здесь то же, что и у заготовок, — арифметика цикла, — плюс
 * границы: за ними цикл перестаёт быть циклом, и приложение обязано их
 * держать само, а не полагаться на то, что человек введёт разумное.
 */
describe("свой график", () => {
  const anchor = at("2026-01-05");

  it("собирается из двух чисел", () => {
    const pattern = customSchedulePattern(3, 1);
    expect(pattern.id).toBe(CUSTOM_PATTERN_ID);
    expect(pattern.source).toBe("cycle");
    expect(pattern.cycleDays).toBe(4);
    expect(pattern.workDays).toBe(3);
    expect(pattern.label).toBe("3|1");
  });

  it("считает цикл так же, как заготовка", () => {
    // 3|1 — те же четверо суток, что у «сутки через трое», только рабочих
    // трое. Если арифметика цикла у своего графика своя, здесь это видно.
    const pattern = customSchedulePattern(3, 1);
    for (const [day, expected] of [
      ["2026-01-05", true],
      ["2026-01-06", true],
      ["2026-01-07", true],
      ["2026-01-08", false],
      ["2026-01-09", true],
    ] as const) {
      expect(onPatternCycle(anchor, at(day), pattern), day).toBe(expected);
    }
  });

  it("совпадает с заготовкой, если числа те же", () => {
    // Свой «1|3» обязан дать ровно то же, что заготовка: два разных ответа
    // на один и тот же цикл означали бы, что где-то из них ошибка.
    const own = customSchedulePattern(1, 3);
    const preset = schedulePatternOf("1|3");
    const from = at("2026-01-01");
    const to = at("2026-04-01");
    expect(patternShiftDates(anchor, own, from, to)).toEqual(
      patternShiftDates(anchor, preset, from, to),
    );
  });

  it("держит границы сам", () => {
    // Ноль рабочих суток — это не график, ноль выходных — работа без
    // единого выходного. И то и другое приходит из профиля, который мог
    // быть записан чем угодно, поэтому проверка здесь, а не только в форме.
    expect(customSchedulePattern(0, 0).workDays).toBe(MIN_CUSTOM_DAYS);
    expect(customSchedulePattern(0, 0).cycleDays).toBe(MIN_CUSTOM_DAYS * 2);
    expect(customSchedulePattern(999, 999).workDays).toBe(MAX_CUSTOM_DAYS);
    expect(customSchedulePattern(2.7, 1.2).workDays).toBe(2);
    expect(customSchedulePattern(undefined, undefined).label).toBe("1|3");
  });

  it("собирается из профиля только через общий разбор", () => {
    // Опознание у своего графика одно на все циклы, и числа к нему идут
    // отдельно: собрать его из одной строки нельзя.
    expect(resolveSchedulePattern(CUSTOM_PATTERN_ID, 4, 4).label).toBe("4|4");
    expect(resolveSchedulePattern("2|2", 4, 4).label).toBe("2|2");
    // Числа своего цикла не влияют на заготовку — иначе человек, заглянувший
    // в свой график и вернувшийся к 2|2, получил бы чужой цикл.
    expect(resolveSchedulePattern("2|2", 9, 9).cycleDays).toBe(4);
  });
});
