import { describe, expect, it } from "vitest";

import { Dec } from "./decimal";
import { PAY_BASIS, calculateOvertimePay, formatMoney, parseMoney } from "./overtime-pay";
import { calendarFactsFor } from "./production-calendar";
import { baseNormHours } from "./calculation";

/** Норма календарного года по производственному календарю приложения. */
function annualNorm(year: number, weeklyHours: number) {
  const facts = calendarFactsFor(`${year}-01-01`, `${year + 1}-01-01`, new Map());
  return {
    hours: baseNormHours(
      { hours: new Dec(weeklyHours), basis: "тест" },
      { workingDays: facts.workingDays, preHolidayDays: facts.preHolidayDays },
    ),
    workingDays: facts.workingDays,
  };
}

describe("часовая ставка", () => {
  it("сотруднику считается делением оклада на среднемесячные часы года (п. 95)", () => {
    const { hours, workingDays } = annualNorm(2026, 40);
    // 2026 год: норма 1972,00 ч, среднемесячно 164,3333 ч.
    expect(hours.toFixed(2)).toBe("1972.00");

    const pay = calculateOvertimePay({
      employment: "attested",
      base: { amount: new Dec(30_000) },
      annualNormHours: hours,
      workingDaysInPeriod: workingDays,
      overtimeHours: new Dec(240),
    });

    expect(pay).not.toBeNull();
    expect(pay!.primary.averageMonthlyHours.toFixed(4)).toBe("164.3333");
    expect(pay!.primary.hourlyRate.toFixed(2)).toBe("182.56");
  });

  it("у сокращённой недели ставка выше: часов в норме меньше, оклад тот же", () => {
    const full = annualNorm(2026, 40);
    const reduced = annualNorm(2026, 36);

    const rate = (norm: typeof full) =>
      calculateOvertimePay({
        employment: "attested",
        base: { amount: new Dec(30_000) },
        annualNormHours: norm.hours,
        workingDaysInPeriod: norm.workingDays,
        overtimeHours: new Dec(10),
      })!.primary.hourlyRate;

    expect(rate(reduced).greaterThan(rate(full))).toBe(true);
    expect(rate(reduced).toFixed(2)).toBe("202.89");
  });

  it("ставка не зависит от длины учётного периода — она годовая (п. 95)", () => {
    const { hours, workingDays } = annualNorm(2026, 40);
    const year = calculateOvertimePay({
      employment: "attested",
      base: { amount: new Dec(30_000) },
      annualNormHours: hours,
      workingDaysInPeriod: workingDays,
      overtimeHours: new Dec(100),
    })!;
    const halfYear = calculateOvertimePay({
      employment: "attested",
      base: { amount: new Dec(30_000) },
      annualNormHours: hours,
      workingDaysInPeriod: Math.round(workingDays / 2),
      overtimeHours: new Dec(100),
    })!;

    expect(halfYear.primary.hourlyRate.toString()).toBe(year.primary.hourlyRate.toString());
  });
});

describe("порог полуторного размера", () => {
  it("в 2026 году это 494 часа — два часа на каждый из 247 рабочих дней (п. 97)", () => {
    const { hours, workingDays } = annualNorm(2026, 40);
    expect(workingDays).toBe(247);

    const pay = calculateOvertimePay({
      employment: "attested",
      base: { amount: new Dec(30_000) },
      annualNormHours: hours,
      workingDaysInPeriod: workingDays,
      overtimeHours: new Dec(240),
    })!;

    expect(pay.primary.thresholdHours.toFixed(0)).toBe("494");
    // Реальная переработка в порог укладывается целиком: двойного размера нет.
    expect(pay.primary.atOneAndHalf.hours.toFixed(2)).toBe("240.00");
    expect(pay.primary.atDouble.hours.toFixed(2)).toBe("0.00");
    expect(pay.primary.total.toDecimalPlaces(2).toString()).toBe("65720.08");
  });

  it("часы сверх порога уходят в двойной размер", () => {
    const { hours, workingDays } = annualNorm(2026, 40);
    const pay = calculateOvertimePay({
      employment: "attested",
      base: { amount: new Dec(30_000) },
      annualNormHours: hours,
      workingDaysInPeriod: workingDays,
      overtimeHours: new Dec(500),
    })!;

    expect(pay.primary.atOneAndHalf.hours.toFixed(2)).toBe("494.00");
    expect(pay.primary.atDouble.hours.toFixed(2)).toBe("6.00");

    const rate = pay.primary.hourlyRate;
    const expected = rate.times(494).times("1.5").plus(rate.times(6).times(2));
    expect(pay.primary.total.toFixed(6)).toBe(expected.toFixed(6));
  });
});

