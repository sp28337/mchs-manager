import { describe, expect, it } from "vitest";

import { fromBase64Url, toBase64Url } from "./base64url";
import { concat } from "./bytes";
import { CryptoFormatError } from "./errors";

/**
 * Один знак расхождения с серверным разбором — и человек не войдёт.
 *
 * Сервер разбирает те же строки (`decode_wrapped` в
 * `core/security.py`): без выравнивающих `=`, с `-` и `_` вместо `+` и
 * `/`. Поэтому проверяется не «работает ли base64», а именно этот вид.
 */
describe("base64url", () => {
  it("без выравнивающих знаков и без + и /", () => {
    // 0xfb 0xff даёт в обычном base64 и «+», и «/», и хвост «==».
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);

    expect(toBase64Url(bytes)).toBe("-_-_");
    expect(toBase64Url(new Uint8Array([0x01]))).toBe("AQ");
  });

  it("туда и обратно для любой длины остатка", () => {
    for (let длина = 0; длина < 20; длина += 1) {
      const bytes = crypto.getRandomValues(new Uint8Array(длина));

      expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes]);
    }
  });

  it("мегабайт не ломает стек", () => {
    // `String.fromCharCode(...bytes)` на таком размере падает с
    // «Maximum call stack size exceeded» — поэтому строка собирается
    // кусками, и этот тест о том, что куски остались. Мегабайт — это
    // предел размера блоба из раздела 7 контракта.
    //
    // Случайное заполняется по 64 КиБ: больше `getRandomValues` за один
    // вызов не отдаёт (так сказано в его описании).
    const bytes = new Uint8Array(1024 * 1024);
    for (let i = 0; i < bytes.length; i += 65536) {
      crypto.getRandomValues(bytes.subarray(i, i + 65536));
    }

    expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes]);
  });

  it("мусор — это ошибка формата, а не молчаливые нули", () => {
    for (const мусор of ["не base64", "AQ==", "AQ!", "А", "AQIDBA$"]) {
      expect(() => fromBase64Url(мусор)).toThrow(CryptoFormatError);
    }
  });

  it("склейка сохраняет порядок", () => {
    const первый = new Uint8Array([1, 2]);
    const второй = new Uint8Array([3]);

    expect([...concat(первый, второй, new Uint8Array(0))]).toEqual([1, 2, 3]);
  });
});
