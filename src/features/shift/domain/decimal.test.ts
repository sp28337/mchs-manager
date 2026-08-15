import { describe, expect, it } from "vitest";

import { parseHours, toDecimal } from "./decimal";

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