describe("второе прочтение порога", () => {
  it("работнику показывается, и оно выгоднее", () => {
    const { hours, workingDays } = annualNorm(2026, 40);
    const pay = calculateOvertimePay({
      employment: "civilian",
      base: { amount: new Dec(50_000) },
      annualNormHours: hours,
      workingDaysInPeriod: workingDays,
      overtimeHours: new Dec(240),
    })!;

    expect(pay.alternative).not.toBeNull();
    expect(pay.alternative!.thresholdHours.toFixed(0)).toBe("2");
    expect(pay.alternative!.atDouble.hours.toFixed(2)).toBe("238.00");
    expect(pay.alternative!.total.greaterThan(pay.primary.total)).toBe(true);
  });

  it("сотруднику не показывается: п. 97 не оставляет для него места", () => {
    const { hours, workingDays } = annualNorm(2026, 40);
    const pay = calculateOvertimePay({
      employment: "attested",
      base: { amount: new Dec(30_000) },
      annualNormHours: hours,
      workingDaysInPeriod: workingDays,
      overtimeHours: new Dec(240),
    })!;

    expect(pay.alternative).toBeNull();
  });
});

describe("отгул не вычитается дважды", () => {
  // Пункт 99 требует не оплачивать часы, закрытые днями отдыха. В этом
  // приложении отгул — несостоявшаяся смена: её часы не попали в
  // отработанное, и переработка приходит сюда уже уменьшенной. Второе
  // вычитание было бы наказанием за отгул.
  it("сумма считается ровно от переданной переработки", () => {
    const { hours, workingDays } = annualNorm(2026, 40);
    const withoutTimeOff = calculateOvertimePay({
      employment: "attested",
      base: { amount: new Dec(30_000) },
      annualNormHours: hours,
      workingDaysInPeriod: workingDays,
      overtimeHours: new Dec(48),
    })!;
    // Тот же человек взял отгул на сутки: переработка пришла на 24 ч меньше.
    const withTimeOff = calculateOvertimePay({
      employment: "attested",
      base: { amount: new Dec(30_000) },
      annualNormHours: hours,
      workingDaysInPeriod: workingDays,
      overtimeHours: new Dec(24),
    })!;

    const rate = withoutTimeOff.primary.hourlyRate;
    expect(
      withoutTimeOff.primary.total.minus(withTimeOff.primary.total).toFixed(6),
    ).toBe(rate.times(24).times("1.5").toFixed(6));
  });
});

describe("границы", () => {
  it("без базы расчёта нет — не ноль, а отсутствие результата", () => {
    const { hours, workingDays } = annualNorm(2026, 40);
    expect(
      calculateOvertimePay({
        employment: "attested",
        base: { amount: new Dec(0) },
        annualNormHours: hours,
        workingDaysInPeriod: workingDays,
        overtimeHours: new Dec(100),
      }),
    ).toBeNull();
  });

  it("без нормы года ставка не определена", () => {
    expect(
      calculateOvertimePay({
        employment: "attested",
        base: { amount: new Dec(30_000) },
        annualNormHours: new Dec(0),
        workingDaysInPeriod: 247,
        overtimeHours: new Dec(100),
      }),
    ).toBeNull();
  });

  it("нулевая переработка даёт ноль рублей, а не отсутствие расчёта", () => {
    const { hours, workingDays } = annualNorm(2026, 40);
    const pay = calculateOvertimePay({
      employment: "attested",
      base: { amount: new Dec(30_000) },
      annualNormHours: hours,
      workingDaysInPeriod: workingDays,
      overtimeHours: new Dec(0),
    })!;
    expect(pay.primary.total.isZero()).toBe(true);
    expect(pay.primary.hourlyRate.greaterThan(0)).toBe(true);
  });
});

describe("ввод и вывод сумм", () => {
  it("рубли показываются с разрядами и копейками", () => {
    expect(formatMoney(new Dec("65720.081"))).toBe("65\u00a0720,08\u00a0₽");
    // Половина копейки вверх: так округляют деньги, а не как часы.
    expect(formatMoney(new Dec("1.005"))).toBe("1,01\u00a0₽");
    expect(formatMoney(new Dec(0))).toBe("0,00\u00a0₽");
    // Разделитель разрядов — всегда неразрывный пробел, независимо от ICU.
    expect(formatMoney(new Dec(1234567))).toBe("1\u00a0234\u00a0567,00\u00a0₽");
  });

  it("разбор терпит пробелы, запятую и точку", () => {
    expect(parseMoney("30 000")?.toString()).toBe("30000");
    expect(parseMoney("30000,50")?.toString()).toBe("30000.5");
    expect(parseMoney("30000.50")?.toString()).toBe("30000.5");
  });

  it("отрицательное и пустое отвергаются", () => {
    expect(parseMoney("-100")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("   ")).toBeNull();
  });
});

describe("реквизиты основания", () => {
  // Реквизиты протухают молча: приказ отменяют, расчёт остаётся верным, а
  // ссылка под ним превращается в ссылку на недействующий акт — и человек
  // приходит с ней к начальнику. Приказ № 195 отменён приказом № 539
  // (приложение 2 п. 1), и вернуться он не должен.
  it("сотруднику — действующий приказ № 539, а не отменённый № 195", () => {
    expect(PAY_BASIS.attested).toContain("539");
    expect(PAY_BASIS.attested).not.toContain("195");
    expect(PAY_BASIS.attested).toContain("27.06.2024");
  });

  it("работнику — приказ № 747", () => {
    expect(PAY_BASIS.civilian).toContain("747");
  });
});
