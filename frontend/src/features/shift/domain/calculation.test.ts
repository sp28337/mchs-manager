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
import { addDays, daysBetween, type IsoDate } from "./plain-date";

const NO_HOLIDAYS: ReadonlySet<IsoDate> = new Set<IsoDate>();

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
    expect(withLeave.excludedHours.toString()).toBe("96");
    expect(withLeave.normHours.toString()).toBe(
      clean.baseNormHours.minus(96).toString(),
    );

    // Факт уменьшился ровно на неотработанные часы — и ни на час больше.
    expect(withLeave.actualHours.toString()).toBe(
      clean.actualHours.minus(96).toString(),
    );

    // А переработка при этом НЕ ИЗМЕНИЛАСЬ: отпуск не создаёт долга.
    expect(withLeave.overtimeHours.toString()).toBe(clean.overtimeHours.toString());
  });

  test("неверная норма показывает выдуманный долг", () => {
    // Если норму не уменьшить, у человека возникнет недоработка, которой
    // нет. Система обязана показать не только правильный ответ, но и цену
    // неправильного — иначе спорить не с чем.
    const result = march([
      { start: "2026-03-01", endInclusive: "2026-03-31", kind: "annual_leave" },
    ]);

    expect(result.actualHours.toString()).toBe("0");
    expect(result.normHours.toString()).toBe("0");
    expect(result.undertimeHours.toString()).toBe("0");
    // А вот столько «долга» покажет табель, в котором норму не тронули.
    expect(result.wrongNormUndertimeHours.toString()).toBe("168");
  });

  test("смена через границу месяца делит свои часы", () => {
    // Смена с 31 марта отдаёт марту 16 часов, апрелю — 8.
    const firstDay = march([], { periodStart: "2026-03-30", periodEnd: "2026-03-31" });
    const secondDay = march([], { periodStart: "2026-03-31", periodEnd: "2026-04-01" });

    expect(firstDay.shifts.at(-1)?.startedOn).toBe("2026-03-30");
    expect(firstDay.actualHours.toString()).toBe("16"); // с 08:00 до полуночи

    // Смена заступила накануне периода — и всё же отдаёт ему свой хвост.
    // Без просмотра на сутки назад эти 8 часов терялись бы у каждого
    // месяца, начинающегося со вторых суток чужой смены.
    expect(secondDay.shifts[0]?.startedOn).toBe("2026-03-30");
    expect(secondDay.actualHours.toString()).toBe("8"); // с полуночи до 08:00
  });

  test("ночные часы делятся вместе со сменой", () => {
    // Иначе смена на стыке дала бы 8 ночных часов дважды.
    const firstDay = march([], { periodStart: "2026-03-30", periodEnd: "2026-03-31" });
    const secondDay = march([], { periodStart: "2026-03-31", periodEnd: "2026-04-01" });

    const total = firstDay.shifts
      .at(-1)!
      .nightHours.plus(secondDay.shifts[0]!.nightHours);
    expect(total.toString()).toBe("8");
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
    });

    expect(result.baseNormHours.toString()).toBe("1970"); // (40/5) × 247 − 6
    expect([91, 92]).toContain(result.scheduledShifts);
  });
});
