import { describe, expect, it } from "vitest";

import { RecoveryKeyError } from "./errors";
import {
  formatRecoveryKey,
  generateRecoveryKey,
  parseRecoveryKey,
  recoveryKeyBytes,
} from "./recovery";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Ключ восстановления человек переписывает на бумагу РУКОЙ.
 *
 * Поэтому проверяется не только «туда и обратно», а то, ради чего
 * заведён контрольный знак: опечатка и перестановка соседних знаков
 * должны быть видны сразу, пока ключ ещё есть на бумаге. Ошибка,
 * замеченная через полгода, — это потерянные данные: второго ключа
 * восстановления не бывает.
 */
describe("ключ восстановления", () => {
  it("27 знаков из алфавита без I, L, O, U", () => {
    for (let i = 0; i < 50; i += 1) {
      const ключ = generateRecoveryKey();

      expect(ключ).toHaveLength(27);
      expect([...ключ].every((знак) => ALPHABET.includes(знак))).toBe(true);
      expect(ключ).not.toMatch(/[ILOU]/);
    }
  });

  it("контрольный знак всегда из алфавита", () => {
    // Остаток бывает до 36, а знаков 32: ключи, которым контрольный знак
    // записать нечем, генератор обязан отбрасывать, а не выдавать
    // что-нибудь похожее.
    for (let i = 0; i < 200; i += 1) {
      const ключ = generateRecoveryKey();

      expect(checksumOf(ключ.slice(0, 26))).toBe(ключ.slice(26));
    }
  });

  it("печатный вид — группами по пять через тире", () => {
    const ключ = generateRecoveryKey();

    expect(formatRecoveryKey(ключ)).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}-[0-9A-Z]{2}$/);
    expect(parseRecoveryKey(formatRecoveryKey(ключ))).toBe(ключ);
  });

  it("128 бит ключа — ровно шестнадцать байт", () => {
    expect(recoveryKeyBytes(generateRecoveryKey())).toHaveLength(16);
  });

  it("разные ключи дают разные байты", () => {
    const байты = new Set(
      Array.from({ length: 50 }, () => recoveryKeyBytes(generateRecoveryKey()).join(",")),
    );

    expect(байты.size).toBe(50);
  });

  it("прощается всё, что не меняет смысла", () => {
    const ключ = generateRecoveryKey();
    const печатный = formatRecoveryKey(ключ);

    for (const вариант of [
      печатный.toLowerCase(),
      печатный.replaceAll("-", " "),
      ` ${печатный} `,
      печатный.replaceAll("-", ""),
    ]) {
      expect(parseRecoveryKey(вариант)).toBe(ключ);
    }
  });

  it("I и L читаются как 1, O — как 0", () => {
    // Crockford этих знаков не печатает именно потому, что от руки они
    // неотличимы от цифр. Человек, переписавший «1» как «l», должен
    // войти, а не получить отказ.
    let ключ = generateRecoveryKey();
    while (!ключ.includes("1") || !ключ.includes("0")) {
      ключ = generateRecoveryKey();
    }

    const какПереписали = ключ.replaceAll("1", "l").replaceAll("0", "O");

    expect(какПереписали).not.toBe(ключ);
    expect(parseRecoveryKey(какПереписали)).toBe(ключ);
  });

  it("одиночная опечатка не проходит", () => {
    let проверено = 0;

    for (let i = 0; i < 20; i += 1) {
      const ключ = generateRecoveryKey();

      for (let позиция = 0; позиция < 26; позиция += 1) {
        const было = ключ[позиция] as string;
        const стало = ALPHABET[(ALPHABET.indexOf(было) + 1 + позиция) % 32] as string;
        const испорченный = ключ.slice(0, позиция) + стало + ключ.slice(позиция + 1);

        expect(() => parseRecoveryKey(испорченный)).toThrow(RecoveryKeyError);
        проверено += 1;
      }
    }

    expect(проверено).toBe(20 * 26);
  });

  it("перестановка двух соседних знаков не проходит", () => {
    for (let i = 0; i < 20; i += 1) {
      const ключ = generateRecoveryKey();

      for (let позиция = 0; позиция < 25; позиция += 1) {
        const первый = ключ[позиция] as string;
        const второй = ключ[позиция + 1] as string;

        if (первый === второй) {
          continue;
        }

        const переставленный =
          ключ.slice(0, позиция) + второй + первый + ключ.slice(позиция + 2);

        expect(() => parseRecoveryKey(переставленный)).toThrow(RecoveryKeyError);
      }
    }
  });

  it("не та длина — понятный отказ", () => {
    const ключ = generateRecoveryKey();

    expect(() => parseRecoveryKey(ключ.slice(0, 26))).toThrow(/27 знаков/);
    expect(() => parseRecoveryKey(`${ключ}0`)).toThrow(/27 знаков/);
  });

  it("знака вне алфавита в ключе быть не может", () => {
    const ключ = generateRecoveryKey();

    expect(() => parseRecoveryKey(`U${ключ.slice(1)}`)).toThrow(/знака/);
  });

  it("лишние биты в последнем знаке — чужая запись", () => {
    // Наш генератор оставляет два последних бита пустыми: 128 бит не
    // делятся на пять. Запись, где они не нули, нашей не была — даже
    // если контрольный знак к ней подогнан.
    let проверено = 0;

    for (let i = 0; i < 20 && проверено < 1; i += 1) {
      const ключ = generateRecoveryKey();
      const последний = ALPHABET.indexOf(ключ[25] as string);
      const данные = ключ.slice(0, 25) + (ALPHABET[последний + 1] as string);
      const знак = checksumOf(данные);

      if (знак === null) {
        continue; // такой записи наш генератор и не выдал бы
      }

      expect(() => parseRecoveryKey(`${данные}${знак}`)).toThrow(RecoveryKeyError);
      проверено += 1;
    }

    expect(проверено).toBe(1);
  });
});

/** Тот же расчёт, что в модуле: нужен, чтобы собирать подложные ключи. */
function checksumOf(data: string): string | null {
  let сумма = 0;

  for (let i = 0; i < data.length; i += 1) {
    сумма += (i + 1) * ALPHABET.indexOf(data[i] as string);
  }

  const остаток = сумма % 37;

  return остаток < 32 ? (ALPHABET[остаток] as string) : null;
}
