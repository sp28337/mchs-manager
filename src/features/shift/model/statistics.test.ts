import { describe, expect, it } from "vitest";

import { createProfile, type StoredProfile } from "../storage/profile";
import { calculateFor, statutoryBounds } from "./derive";
import { statisticsOf, totalsOf } from "./statistics";

/**
 * Статистика года.
 *
 * Проверяется не оформление, а три обещания, которые она даёт человеку:
 *
 *  1. Итог года — тот же самый, что показывает полоса наверху рабочего
 *     экрана. Разойдись они — и одно и то же приложение назвало бы два
 *     разных числа переработки в двух окнах.
 *  2. Месяц, которого ещё не было или который раньше начала отсчёта, —
 *     ПУСТОЙ, а не «ноль часов». Разница видна на рисунке: у пустого нет
 *     столбца вовсе, а ноль — это столбец нулевой высоты и провал в ходе
 *     накопления.
 *  3. Ход накопления — это сложенные месячные балансы, и последняя его
 *     точка обязана сойтись с суммой всех месяцев.
 */

const BASE = {
  displayName: "Тест",
  workingConditions: "normal" as const,
  disabilityGroupIorII: false,
  firstShiftDate: "2026-01-01" as const,
  accountingYear: 2026,
  shiftStartTime: "08:00" as const,
  schedulePattern: "1|3" as const,
  shiftDurationHours: "24",
  customWorkDays: 1,
  customRestDays: 3,
};

function profile(extra: Partial<StoredProfile> = {}): StoredProfile {
  return { ...createProfile(BASE), ...extra };
}

/** Сегодняшний день задаётся явно: иначе тест зависел бы от дня прогона. */
const TODAY = "2026-07-15";

