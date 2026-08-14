/**
 * Расчёт нормы и переработки — то, ради чего система существует.
 *
 * Тесты перенесены с бэкенда вместе с расчётом, дословно: перенос имеет
 * смысл только тогда, когда его проверяет то же, что проверяло исходник.
 * Числа взяты не из головы — производственный календарь 2026 года
 * подставляется явными значениями, а ожидаемые нормы пересчитаны по
 * формуле ст. 104 ТК РФ вручную.
 */

import { describe, expect, test } from "vitest";

import { Dec } from "./decimal";

import {
  baseNormHours,
  calculatePeriod,
  type AbsencePeriod,
  type CalendarFacts,
  type CalculatePeriodInput,
} from "./calculation";
import {
  deriveWeeklyNorm,
  shiftDates,
  type GuardCycle,
  type GuardNumber,
  type WeeklyNorm,
  type WeeklyNormInput,
} from "./value-objects";
import { addDays, daysBetween, weekday, type IsoDate } from "./plain-date";

const NO_HOLIDAYS: ReadonlySet<IsoDate> = new Set<IsoDate>();

/** Рабочие дни марта 2026 по производственному календарю: будни, 21 день. */
const MARCH_WORKING: ReadonlySet<IsoDate> = new Set(
  Array.from({ length: 31 }, (_, index) => addDays("2026-03-01", index)).filter(
    (day) => weekday(day) < 5,
  ),
);

function norm(overrides: Partial<WeeklyNormInput> = {}): WeeklyNorm {
  return deriveWeeklyNorm({
    employment: "attested",
    gender: "male",
    conditions: "normal",
    northernLocality: false,
    ...overrides,
  });
}

// ------------------------------------------------------- недельная норма

describe("недельная норма", () => {
  test("обычные условия дают сорок часов", () => {
    expect(norm().hours.toString()).toBe("40");
    expect(norm().basis).toContain("308");
  });

  test("вредность даёт тридцать шесть и служащему, и работнику", () => {
    // Сокращает неделю обоим, но по разным пунктам, и основание обязано
    // это различать: человек понесёт его начальнику.
    const attested = norm({ conditions: "harmful_or_dangerous" });
    const civilian = norm({ employment: "civilian", conditions: "harmful_or_dangerous" });

    expect(attested.hours.toString()).toBe("36");
    expect(civilian.hours.toString()).toBe("36");
    expect(attested.basis).toContain("308");
    expect(attested.basis).toContain("ФЗ-141");
    expect(civilian.basis).toContain("307");
    expect(civilian.basis).toContain("92 ТК РФ");
  });

  test("северянки получают тридцать шесть по обоим приказам", () => {
    // Приказ № 308 п. 1 даёт сокращение и СОТРУДНИЦАМ — по ч. 4 ст. 54
    // ФЗ-141, а не только работницам по ст. 320 ТК РФ.
    const attested = norm({ gender: "female", northernLocality: true });
    const civilian = norm({
      employment: "civilian",
      gender: "female",
      northernLocality: true,
    });

    expect(attested.hours.toString()).toBe("36");
    expect(civilian.hours.toString()).toBe("36");
    expect(attested.basis).toContain("ч. 4 ст. 54 ФЗ-141");
    expect(civilian.basis).toContain("320 ТК РФ");
  });

  test("северное сокращение не распространяется на мужчин", () => {
    // Оба приказа говорят о женщинах. Распространить сокращение на всех
    // значило бы занизить норму — то есть выдумать переработку.
    expect(norm({ gender: "male", northernLocality: true }).hours.toString()).toBe("40");
  });

  test("инвалидность даёт тридцать пять и только работникам", () => {
    const civilian = norm({ employment: "civilian", disabilityGroupIorII: true });
    expect(civilian.hours.toString()).toBe("35");
    expect(civilian.basis).toContain("307 п. 5");

    // Приказ № 308 такого пункта не содержит, и это не пробел: службу в
    // ФПС ГПС инвалид I или II группы не проходит.
    const attested = norm({ employment: "attested", disabilityGroupIorII: true });
    expect(attested.hours.toString()).toBe("40");
  });

  test("инвалидность сильнее вредности", () => {
    // 35 короче 36. Проверь вредность первой — и работник с инвалидностью
    // во вредных условиях получил бы 36 вместо 35.
    const both = norm({
      employment: "civilian",
      disabilityGroupIorII: true,
      conditions: "harmful_or_dangerous",
    });
    expect(both.hours.toString()).toBe("35");
  });

  test("сокращения не складываются", () => {
    // Два основания по 36 часов дают 36, а не 32.
    const both = norm({
      employment: "civilian",
      gender: "female",
      northernLocality: true,
      conditions: "harmful_or_dangerous",
    });
    expect(both.hours.toString()).toBe("36");
  });
});

