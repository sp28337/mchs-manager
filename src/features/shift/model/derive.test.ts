import { describe, expect, it } from "vitest";

import { createProfile } from "../storage/profile";
import {
  calculateFor,
  hasOwnShiftTime,
  scheduleSpanAt,
  shiftOn,
  shiftSpanAt,
  withShiftAt,
  withShiftMoved,
  withShiftTimeAt,
} from "./derive";

/**
 * Правки графика в профиле.
 *
 * Проверяется одно правило и его следствие: в профиле лежит только то,
 * что человек утверждает ВОПРЕКИ циклу. Совпало с циклом — записи нет.
 *
 * Правило не косметическое. Запись, подтверждающая цикл, однажды зажила
 * бы своей жизнью: сдвинь человек известную смену на день, и старые
 * «подтверждения» превратились бы в чужие смены посреди года.
 */
describe("правки графика", () => {
  // Известная смена 1 января 2026-го: цикл — 1, 5, 9, 13…
  const profile = createProfile({
    displayName: "Тест",
    workingConditions: "normal",
    disabilityGroupIorII: false,
    firstShiftDate: "2026-01-01",
    accountingYear: 2026,
    shiftStartTime: "08:00",
    schedulePattern: "1|3",
    shiftDurationHours: "24",
    customWorkDays: 1,
    customRestDays: 3,
  });

  it("снятая смена записывается", () => {
    expect(withShiftAt(profile, "2026-01-05", false).shiftOverrides).toEqual({
      "2026-01-05": "off",
    });
  });

  it("назначенная смена записывается", () => {
    expect(withShiftAt(profile, "2026-01-07", true).shiftOverrides).toEqual({
      "2026-01-07": "shift",
    });
  });

  it("совпадение с циклом ничего не записывает", () => {
    expect(withShiftAt(profile, "2026-01-05", true).shiftOverrides).toEqual({});
    expect(withShiftAt(profile, "2026-01-07", false).shiftOverrides).toEqual({});
  });

  it("возврат к циклу снимает прежнюю правку", () => {
    const without = withShiftAt(profile, "2026-01-05", false);
    expect(withShiftAt(without, "2026-01-05", true).shiftOverrides).toEqual({});
  });

  it("перенос — одна правка на двое суток", () => {
    expect(withShiftMoved(profile, "2026-01-05", "2026-01-07").shiftOverrides).toEqual({
      "2026-01-05": "off",
      "2026-01-07": "shift",
    });
  });

  it("перенос на те же сутки ничего не меняет", () => {
    expect(withShiftMoved(profile, "2026-01-05", "2026-01-05")).toBe(profile);
  });

  /**
   * Главное следствие: перенос не создаёт и не теряет часы. Смен столько
   * же, отработано столько же — сдвинулась только дата.
   */
  it("перенос не меняет ни числа смен, ни отработанного", () => {
    const before = calculateFor(profile, "2026-01-01", "2026-02-01");
    const after = calculateFor(
      withShiftMoved(profile, "2026-01-05", "2026-01-07"),
      "2026-01-01",
      "2026-02-01",
    );

    expect(after.scheduledShifts).toBe(before.scheduledShifts);
    expect(after.actualHours.toString()).toBe(before.actualHours.toString());
    expect(after.normHours.toString()).toBe(before.normHours.toString());
    expect(after.days.some((day) => day.day === "2026-01-07" && day.isShiftStart)).toBe(
      true,
    );
    expect(after.days.some((day) => day.day === "2026-01-05" && day.isShiftStart)).toBe(
      false,
    );
  });

  it("снятая смена уменьшает отработанное на сутки", () => {
    const before = calculateFor(profile, "2026-01-01", "2026-02-01");
    const after = calculateFor(
      withShiftAt(profile, "2026-01-05", false),
      "2026-01-01",
      "2026-02-01",
    );

    expect(before.actualHours.minus(after.actualHours).toString()).toBe("24");
    // Норма не трогается: она считается по производственному календарю, а
    // не по графику смен, и снятая смена на неё влиять не должна.
    expect(after.normHours.toString()).toBe(before.normHours.toString());
  });
});

/**
 * Часы отдельной смены в профиле.
 *
 * Правило то же, что у правок календаря и переносов: хранится только то,
 * что человек утверждает ВОПРЕКИ графику. Совпало с графиком — записи
 * нет, и это не бережливость, а защита от записи, которая заживёт своей
 * жизнью: поправь человек начало смены в настройках, старые
 * «подтверждения» удержали бы часть года на прежнем распорядке.
 */
