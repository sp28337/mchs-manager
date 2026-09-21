import { describe, expect, it } from "vitest";

import {
  Dec,
  formatShiftsAndHours,
  numberWord,
  parseHours,
  shiftsWord,
  splitIntoShifts,
  toDecimal,
} from "./decimal";

/**
 * Разбор пользовательского ввода не имеет права бросать исключение.
 *
 * `decimal.js` сообщает о непригодной строке НЕ значением, а исключением:
 * `new Decimal("и")` бросает `DecimalError: Invalid argument`. Все поля,
 * куда человек вводит числа, разбираются на каждое нажатие клавиши, и
 * «не число» там — обычное промежуточное состояние: стёр всё и набирает
 * заново, задел букву, вставил «8 ч» вместе с единицей измерения.
 *
 * Исключение в этом месте роняло весь экран расчёта — вместе с внесёнными
 * отпусками, которые человек только что заполнял.
 */
describe("разбор чисел из ввода человека", () => {
  it("мусор возвращается как отсутствие числа, а не бросается", () => {
    for (const input of ["и", "i", "8 ч", "--", "1.2.3", "abc", "0x", "e5", "+"]) {
      expect(() => toDecimal(input)).not.toThrow();
      expect(toDecimal(input)).toBeNull();
      expect(() => parseHours(input)).not.toThrow();
      expect(parseHours(input)).toBeNull();
    }
  });

  it("«NaN» — не число, хотя исключения и не бросает", () => {
    expect(toDecimal("NaN")).toBeNull();
    expect(parseHours("NaN")).toBeNull();
  });

  it("бесконечность разбирается, но часами не считается", () => {
    expect(toDecimal("Infinity")?.isFinite()).toBe(false);
    expect(parseHours("Infinity")).toBeNull();
  });

  it("нормальный ввод по-прежнему разбирается", () => {
    expect(parseHours("24")?.toString()).toBe("24");
    expect(parseHours("7,5")?.toString()).toBe("7.5");
    expect(parseHours("7.5")?.toString()).toBe("7.5");
    expect(parseHours("  8  ")?.toString()).toBe("8");
    expect(parseHours("")).toBeNull();
  });
});

/**
 * Переработка показывается сменами и часами, а не десятой долей смены:
 * отгул берут сменами и часами, и «8,8 смены» человеку приходится
 * пересчитывать в голове ровно тогда, когда он собрался что-то с этой
 * переработкой делать.
 */
describe("часы сменами", () => {
  it("раскладываются на смены и остаток", () => {
    expect(splitIntoShifts(new Dec(212))).toEqual({ shifts: 8, hours: new Dec(20) });
    expect(formatShiftsAndHours(new Dec(212))).toBe("8 смен 20 ч");
  });

  it("ровные смены не тянут за собой ноль часов", () => {
    expect(formatShiftsAndHours(new Dec(192))).toBe("8 смен");
  });

  it("меньше смены — просто часы", () => {
    expect(formatShiftsAndHours(new Dec(20))).toBe("20 ч");
    expect(formatShiftsAndHours(new Dec(0))).toBe("0 ч");
  });

  it("остаток сохраняет половины часа", () => {
    expect(formatShiftsAndHours(new Dec("30.5"))).toBe("1 смена 6,5 ч");
  });

  it("слово согласуется с числом", () => {
    // Форма зависит от последней цифры — кроме второй десятки, где она
    // обманывает.
    expect(formatShiftsAndHours(new Dec(24))).toBe("1 смена");
    expect(formatShiftsAndHours(new Dec(24 * 2))).toBe("2 смены");
    expect(formatShiftsAndHours(new Dec(24 * 11))).toBe("11 смен");
    expect(formatShiftsAndHours(new Dec(24 * 21))).toBe("21 смена");
  });

  it("смена не суточная — делится на неё, а не на сутки", () => {
    // «Два через два»: двенадцать часов в смене, 30 часов сверх нормы —
    // это две смены и шесть часов, а не сутки с хвостом.
    expect(splitIntoShifts(new Dec(30), 12)).toEqual({ shifts: 2, hours: new Dec(6) });
  });
});

/**
 * Подписи месяца в календаре ставят слово рядом с числом: «21 рабочий»,
 * «1 праздничный», «11 рабочих». Форма зависит не от последней цифры, а от
 * последних двух — и подпись, написанная без этого правила, каждый январь
 * показывала «1 праздничных».
 */
describe("форма слова при числе", () => {
  const рабочий = (n: number) => `${n} ${numberWord(n, "рабочий", "рабочих", "рабочих")}`;

  it("одно, два-четыре и остальные — три разные формы", () => {
    expect(numberWord(1, "правка", "правки", "правок")).toBe("правка");
    expect(numberWord(2, "правка", "правки", "правок")).toBe("правки");
    expect(numberWord(4, "правка", "правки", "правок")).toBe("правки");
    expect(numberWord(5, "правка", "правки", "правок")).toBe("правок");
    expect(numberWord(0, "правка", "правки", "правок")).toBe("правок");
  });

  it("вторая десятка обманывает последней цифрой", () => {
    expect(рабочий(11)).toBe("11 рабочих");
    expect(рабочий(12)).toBe("12 рабочих");
    expect(рабочий(14)).toBe("14 рабочих");
    expect(рабочий(21)).toBe("21 рабочий");
    expect(рабочий(101)).toBe("101 рабочий");
    expect(рабочий(111)).toBe("111 рабочих");
  });

  it("«смена» считается тем же правилом", () => {
    expect(shiftsWord(1)).toBe("смена");
    expect(shiftsWord(3)).toBe("смены");
    expect(shiftsWord(11)).toBe("смен");
    expect(shiftsWord(21)).toBe("смена");
  });
});
