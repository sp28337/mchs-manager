import { describe, expect, it } from "vitest";

import { calculatePeriod } from "../../features/shift/domain/calculation";
import { Dec } from "../../features/shift/domain/decimal";
import { calendarFactsFor } from "../../features/shift/domain/production-calendar";
import { addDays, datesOfMonth, weekday } from "../../features/shift/domain/plain-date";
import { FULL_WEEKLY_HOURS } from "../../features/shift/domain/value-objects";
import { ABSENCE_LABELS, CALLOUT_LABELS } from "../../features/shift/schemas";
import type { AbsencePeriod, CalloutPeriod } from "../../features/shift/domain/calculation";
import type { IsoDate } from "../../features/shift/domain/plain-date";

import {
  buildTimeline,
  HERO_EVENT_LABEL,
  HERO_KNOWN_SHIFT,
  HERO_MONTHS,
  HERO_SCRIPTS,
  HERO_YEAR,
  heroStagger,
  heroStartAt,
  type HeroEvent,
  type HeroLayout,
  type HeroTotals,
} from "./hero-story";

/**
 * Числа первого экрана — настоящие.
 *
 * Посадочная страница не считает их у себя: домен расчёта в её выдаче был
 * бы лишним весом. Значит, они записаны руками — и единственное, что
 * удерживает их от расхождения с приложением, это проверка. Здесь тот же
 * расчёт прогоняется заново, для тех же суток и тех же записей — на каждом
 * этапе истории, и для периода целиком, и для каждого месяца над сеткой.
 *
 * Упадёт она — значит, правило в домене изменилось, а первый экран об
 * этом ещё не знает. Поправить надо ЕГО, а не проверку.
 */

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (month: number, day: number) => `${HERO_YEAR}-${pad(month)}-${pad(day)}` as IsoDate;

const bounds = (month: number) => {
  const days = datesOfMonth(HERO_YEAR, month);
  return { start: days[0]!, end: addDays(days[days.length - 1]!, 1), days };
};

const inputs = (
  periodStart: IsoDate,
  periodEnd: IsoDate,
  absences: readonly AbsencePeriod[],
  callouts: readonly CalloutPeriod[],
  shifts: readonly IsoDate[] = [],
) => {
  const facts = calendarFactsFor(periodStart, periodEnd, new Map());
  return {
    periodStart,
    periodEnd,
    cycle: {
      knownShiftDate: HERO_KNOWN_SHIFT as IsoDate,
      // Смена, поставленная человеком на свободные сутки, — правка графика.
      overrides: new Map(shifts.map((day) => [day, "shift" as const])),
    },
    weekly: { hours: FULL_WEEKLY_HOURS, basis: "ст. 91 ТК РФ" },
    calendar: { workingDays: facts.workingDays, preHolidayDays: facts.preHolidayDays },
    holidayDays: facts.holidays,
    workingDays: facts.workingDaySet,
    preHolidayDays: facts.preHolidayDaySet,
    shiftStartTime: "08:00",
    absences,
    callouts,
  };
};

/** Запись сценария так, как её знает расчёт: границы включительно. */
const absenceOf = (event: HeroEvent): AbsencePeriod => ({
  start: iso(event.month, event.from),
  endInclusive: iso(event.month, event.to),
  kind: event.kind as AbsencePeriod["kind"],
});

const isAbsence = (event: HeroEvent) => event.kind !== "callout" && event.kind !== "shift";

const calloutOf = (event: HeroEvent): CalloutPeriod => ({
  start: iso(event.month, event.from),
  endInclusive: iso(event.month, event.to),
  kind: "callout",
  hoursPerDay: Dec(String(event.hours)),
});

const placed = (events: readonly HeroEvent[]) => ({
  absences: events.filter(isAbsence).map(absenceOf),
  callouts: events.filter((event) => event.kind === "callout").map(calloutOf),
  shifts: events
    .filter((event) => event.kind === "shift")
    .map((event) => iso(event.month, event.from)),
});