// ----------------------------------------------------------- норма периода

describe("норма периода", () => {
  test("следует производственному календарю", () => {
    // (40 / 5) × 20 − 1 × 1 = 159 — формула ст. 104 и ст. 95 ТК РФ.
    const facts: CalendarFacts = { workingDays: 20, preHolidayDays: 1 };
    expect(baseNormHours(norm(), facts).toString()).toBe("159");
  });

  test("сокращённая неделя уменьшает норму пропорционально", () => {
    const facts: CalendarFacts = { workingDays: 20, preHolidayDays: 0 };
    const reduced = norm({ conditions: "harmful_or_dangerous" });
    expect(baseNormHours(reduced, facts).toString()).toBe("144");
  });

  test("дробная дневная норма не даёт мусора в хвосте", () => {
    // 36 / 5 = 7,2, и в двоичной плавающей точке 7.2 × 118 даёт
    // 849.5999999999999. Ради этого случая и взята точная арифметика.
    const facts: CalendarFacts = { workingDays: 118, preHolidayDays: 0 };
    const reduced = norm({ conditions: "harmful_or_dangerous" });
    expect(baseNormHours(reduced, facts).toString()).toBe("849.6");
  });
});

// ---------------------------------------------------------- график караула

describe("график караула", () => {
  test("цикл повторяется каждые четверо суток", () => {
    const cycle: GuardCycle = { guard: 1, firstShiftDate: "2026-01-01" };
    const dates = shiftDates(cycle, "2026-01-01", "2026-02-01");

    expect(dates.slice(0, 4)).toEqual([
      "2026-01-01",
      "2026-01-05",
      "2026-01-09",
      "2026-01-13",
    ]);
    expect(dates).toHaveLength(8);
  });

  test("период, начавшийся после первой смены, сохраняет фазу", () => {
    // Расчёт за март не должен зависеть от того, что цикл начался в
    // январе: фаза цикла — свойство караула, а не периода.
    const cycle: GuardCycle = { guard: 3, firstShiftDate: "2026-01-03" };
    const march = shiftDates(cycle, "2026-03-01", "2026-04-01");

    expect(march[0]).toBe("2026-03-04");
    for (const day of march) {
      expect(daysBetween("2026-01-03", day) % 4).toBe(0);
    }
  });

  test("четыре караула вместе закрывают каждые сутки ровно один раз", () => {
    // Проверка самого режима, а не кода.
    const covered: IsoDate[] = [];
    for (let offset = 0; offset < 4; offset += 1) {
      const cycle: GuardCycle = {
        guard: (offset + 1) as GuardNumber,
        firstShiftDate: addDays("2026-01-01", offset),
      };
      covered.push(...shiftDates(cycle, "2026-01-01", "2026-02-01"));
    }

    const january = Array.from({ length: 31 }, (_, index) =>
      addDays("2026-01-01", index),
    );
    expect([...covered].sort()).toEqual(january);
  });

  test("пустой период не даёт смен", () => {
    const cycle: GuardCycle = { guard: 1, firstShiftDate: "2026-01-01" };
    expect(shiftDates(cycle, "2026-03-01", "2026-03-01")).toEqual([]);
  });
});

// ------------------------------------------------------------ полный расчёт

