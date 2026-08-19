import { describe, expect, it } from "vitest";

import { Dec, formatDaysAndHours, parseHours, splitIntoDays, toDecimal } from "./decimal";

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
 * Переработка в сутках показывается сменами и часами, а не десятой долей
 * суток: отгул берут сменами и часами, и «8,8 суток» человеку приходится
 * пересчитывать в голове ровно тогда, когда он собрался что-то с этой
 * переработкой делать.
 */
describe("часы в сутках дежурства", () => {
  it("раскладываются на смены и остаток", () => {
    expect(splitIntoDays(new Dec(212))).toEqual({ days: 8, hours: new Dec(20) });
    expect(formatDaysAndHours(new Dec(212))).toBe("8 суток 20 ч");
  });

  it("ровные сутки не тянут за собой ноль часов", () => {
    expect(formatDaysAndHours(new Dec(192))).toBe("8 суток");
  });

  it("меньше смены — просто часы", () => {
    expect(formatDaysAndHours(new Dec(20))).toBe("20 ч");
    expect(formatDaysAndHours(new Dec(0))).toBe("0 ч");
  });

  it("остаток сохраняет половины часа", () => {
    expect(formatDaysAndHours(new Dec("30.5"))).toBe("1 сутки 6,5 ч");
  });

  it("слово согласуется с числом", () => {
    // Единственного числа у слова нет, и форма зависит от последней цифры
    // — кроме одиннадцати, где она обманывает.
    expect(formatDaysAndHours(new Dec(24))).toBe("1 сутки");
    expect(formatDaysAndHours(new Dec(24 * 2))).toBe("2 суток");
    expect(formatDaysAndHours(new Dec(24 * 11))).toBe("11 суток");
    expect(formatDaysAndHours(new Dec(24 * 21))).toBe("21 сутки");
  });
});