const totals = (start: IsoDate, end: IsoDate, events: readonly HeroEvent[]): HeroTotals => {
  const { absences, callouts, shifts } = placed(events);
  const result = calculatePeriod(inputs(start, end, absences, callouts, shifts));
  return {
    norm: Number(result.normHours.toString()),
    actual: Number(result.actualHours.toString()),
    overtime: Number(result.overtimeHours.toString()),
    undertime: Number(result.undertimeHours.toString()),
  };
};

const LAYOUTS: HeroLayout[] = ["wide", "narrow"];

describe.each(LAYOUTS)("первый экран, раскладка %s", (layout) => {
  const script = HERO_SCRIPTS[layout];
  const months = HERO_MONTHS[layout];
  const first = bounds(months[0]!);
  const last = bounds(months[months.length - 1]!);

  /**
   * Месяцы обязаны быть чистыми.
   *
   * На этом держится вся понятность первого экрана: норма выводится из числа
   * рабочих дней, и только. Появись в месяце праздник или предпраздничный день —
   * числа сойдутся с доменом, но перестанут сходиться с тем, что человек может
   * пересчитать глазами.
   */
  it("месяцы без праздников: норма — это рабочие дни на восемь", () => {
    months.forEach((month, index) => {
      const { start, end, days } = bounds(month);
      const facts = calendarFactsFor(start, end, new Map());
      expect(facts.holidays.size).toBe(0);
      expect(facts.preHolidayDays).toBe(0);
      expect(facts.workingDays).toBe(days.filter((day) => weekday(day) < 5).length);
      expect(script.stages[0]!.months[index]!.norm).toBe(facts.workingDays * 8);
    });
  });

  it("на каждом этапе итоги периода и месяцев — те, что считает расчёт", () => {
    script.stages.forEach((stage, count) => {
      const standing = script.events.slice(0, count);
      const expected = {
        ...totals(first.start, last.end, standing),
        months: months.map((month) => {
          const { start, end } = bounds(month);
          return totals(start, end, standing);
        }),
      };
      expect(stage, `после ${count} записей`).toEqual(expected);
    });
  });

  it("нормы и факты месяцев складываются в норму и факт периода", () => {
    // Норма не уходит в минус (`atLeastZero`), и месяц целиком в отпуске
    // стоит нулём — сумма всё равно сходится.
    for (const stage of script.stages) {
      expect(stage.months.reduce((sum, month) => sum + month.norm, 0)).toBe(stage.norm);
      expect(stage.months.reduce((sum, month) => sum + month.actual, 0)).toBe(stage.actual);
    }
  });

  it("этапов на один больше, чем записей", () => {
    expect(script.stages).toHaveLength(script.events.length + 1);
  });

  /**
   * Клетки, закрашенные на сетке, — те, что закрасил бы график.
   *
   * Расчёт помечает только СМЕНЫ (заступление и продолжение): свободные сутки
   * внутри отпуска записей не имеют, но график их показывает тоже — вполголоса,
   * и первый экран закрашивает весь отпуск, как он. Хвост смены, начатой в
   * последний день записи, помечается тоже; хвост чужой смены в первый день
   * показывается часами, а не буквой. Границы записей выбраны так, чтобы ни
   * того, ни другого не случалось, — иначе на сетке пришлось бы рисовать
   * исключения.
   */
  it("закрашены ровно сутки записи — без хвостов и обрезков", () => {
    for (const event of script.events) {
      const { start, end } = bounds(event.month);
      const { absences, callouts, shifts } = placed([event]);
      const days = calculatePeriod(inputs(start, end, absences, callouts, shifts)).days;

      // Смена на свободные сутки: заступление в первые сутки записи и
      // продолжение во вторые — и по графику смен их там нет.
      if (event.kind === "shift") {
        const day = (n: number) => days.find((record) => record.day === iso(event.month, n));
        expect(day(event.from)?.isShiftStart, `${event.id}: заступление`).toBe(true);
        expect(day(event.from + 1)?.isShiftStart, `${event.id}: продолжение`).toBe(false);
        expect(day(event.from + 1)?.hours.toString()).toBe("8");
        expect(event.days).toEqual([event.from, event.from + 1]);
        const base = calculatePeriod(inputs(start, end, [], [])).days;
        for (const n of event.days) {
          expect(
            base.find((record) => record.day === iso(event.month, n)),
            `${event.id}: по графику в ${n}-е смены нет`,
          ).toBeUndefined();
        }
        continue;
      }

      const marked = days
        .filter((record) => record.absenceKind !== null || record.calloutKind)
        .map((record) => Number(record.day.slice(8, 10)));

      // Всё, что считает расчёт, закрашено.
      for (const day of marked) expect(event.days, `${event.id}: ${day}`).toContain(day);
      // А закрашенное лежит внутри записи — разве что хвост её смены.
      for (const day of event.days) {
        expect(day).toBeGreaterThanOrEqual(event.from);
      }
      expect(event.days[0]).toBe(event.from);
      expect(event.days.length).toBeGreaterThanOrEqual(event.to - event.from + 1);
      expect(event.days.length).toBeLessThanOrEqual(event.to - event.from + 2);
    }
  });

  it("отпуска и больничные не рвут смену посередине", () => {
    const isStart = (iso: string) => {
      const record = calculatePeriod(
        inputs(first.start, last.end, [], []),
      ).days.find((day) => day.day === iso);
      return record?.isShiftStart === true;
    };
    for (const event of script.events) {
      // Вызов и лишняя смена не отсутствия, а отгул — ровно одна смена: он и
      // ставится на заступление.
      if (!isAbsence(event) || event.kind === "time_off_in_lieu") continue;
      const from = iso(event.month, event.from);
      const to = iso(event.month, event.to);
      // Запись не начинается с хвоста чужой смены и не кончается заступлением.
      expect(isStart(addDays(from, -1)), `${event.id}: перед началом`).toBe(false);
      expect(isStart(to), `${event.id}: на конце`).toBe(false);
    }
  });

  it("смена не лежит в двух месяцах", () => {
    const result = calculatePeriod(inputs(first.start, last.end, [], []));
    for (const day of result.days) {
      if (day.isShiftStart) {
        expect(day.day.slice(0, 7)).toBe(addDays(day.day, 1).slice(0, 7));
      }
    }
  });

  it("записи названы теми же словами, что в приложении", () => {
    for (const event of script.events) {
      // Смена называется короче строки перечня («Поставить смену»): над пальцем
      // нужно имя того, что поставлено, а не действие.
      if (event.kind === "shift") {
        expect(HERO_EVENT_LABEL.shift).toBe("Смена");
        continue;
      }
      const real =
        event.kind === "callout" ? CALLOUT_LABELS.callout : ABSENCE_LABELS[event.kind];
      expect(HERO_EVENT_LABEL[event.kind]).toBe(real);
    }
  });

  describe("круг истории", () => {
    const { actions, period } = buildTimeline(script);

    it("мигов не меньше, чем шагов, и идут по порядку", () => {
      const times = actions.map((action) => action.at);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(times[0]).toBe(0);
      expect(period).toBeGreaterThan(times.at(-1)!);
    });

    it("этапы идут как записи ставятся и убираются, и круг кончается чистым месяцем", () => {
      const stages = actions.flatMap((action) =>
        action.patch.stage === undefined ? [] : [action.patch.stage],
      );
      const adds = script.steps.filter((step) => step.kind === "add").length;
      expect(stages.slice(0, adds)).toEqual(Array.from({ length: adds }, (_, i) => i + 1));
      expect(stages.at(-1)).toBe(0);
      // Убирают с конца: после каждого удаления остаются первые записи.
      const removed = stages.slice(adds);
      expect([...removed].sort((a, b) => b - a)).toEqual(removed);
    });

    it("каждая запись ложится один раз за круг и один раз снимается", () => {
      const on: string[] = [];
      const off: string[] = [];
      for (const action of actions) {
        for (const [id, state] of Object.entries(action.patch.events ?? {})) {
          (state === "on" ? on : off).push(id);
        }
      }
      const ids = script.events.map((event) => event.id);
      expect(on.toSorted()).toEqual(ids.toSorted());
      expect(off.toSorted()).toEqual(ids.toSorted());
    });

    it("числа меняются после отметки, а не раньше неё", () => {
      for (const step of script.steps) {
        if (step.kind !== "add") continue;
        const event = script.events[step.event]!;
        const placedAt = actions.find((action) => action.patch.events?.[event.id] === "on")!.at;
        const shownAt = actions.find((action) => action.patch.stage === step.event + 1)!.at;
        expect(shownAt).toBeGreaterThan(placedAt);
      }
    });

    it("рука уходит в конце круга, а не посреди", () => {
      const hide = actions.findLast((action) => action.patch.pointer?.visible === false);
      expect(hide?.at).toBe(actions.at(-1)!.at);
    });
  });

  it("история начинается после сборки сетки", () => {
    expect(heroStartAt(layout)).toBeGreaterThan(2000);
  });
});