function march(
  absences: AbsencePeriod[],
  overrides: Partial<CalculatePeriodInput> = {},
) {
  return calculatePeriod({
    periodStart: "2026-03-01",
    periodEnd: "2026-04-01",
    cycle: { guard: 1, firstShiftDate: "2026-01-01" },
    weekly: norm(),
    calendar: { workingDays: 21, preHolidayDays: 0 },
    absences,
    holidayDays: NO_HOLIDAYS,
    workingDays: MARCH_WORKING,
    preHolidayDays: NO_HOLIDAYS,
    ...overrides,
  });
}

describe("полный расчёт", () => {
  test("месяц без отсутствий считает каждую смену", () => {
    const result = march([]);

    expect(result.baseNormHours.toString()).toBe("168"); // (40/5) × 21
    expect(result.excludedHours.toString()).toBe("0");
    expect(result.normHours.toString()).toBe("168");
    // Караул заступает 2, 6, 10, 14, 18, 22, 26 и 30 марта — восемь смен,
    // и каждая укладывается в месяц целиком (последняя кончается 31-го).
    expect(result.scheduledShifts).toBe(8);
    expect(result.actualHours.toString()).toBe("192");
    expect(result.overtimeHours.toString()).toBe("24");
  });

  test("отсутствие уменьшает норму, а не факт", () => {
    // Главный тест этого модуля. Смена, попавшая в отпуск, не отработана
    // — значит, её нет в факте. Но и вычитать её из факта нельзя: её часы
    // уходят ИЗ НОРМЫ. Именно это правило нарушают, ставя «минус 24 часа
    // за смену в отпуске».
    const clean = march([]);
    const withLeave = march([
      { start: "2026-03-01", endInclusive: "2026-03-14", kind: "annual_leave" },
    ]);

    // За 1-14 марта у первого караула четыре заступления: 2, 6, 10, 14.
    expect(withLeave.absentShifts).toBe(4);
    // 1-14 марта — десять рабочих дней по календарю, по 8 часов нормы.
    expect(withLeave.excludedHours.toString()).toBe("80");
    expect(withLeave.normHours.toString()).toBe(
      clean.baseNormHours.minus(80).toString(),
    );

    // Факт уменьшился ровно на неотработанные часы — и ни на час больше.
    expect(withLeave.actualHours.toString()).toBe(
      clean.actualHours.minus(96).toString(),
    );

    // Недоработки нет: отпуск не создаёт долга — это главное.
    expect(withLeave.undertimeHours.toString()).toBe("0");

    // Переработка при этом уменьшается, и так и должно быть. Из нормы
    // ушло 80 часов (десять рабочих дней), а из факта — 96 (четыре смены
    // по 24). Разница в 16 часов — не потеря, а следствие того, что
    // сменщик за две недели отпуска пропускает больше часов, чем норма за
    // те же дни содержит.
    expect(clean.overtimeHours.toString()).toBe("24");
    expect(withLeave.overtimeHours.toString()).toBe("8");
  });

  test("неверная норма показывает выдуманный долг", () => {
    // Если норму не уменьшить, у человека возникнет недоработка, которой
    // нет. Система обязана показать не только правильный ответ, но и цену
    // неправильного — иначе спорить не с чем.
    const result = march([
      { start: "2026-03-01", endInclusive: "2026-03-31", kind: "annual_leave" },
    ]);

    expect(result.actualHours.toString()).toBe("0");
    // 22 рабочих дня марта × 8 = 176 — больше нормы месяца в фикстуре,
    // поэтому норма обнуляется, а не уходит в минус.
    expect(result.excludedHours.toString()).toBe("176");
    expect(result.normHours.toString()).toBe("0");
    expect(result.undertimeHours.toString()).toBe("0");
    // А вот столько «долга» покажет табель, в котором норму не тронули.
    expect(result.wrongNormUndertimeHours.toString()).toBe("168");
  });

  test("смена через границу суток делит свои часы", () => {
    // При разводе в 08:30 смена с 30 марта отдаёт 30-му 15,5 часа, а 31-му
    // 8,5.
    const firstDay = march([], { periodStart: "2026-03-30", periodEnd: "2026-03-31" });
    const secondDay = march([], { periodStart: "2026-03-31", periodEnd: "2026-04-01" });

    expect(firstDay.shifts.at(-1)?.startedOn).toBe("2026-03-30");
    expect(firstDay.actualHours.toString()).toBe("15.5"); // с 08:30 до полуночи

    // Смена заступила накануне периода — и всё же отдаёт ему свой хвост.
    // Без просмотра на сутки назад эти 8,5 часа терялись бы у каждого
    // месяца, начинающегося со вторых суток чужой смены.
    expect(secondDay.shifts[0]?.startedOn).toBe("2026-03-30");
    expect(secondDay.actualHours.toString()).toBe("8.5"); // с полуночи до 08:30
  });

  test("ночные считаются по часам, а не пропорцией", () => {
    // Пропорция от длины куска дала бы 8 × 15,5/24 = 5,17 в первых сутках
    // — числа, которого на часах не существует. С 08:30 до полуночи ночных
    // ровно два часа (22:00-24:00), а шесть остальных лежат в следующих
    // сутках (00:00-06:00).
    const firstDay = march([], { periodStart: "2026-03-30", periodEnd: "2026-03-31" });
    const secondDay = march([], { periodStart: "2026-03-31", periodEnd: "2026-04-01" });

    expect(firstDay.shifts.at(-1)!.nightHours.toString()).toBe("2");
    expect(secondDay.shifts[0]!.nightHours.toString()).toBe("6");
    // И вместе — восемь: одна смена не даёт восьми ночных дважды.
    expect(
      firstDay.shifts.at(-1)!.nightHours.plus(secondDay.shifts[0]!.nightHours).toString(),
    ).toBe("8");
  });

  test("месячные итоги считаются по суткам, а не по дате заступления", () => {
    // Дефект, найденный на живом профиле: на периоде в полгода смене,
    // заступившей 31 марта, март получал все 24 часа. Месячная сумма
    // оказывалась завышена, апрельская занижена, и обе расходились с
    // табелем.
    // Цикл взят с живого профиля: 4-й караул, первая смена 2 января. При
    // нём заступление приходится ровно на 31 марта.
    const halfYear = calculatePeriod({
      periodStart: "2026-01-01",
      periodEnd: "2026-07-01",
      cycle: { guard: 4, firstShiftDate: "2026-01-02" },
      weekly: norm(),
      calendar: { workingDays: 118, preHolidayDays: 2 },
      absences: [],
      holidayDays: NO_HOLIDAYS,
      workingDays: NO_HOLIDAYS,
      preHolidayDays: NO_HOLIDAYS,
    });

    const march31 = halfYear.days.filter((day) => day.day === "2026-03-31");
    const april1 = halfYear.days.filter((day) => day.day === "2026-04-01");

    expect(march31).toHaveLength(1);
    expect(march31[0]!.hours.toString()).toBe("15.5");
    expect(march31[0]!.nightHours.toString()).toBe("2");
    expect(march31[0]!.isShiftStart).toBe(true);

    // Хвост той же смены — в апреле, и он помечен как продолжение.
    expect(april1).toHaveLength(1);
    expect(april1[0]!.hours.toString()).toBe("8.5");
    expect(april1[0]!.nightHours.toString()).toBe("6");
    expect(april1[0]!.isShiftStart).toBe(false);

    // Сумма суток равна сумме смен: разложение ничего не потеряло.
    const fromDays = halfYear.days.reduce((sum, day) => sum.plus(day.hours), new Dec(0));
    const fromShifts = halfYear.shifts.reduce((sum, s) => sum.plus(s.hours), new Dec(0));
    expect(fromDays.toString()).toBe(fromShifts.toString());
  });

  test("норма никогда не уходит в минус", () => {
    // Отсутствие длиннее периода не делает человека должным «недоработать».
    const result = march(
      [{ start: "2026-01-01", endInclusive: "2026-12-31", kind: "sick_leave" }],
      { calendar: { workingDays: 1, preHolidayDays: 0 } },
    );

    expect(result.normHours.toString()).toBe("0");
    expect(result.overtimeHours.toString()).toBe("0");
  });

  test("праздничные часы считаются, но не обещаются", () => {
    // Приказ № 410 п. 14: при суммированном учёте они в пределах нормы
    // дополнительным отдыхом не компенсируются. Показать их как
    // «положено сверху» значило бы пообещать то, чего норма не даёт.
    const newYear = new Set(
      Array.from({ length: 8 }, (_, index) => addDays("2026-01-01", index)),
    );
    const result = march([], {
      periodStart: "2026-01-01",
      periodEnd: "2026-02-01",
      holidayDays: newYear,
    });

    // Первый караул заступает 1 и 5 января — обе смены целиком в каникулах.
    expect(result.holidayHours.toString()).toBe("48");
  });

  test.each([0, 1, 2, 3])("караул %i получает ту же годовую норму", (offset) => {
    // Следствие ст. 104 ТК РФ и одновременно проверка на здравый смысл:
    // номер караула не может менять норму, он меняет только даты.
    const result = calculatePeriod({
      periodStart: "2026-01-01",
      periodEnd: "2027-01-01",
      cycle: {
        guard: (offset + 1) as GuardNumber,
        firstShiftDate: addDays("2026-01-01", offset),
      },
      weekly: norm(),
      calendar: { workingDays: 247, preHolidayDays: 6 },
      absences: [],
      holidayDays: NO_HOLIDAYS,
      workingDays: NO_HOLIDAYS,
      preHolidayDays: NO_HOLIDAYS,
    });

    expect(result.baseNormHours.toString()).toBe("1970"); // (40/5) × 247 − 6
    expect([91, 92]).toContain(result.scheduledShifts);
  });
});