describe("статистика года", () => {
  it("двенадцать месяцев, все непустые у полного года", () => {
    const stats = statisticsOf(profile(), TODAY);
    expect(stats.year).toBe(2026);
    expect(stats.months).toHaveLength(12);
    expect(stats.months.every((it) => !it.empty)).toBe(true);
    expect(stats.any).toBe(true);
  });

  it("итог сходится с расчётом года на полосе наверху", () => {
    const it = profile();
    const stats = statisticsOf(it, TODAY);
    const { periodStart, periodEnd } = statutoryBounds(2026, "year", 0);
    const same = calculateFor(it, periodStart, periodEnd);

    expect(stats.total.normHours.toString()).toBe(same.normHours.toString());
    expect(stats.total.actualHours.toString()).toBe(same.actualHours.toString());
    expect(stats.total.nightHours.toString()).toBe(same.nightHours.toString());
    expect(stats.total.workedShifts).toBe(same.workedShifts);
  });

  it("ход накопления — сложенные месячные балансы", () => {
    const stats = statisticsOf(profile(), TODAY);
    const sum = stats.months.reduce((total, it) => total.plus(it.balance), stats.months[0]!.balance.times(0));
    expect(stats.running.at(-1)!.toString()).toBe(sum.toString());
    // И он монотонно накапливается: каждая точка — предыдущая плюс месяц.
    stats.months.forEach((month, index) => {
      const before = index === 0 ? month.balance.times(0) : stats.running[index - 1]!;
      expect(stats.running[index]!.toString()).toBe(before.plus(month.balance).toString());
    });
  });

  it("месяцы раньше начала отсчёта — пустые, а не нулевые", () => {
    const stats = statisticsOf(profile({ countFrom: "2026-04-10" }), TODAY);
    // Январь, февраль и март целиком раньше — их нет.
    expect(stats.months.slice(0, 3).map((it) => it.empty)).toEqual([true, true, true]);
    // Апрель обрезан, но не пуст: с десятого числа смены его.
    expect(stats.months[3]!.empty).toBe(false);
    expect(stats.months[3]!.actualHours.greaterThan(0)).toBe(true);
    // Ход накопления до апреля стоит на нуле, а не проваливается.
    expect(stats.running.slice(0, 3).every((it) => it.isZero())).toBe(true);
  });

  it("«Онлайн» обрезает год сегодняшним днём", () => {
    const live = statisticsOf(profile({ liveMode: true }), TODAY);
    const whole = statisticsOf(profile(), TODAY);

    // Август и дальше ещё не наступили.
    expect(live.months.slice(7).every((it) => it.empty)).toBe(true);
    // Июль наступил наполовину: он есть, но короче полного.
    expect(live.months[6]!.empty).toBe(false);
    expect(live.months[6]!.actualHours.lessThan(whole.months[6]!.actualHours)).toBe(true);
    // А до июля месяцы совпадают с полным годом до часа.
    for (let month = 0; month < 6; month += 1) {
      expect(live.months[month]!.actualHours.toString()).toBe(
        whole.months[month]!.actualHours.toString(),
      );
    }
  });

  it("освобождения считаются по суткам и складываются по видам", () => {
    const stats = statisticsOf(
      profile({
        absences: [
          { id: "a", kind: "annual_leave", startsOn: "2026-06-01", endsOn: "2026-06-28" },
          { id: "b", kind: "sick_leave", startsOn: "2026-02-03", endsOn: "2026-02-11" },
        ],
      }),
      TODAY,
    );

    // Крупное впереди: перечень читают, чтобы увидеть, что съело норму.
    expect(stats.absences.map((it) => it.kind)).toEqual(["annual_leave", "sick_leave"]);
    // Сутки — ВСЕ накрытые, включая выходные между сменами.
    expect(stats.absences[0]!.days).toBe(28);
    expect(stats.absences[1]!.days).toBe(9);
    // Часы — по норме за рабочие дни внутри, а не по сменам: за 28 дней
    // отпуска это никак не 28 суток.
    expect(stats.absences[0]!.hours!.greaterThan(0)).toBe(true);
    expect(stats.absences[0]!.hours!.lessThan(28 * 24)).toBe(true);
    // Сумма по видам — это и есть исключённое из нормы года, до часа.
    const total = stats.absences.reduce(
      (sum, it) => (it.hours === null ? sum : sum.plus(it.hours)),
      stats.absences[0]!.hours!.times(0),
    );
    expect(total.toString()).toBe(stats.total.excludedHours.toString());
  });

  it("отгул попадает в перечень, но норму не уменьшает", () => {
    const stats = statisticsOf(
      profile({
        absences: [
          { id: "c", kind: "time_off_in_lieu", startsOn: "2026-03-05", endsOn: "2026-03-05" },
        ],
      }),
      TODAY,
    );

    const off = stats.absences.find((it) => it.kind === "time_off_in_lieu");
    expect(off?.days).toBe(1);
    // Не ноль, а «этой величины у него нет»: ноль читался бы как «сняло
    // нисколько часов», то есть как случайность, а не как правило.
    expect(off?.hours).toBeNull();
    expect(stats.total.excludedHours.isZero()).toBe(true);
  });

  it("вызовы складываются по видам и сортируются по часам", () => {
    const stats = statisticsOf(
      profile({
        callouts: [
          // Трое суток по шесть — восемнадцать часов.
          { id: "c1", kind: "competition", startsOn: "2026-02-10", endsOn: "2026-02-12", hoursPerDay: "6" },
          // Одни сутки по двадцать четыре: суток меньше, а часов больше.
          { id: "c2", kind: "callout", startsOn: "2026-03-02", endsOn: "2026-03-02", hoursPerDay: "24" },
        ],
      }),
      TODAY,
    );

    expect(stats.callouts.map((it) => it.kind)).toEqual(["callout", "competition"]);
    expect(stats.callouts[0]!.days).toBe(1);
    expect(stats.callouts[0]!.hours.toString()).toBe("24");
    expect(stats.callouts[1]!.days).toBe(3);
    expect(stats.callouts[1]!.hours.toString()).toBe("18");
    expect(stats.calloutHours.toString()).toBe("42");
  });

  it("часы вызова за краем года в счёт не идут", () => {
    // Запись с 30 декабря по 2 января: году принадлежат двое суток.
    const stats = statisticsOf(
      profile({
        callouts: [
          { id: "c", kind: "callout", startsOn: "2026-12-30", endsOn: "2027-01-02", hoursPerDay: "8" },
        ],
      }),
      TODAY,
    );
    expect(stats.callouts[0]!.days).toBe(2);
    expect(stats.calloutHours.toString()).toBe("16");
  });

  it("вызовы идут в отработанное, а норму не трогают", () => {
    const without = totalsOf(profile(), TODAY);
    const with_ = totalsOf(
      profile({
        callouts: [
          { id: "c", kind: "callout", startsOn: "2026-05-05", endsOn: "2026-05-05", hoursPerDay: "12" },
        ],
      }),
      TODAY,
    );

    expect(with_.total.normHours.toString()).toBe(without.total.normHours.toString());
    expect(with_.total.actualHours.minus(without.total.actualHours).toString()).toBe("12");
    expect(with_.balance.minus(without.balance).toString()).toBe("12");
  });

  it("итог профиля — то же, что итог его полной статистики", () => {
    const it = profile({
      absences: [
        { id: "a", kind: "annual_leave", startsOn: "2026-06-01", endsOn: "2026-06-28" },
      ],
      callouts: [
        { id: "c", kind: "reserve", startsOn: "2026-04-01", endsOn: "2026-04-03", hoursPerDay: "8" },
      ],
    });
    const short = totalsOf(it, TODAY);
    const full = statisticsOf(it, TODAY);

    expect(short.year).toBe(full.year);
    expect(short.any).toBe(full.any);
    expect(short.total.normHours.toString()).toBe(full.total.normHours.toString());
    expect(short.calloutHours.toString()).toBe(full.calloutHours.toString());
    expect(short.balance.toString()).toBe(full.balance.toString());
    // Баланс года — не сумма месячных: норма считается по отрезку, и
    // последняя точка хода накопления вправе с ним разойтись на час-другой.
    expect(short.balance.toString()).toBe(
      full.total.actualHours.minus(full.total.normHours).toString(),
    );
  });

  it("год целиком в будущем показывать нечего", () => {
    const stats = statisticsOf(
      profile({ accountingYear: 2030, liveMode: true }),
      TODAY,
    );
    expect(stats.any).toBe(false);
    expect(stats.months.every((it) => it.empty)).toBe(true);
  });
});
