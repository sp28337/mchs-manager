import { describe, expect, it } from "vitest";

import type { IsoDate } from "../domain/plain-date";
import {
  createProfile,
  importProfile,
  resetCalendar,
  type StoredProfile,
} from "./profile";

/**
 * Сброс — единственное необратимое действие внутри профиля, и граница у
 * него ровно одна: отмеченное на сетках стирается, человек и его ответы
 * остаются. Обе половины проверяются здесь, потому что ошибка в любой из
 * них молча уносит то, чего человек не отдавал: не то год отпусков, не то
 * дату смены вместе со всем графиком.
 */
function filledProfile(): StoredProfile {
  const profile = createProfile({
    displayName: "Смена А",
    workingConditions: "harmful_or_dangerous",
    disabilityGroupIorII: true,
    firstShiftDate: "2025-01-02" as IsoDate,
    accountingYear: 2025,
    shiftStartTime: "09:00",
    schedulePattern: "1|3",
    shiftDurationHours: "24",
    customWorkDays: 1,
    customRestDays: 3,
  });
  return {
    ...profile,
    absences: [
      {
        id: "a1",
        kind: "annual_leave",
        startsOn: "2025-06-01" as IsoDate,
        endsOn: "2025-06-14" as IsoDate,
      },
    ],
    callouts: [
      {
        id: "c1",
        kind: "competition",
        startsOn: "2025-05-05" as IsoDate,
        endsOn: "2025-05-06" as IsoDate,
        hoursPerDay: "7.5",
      },
    ],
    calendarOverrides: { "2025-03-10": "holiday" },
    shiftOverrides: { "2025-04-04": "off", "2025-04-07": "shift" },
    dayNotes: { "2025-04-07": "подменял Петрова" },
    countFrom: "2025-03-01" as IsoDate,
    liveMode: true,
    overtimeInDays: true,
  };
}

describe("сброс календаря и графика", () => {
  it("снимает всё отмеченное на сетках", () => {
    const reset = resetCalendar(filledProfile());

    expect(reset.absences).toEqual([]);
    expect(reset.callouts).toEqual([]);
    expect(reset.calendarOverrides).toEqual({});
    expect(reset.shiftOverrides).toEqual({});
    expect(reset.dayNotes).toEqual({});
  });

  it("не трогает человека и его настройки", () => {
    const before = filledProfile();
    const after = resetCalendar(before);

    // Дата смены отдельной строкой: она задаёт сам цикл, и потерять её
    // значит показать человеку чужой график вместо пустого своего.
    expect(after.firstShiftDate).toBe(before.firstShiftDate);
    expect(after.displayName).toBe(before.displayName);
    expect(after.workingConditions).toBe(before.workingConditions);
    expect(after.disabilityGroupIorII).toBe(before.disabilityGroupIorII);
    expect(after.shiftStartTime).toBe(before.shiftStartTime);
    expect(after.countFrom).toBe(before.countFrom);
    expect(after.accountingYear).toBe(before.accountingYear);
    expect(after.liveMode).toBe(before.liveMode);
    expect(after.overtimeInDays).toBe(before.overtimeInDays);
  });

  it("не правит профиль на месте — прежний остаётся прежним", () => {
    const before = filledProfile();
    resetCalendar(before);

    expect(before.absences).toHaveLength(1);
    expect(before.dayNotes).toEqual({ "2025-04-07": "подменял Петрова" });
  });
});

/**
 * Старое написание графика — «1/3» вместо «1|3».
 *
 * Косая черта стояла в опознании графика всё время, пока он был выбором, и
 * профили с ней лежат в браузерах у людей. Отказать такому профилю в
 * чтении значило бы стереть человеку год внесённых отпусков из-за смены
 * знака в служебной строке, поэтому старое написание читается наравне с
 * новым и заменяется новым — молча, без единого действия человека.
 */