// ------------------------------------------------ отгул и вызовы

describe("отгул", () => {
  test("норму не уменьшает, а гасит переработку", () => {
    // Отгул даётся ЗА УЖЕ ОТРАБОТАННОЕ сверх нормы (ст. 55 ФЗ-141,
    // ст. 152 ТК РФ). Уменьшить за него ещё и норму значило бы заплатить
    // дважды: снять часы с нормы и не зачесть их в переработку.
    const clean = march([]);
    const withTimeOff = march([
      { start: "2026-03-01", endInclusive: "2026-03-14", kind: "time_off_in_lieu" },
    ]);

    // Норма — ровно та же, что без отгула.
    expect(withTimeOff.normHours.toString()).toBe(clean.normHours.toString());
    expect(withTimeOff.excludedHours.toString()).toBe("0");

    // А переработка уменьшилась на часы пропущенных смен: четыре смены по
    // 24 часа — это и есть погашенные 96.
    expect(clean.actualHours.minus(withTimeOff.actualHours).toString()).toBe("96");
    expect(clean.overtimeHours.minus(withTimeOff.overtimeHours).toString()).toBe("24");
  });

  test("отличается от отпуска тем же периодом", () => {
    // Один и тот же период, разный вид — и разный ответ. Ради этого
    // различия вид и заведён.
    const leave = march([
      { start: "2026-03-01", endInclusive: "2026-03-14", kind: "annual_leave" },
    ]);
    const timeOff = march([
      { start: "2026-03-01", endInclusive: "2026-03-14", kind: "time_off_in_lieu" },
    ]);

    expect(leave.excludedHours.toString()).toBe("80");
    expect(timeOff.excludedHours.toString()).toBe("0");
    expect(leave.actualHours.toString()).toBe(timeOff.actualHours.toString());
    expect(leave.overtimeHours.toString()).toBe("8");
    expect(timeOff.overtimeHours.toString()).toBe("0");
  });
});