describe("раскладки сошлись между собой", () => {
  it("на узком экране июль, а в нём не больше, чем на широком", () => {
    expect(HERO_MONTHS.narrow).toEqual([7]);
    expect(HERO_MONTHS.wide[0]).toBe(7);
    // Дополнительного отпуска на узком нет; остальные виды — те же.
    const kinds = (layout: HeroLayout) => HERO_SCRIPTS[layout].events.map((event) => event.kind);
    expect(kinds("narrow")).not.toContain("extra_leave");
    for (const kind of kinds("narrow")) expect(kinds("wide")).toContain(kind);
  });

  it("на узком отпуск — первая неделя месяца, больничный — вторая", () => {
    const [leave, sick] = HERO_SCRIPTS.narrow.events;
    expect([leave!.kind, leave!.from, leave!.to]).toEqual(["annual_leave", 1, 7]);
    expect([sick!.kind, sick!.from, sick!.to]).toEqual(["sick_leave", 8, 14]);
  });

  it("на узком лишняя смена — двадцать седьмого июля, до отгула", () => {
    const { events } = HERO_SCRIPTS.narrow;
    const shift = events.findIndex((event) => event.kind === "shift");
    const rest = events.findIndex((event) => event.kind === "time_off_in_lieu");
    expect(events[shift]!.from).toBe(27);
    expect(shift).toBeLessThan(rest);
  });

  it("на широком: отпуск на весь июль, больничный с начала августа на неделю", () => {
    const [leave, sick, extra] = HERO_SCRIPTS.wide.events;
    expect([leave!.kind, leave!.month, leave!.from, leave!.to]).toEqual(["annual_leave", 7, 1, 31]);
    expect([sick!.kind, sick!.month, sick!.from, sick!.to - sick!.from + 1]).toEqual([
      "sick_leave",
      8,
      1,
      7,
    ]);
    expect([extra!.kind, extra!.month, extra!.to - extra!.from + 1]).toEqual([
      "extra_leave",
      9,
      7,
    ]);
    const october = HERO_SCRIPTS.wide.events.filter((event) => event.month === 10);
    // Лишняя смена — до отгула: отгул берут за переработку, она набегает первой.
    expect(october.map((event) => [event.kind, event.from])).toEqual([
      ["callout", 7],
      ["shift", 11],
      ["time_off_in_lieu", 13],
    ]);
    expect(october[0]!.hours).toBe(4);
  });

  it("запись ложится днями подряд за ограниченное время", () => {
    expect(heroStagger(31) * 30).toBeLessThanOrEqual(700);
    expect(heroStagger(7)).toBeLessThanOrEqual(70);
    expect(heroStagger(1)).toBeGreaterThan(0);
  });
});