describe("профиль, записанный до смены знака в графике", () => {
  function legacy(schedulePattern: string): string {
    return JSON.stringify({
      schemaVersion: 1,
      displayName: "Смена А",
      workingConditions: "normal",
      disabilityGroupIorII: false,
      firstShiftDate: "2025-01-02",
      accountingYear: 2025,
      schedulePattern,
      absences: [],
      calendarOverrides: {},
      savedAt: "2025-01-02T00:00:00.000Z",
    });
  }

  it("читается и приходит уже с новым знаком", () => {
    expect(importProfile(legacy("1/3")).schedulePattern).toBe("1|3");
    expect(importProfile(legacy("1/4")).schedulePattern).toBe("1|4");
    expect(importProfile(legacy("2/2")).schedulePattern).toBe("2|2");
    expect(importProfile(legacy("5/2")).schedulePattern).toBe("5|2");
  });

  it("новый знак читается как был", () => {
    expect(importProfile(legacy("1|3")).schedulePattern).toBe("1|3");
    expect(importProfile(legacy("custom")).schedulePattern).toBe("custom");
  });

  /**
   * Замена идёт только по замкнутому списку прежних заготовок. Строка,
   * похожая на график, но никогда не бывшая опознанием, — это испорченный
   * профиль, и молча превращать её в чей-то чужой график нельзя.
   */
  it("чужая строка профилем не считается", () => {
    expect(() => importProfile(legacy("7/7"))).toThrow();
    expect(() => importProfile(legacy("3|1"))).toThrow();
  });

  /**
   * Начала отсчёта в таких профилях нет вовсе — поле появилось позже. Оно
   * обязано читаться пустым, и пустое обязано означать РОВНО ПРЕЖНЕЕ
   * поведение: считать выбранный период целиком. Иначе выпуск с новым
   * полем молча пересчитал бы норму всем, кто ни о чём не просил.
   */
  it("начало отсчёта у старого профиля пустое", () => {
    expect(importProfile(legacy("1|3")).countFrom).toBeNull();
  });
});

/**
 * Названия видов отсутствий и вызовов правились: «Дополнительный отпуск»
 * стал «Доп. отпуском», «Праздничное мероприятие» — «Праздником», а к
 * вызовам добавился общий «Вызов».
 *
 * Правились только НАЗВАНИЯ. В файле профиля лежат ключи, и они не
 * тронуты — иначе профиль, записанный вчера, сегодня не открылся бы вовсе:
 * неизвестный ключ проверку не проходит, и человек вместо своего года
 * отпусков увидел бы отказ. Проверяется здесь именно это: старый файл
 * читается целиком, вместе с видами, чьи подписи поменялись.
 */
describe("профиль, записанный до переименования видов", () => {
  function stored(kinds: { absence: string; callout: string }): string {
    return JSON.stringify({
      schemaVersion: 1,
      displayName: "Смена А",
      workingConditions: "normal",
      disabilityGroupIorII: false,
      firstShiftDate: "2025-01-02",
      accountingYear: 2025,
      schedulePattern: "1|3",
      absences: [
        {
          id: "a1",
          kind: kinds.absence,
          startsOn: "2025-06-01",
          endsOn: "2025-06-14",
        },
      ],
      callouts: [
        {
          id: "c1",
          kind: kinds.callout,
          startsOn: "2025-05-05",
          endsOn: "2025-05-06",
          hoursPerDay: "7.5",
        },
      ],
      calendarOverrides: {},
      savedAt: "2025-01-02T00:00:00.000Z",
    });
  }

  it("виды с прежними подписями читаются по-прежнему", () => {
    const profile = importProfile(
      stored({ absence: "extra_leave", callout: "public_event" }),
    );

    expect(profile.absences[0]?.kind).toBe("extra_leave");
    expect(profile.callouts[0]?.kind).toBe("public_event");
  });

  it("отгул и остальные виды тоже на месте", () => {
    const profile = importProfile(
      stored({ absence: "time_off_in_lieu", callout: "elections" }),
    );

    expect(profile.absences[0]?.kind).toBe("time_off_in_lieu");
    expect(profile.callouts[0]?.kind).toBe("elections");
  });

  /**
   * Обратное направление: файл с добавленным видом открывается тоже. Иначе
   * человек, отметивший вызов, не смог бы отдать свой профиль тому, кто
   * ещё не обновил страницу.
   */
  it("добавленный «Вызов» читается наравне с прежними", () => {
    const profile = importProfile(
      stored({ absence: "annual_leave", callout: "callout" }),
    );

    expect(profile.callouts[0]?.kind).toBe("callout");
  });
});