describe("вызовы помимо графика", () => {
  const call = (overrides: Partial<CalculatePeriodInput> = {}) =>
    march([], {
      callouts: [
        {
          start: "2026-03-03",
          endInclusive: "2026-03-05",
          kind: "competition",
          hoursPerDay: new Dec(8),
        },
      ],
      ...overrides,
    });

  test("часы прибавляются к отработанному, норма не меняется", () => {
    const clean = march([]);
    const withCallout = call();

    // Три дня по 8 часов.
    expect(withCallout.actualHours.minus(clean.actualHours).toString()).toBe("24");
    expect(withCallout.normHours.toString()).toBe(clean.normHours.toString());
    expect(withCallout.overtimeHours.minus(clean.overtimeHours).toString()).toBe("24");
  });

  test("сутки вызова попадают в разбивку и помечены видом", () => {
    const days = call().days.filter((day) => day.calloutKind != null);
    expect(days.map((day) => day.day)).toEqual([
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
    ]);
    expect(days[0]!.calloutKind).toBe("competition");
    // Ночные по вызову не считаются: распоряжение задаёт число часов, а не
    // время суток, и раскладывать их по часам было бы выдумкой.
    expect(days[0]!.nightHours.toString()).toBe("0");
  });

  test("вызов может совпасть со сменой, и оба остаются в расчёте", () => {
    // 2 марта у первого караула заступление (цикл с 1 января); вызов в тот
    // же день не отменяет смену и не отменяется ею.
    const both = march([], {
      callouts: [
        {
          start: "2026-03-02",
          endInclusive: "2026-03-02",
          kind: "elections",
          hoursPerDay: new Dec(12),
        },
      ],
    });
    const sameDay = both.days.filter((day) => day.day === "2026-03-02");
    expect(sameDay).toHaveLength(2);
    expect(sameDay.some((day) => day.isShiftStart)).toBe(true);
    expect(sameDay.some((day) => day.calloutKind === "elections")).toBe(true);
    // Часы складываются: 15,5 от смены плюс 12 по вызову.
    expect(both.actualHours.minus(march([]).actualHours).toString()).toBe("12");
  });

  test("несколько вызовов в одни сутки считаются все", () => {
    // Настоящий день: 2 марта заступление, после смены соревнования, а
    // следом вызвали в резерв. Три записи об одних сутках, и ни одна не
    // отменяет остальные.
    const stacked = march([], {
      callouts: [
        {
          start: "2026-03-02",
          endInclusive: "2026-03-02",
          kind: "competition",
          hoursPerDay: new Dec(6),
        },
        {
          start: "2026-03-02",
          endInclusive: "2026-03-02",
          kind: "reserve",
          hoursPerDay: new Dec(4),
        },
      ],
    });

    const sameDay = stacked.days.filter((day) => day.day === "2026-03-02");
    expect(sameDay).toHaveLength(3);
    expect(sameDay.flatMap((day) => (day.calloutKind ? [day.calloutKind] : []))).toEqual([
      "competition",
      "reserve",
    ]);
    // Шесть часов и четыре, а не только первые шесть.
    expect(stacked.actualHours.minus(march([]).actualHours).toString()).toBe("10");
  });

  test("два вызова одного вида в одни сутки не схлопываются в один", () => {
    // Резерв утром и резерв вечером — это два распоряжения и два раза по
    // столько-то часов. Совпадение вида не повод считать их одним.
    const twice = march([], {
      callouts: [
        {
          start: "2026-03-07",
          endInclusive: "2026-03-07",
          kind: "reserve",
          hoursPerDay: new Dec(3),
        },
        {
          start: "2026-03-07",
          endInclusive: "2026-03-07",
          kind: "reserve",
          hoursPerDay: new Dec(5),
        },
      ],
    });

    const sameDay = twice.days.filter(
      (day) => day.day === "2026-03-07" && day.calloutKind != null,
    );
    expect(sameDay.map((day) => day.hours.toString())).toEqual(["3", "5"]);
    expect(twice.actualHours.minus(march([]).actualHours).toString()).toBe("8");
  });

  test("часть вызова вне периода в него не попадает", () => {
    const spanning = march([], {
      callouts: [
        {
          start: "2026-02-27",
          endInclusive: "2026-03-02",
          kind: "reserve",
          hoursPerDay: new Dec(24),
        },
      ],
    });
    // В марте только 1 и 2 число: границы периода полуоткрыты и здесь.
    const days = spanning.days.filter((day) => day.calloutKind != null);
    expect(days.map((day) => day.day)).toEqual(["2026-03-01", "2026-03-02"]);
  });
});