describe("часы смены", () => {
  const profile = createProfile({
    displayName: "Тест",
    workingConditions: "normal",
    disabilityGroupIorII: false,
    firstShiftDate: "2026-01-01",
    accountingYear: 2026,
    shiftStartTime: "08:00",
    schedulePattern: "1|3",
    shiftDurationHours: "24",
    customWorkDays: 1,
    customRestDays: 3,
  });

  it("по умолчанию часы смены — это часы графика", () => {
    expect(shiftSpanAt(profile, "2026-01-05")).toEqual({
      startsAt: "08:00",
      endsAt: "08:00",
    });
    expect(hasOwnShiftTime(profile, "2026-01-05")).toBe(false);
  });

  it("названные часы записываются", () => {
    const named = withShiftTimeAt(profile, "2026-01-05", {
      startsAt: "08:00",
      endsAt: "23:00",
    });
    expect(named.shiftTimes).toEqual({
      "2026-01-05": { startsAt: "08:00", endsAt: "23:00" },
    });
    expect(hasOwnShiftTime(named, "2026-01-05")).toBe(true);
  });

  it("совпадение с графиком ничего не записывает", () => {
    expect(
      withShiftTimeAt(profile, "2026-01-05", { startsAt: "08:00", endsAt: "08:00" })
        .shiftTimes,
    ).toEqual({});
  });

  it("возврат к графику снимает прежнюю запись", () => {
    const named = withShiftTimeAt(profile, "2026-01-05", {
      startsAt: "08:00",
      endsAt: "23:00",
    });
    expect(withShiftTimeAt(named, "2026-01-05", null).shiftTimes).toEqual({});
    expect(
      withShiftTimeAt(named, "2026-01-05", { startsAt: "08:00", endsAt: "08:00" })
        .shiftTimes,
    ).toEqual({});
  });

  it("названные часы доходят до расчёта", () => {
    const before = calculateFor(profile, "2026-01-01", "2026-02-01");
    const after = calculateFor(
      withShiftTimeAt(profile, "2026-01-05", { startsAt: "08:00", endsAt: "23:00" }),
      "2026-01-01",
      "2026-02-01",
    );

    // Сутки превратились в пятнадцать часов: минус девять.
    expect(before.actualHours.minus(after.actualHours).toString()).toBe("9");
    expect(after.normHours.toString()).toBe(before.normHours.toString());
  });

  /**
   * Часы описывают СМЕНУ, а не сутки. Оставь их на снятой смене — и они
   * пролежат до тех пор, пока смена сюда не вернётся, чтобы тогда молча
   * приписать ей чужой распорядок.
   */
  it("снятая смена уносит свои часы", () => {
    const named = withShiftTimeAt(profile, "2026-01-05", {
      startsAt: "08:00",
      endsAt: "23:00",
    });
    expect(withShiftAt(named, "2026-01-05", false).shiftTimes).toEqual({});
  });

  /**
   * А перенос — наоборот: «смену отдали на седьмое» это та же смена, и
   * сказанное о её часах переносом не отменяется.
   */
  it("перенос уносит часы вместе со сменой", () => {
    const named = withShiftTimeAt(profile, "2026-01-05", {
      startsAt: "08:00",
      endsAt: "23:00",
    });
    expect(withShiftMoved(named, "2026-01-05", "2026-01-07").shiftTimes).toEqual({
      "2026-01-07": { startsAt: "08:00", endsAt: "23:00" },
    });
  });

  /**
   * У графиков по производственному календарю смена накануне праздника
   * короче на час (ст. 95 ТК РФ), и расчёт делает это сам. Окно дня обязано
   * показывать те же часы: иначе человек, ничего не тронув, читал бы в поле
   * одно, а в клетке другое.
   */
  it("предпраздничный день короче на час и в часах по графику", () => {
    const week = {
      ...profile,
      schedulePattern: "5|2" as const,
      shiftDurationHours: "8",
    };
    // Предпраздничных дней в 2026 году четыре: 30 апреля, 8 мая, 11 июня и
    // 3 ноября. Марта среди них нет — 8 марта воскресенье, и накануне
    // праздника там выходной, а не рабочий день.
    expect(scheduleSpanAt(week, "2026-04-30")).toEqual({
      startsAt: "08:00",
      endsAt: "15:00",
    });
    expect(scheduleSpanAt(week, "2026-04-29")).toEqual({
      startsAt: "08:00",
      endsAt: "16:00",
    });
  });

  /**
   * Сутки, в которых человек сдаёт одну смену и заступает на другую.
   *
   * Записей в них две, и порядок у них всегда один: хвост вчерашней смены
   * идёт раньше сегодняшнего заступления, потому что записи раскладываются
   * по дате начала смены. Отсюда и ошибка, которую этот тест сторожит:
   * клетка, берущая ПЕРВУЮ запись, красилась продолжением, и включённая
   * человеком смена выглядела не сработавшей. Красить обязано заступление
   * — событие этих суток; хвост принадлежит вчерашним.
   */
  it("в сутках сдачи и заступления две записи, и заступление среди них есть", () => {
    const both = withShiftAt(profile, "2026-01-06", true);
    const records = calculateFor(both, "2026-01-01", "2026-02-01").days.filter(
      (record) => record.day === "2026-01-06",
    );

    expect(records.map((record) => record.hours.toString())).toEqual(["8", "16"]);
    expect(records.map((record) => record.isShiftStart)).toEqual([false, true]);
    expect(records.some((record) => record.isShiftStart)).toBe(true);
  });

  /** Смена есть — значит есть; спрашивают об этом окно дня, сетка и расчёт. */
  it("наличие смены читается с учётом правок", () => {
    expect(shiftOn(profile, "2026-01-05")).toBe(true);
    expect(shiftOn(profile, "2026-01-06")).toBe(false);
    expect(shiftOn(withShiftAt(profile, "2026-01-05", false), "2026-01-05")).toBe(false);
    expect(shiftOn(withShiftAt(profile, "2026-01-06", true), "2026-01-06")).toBe(true);
  });
});
