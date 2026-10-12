import { describe, expect, it } from "vitest";

import { fromBase64Url } from "./base64url";
import { createDataKey, unwrapDataKey, unwrapForRewrap, wrapDataKey } from "./dek";
import { CryptoFormatError, CryptoKeyMismatchError } from "./errors";
import { CHEAP_KDF, АДРЕС, ПАРОЛЬ } from "./fixtures";
import { derivePasswordKeys, deriveRecoveryKey } from "./kdf";
import { generateRecoveryKey } from "./recovery";

async function ключОбёртки(пароль = ПАРОЛЬ) {
  return (await derivePasswordKeys(АДРЕС, пароль, CHEAP_KDF)).wrappingKey;
}

/**
 * Обёртка ключа данных — то, что лежит на сервере вместо пароля и данных.
 *
 * Проверяется здесь не «работает ли AES-GCM», а три свойства, на которых
 * держится вся схема: размер обёртки совпадает с заявленным в контракте
 * (60 байт), неизвлекаемый ключ нельзя ни вынуть, ни переупаковать, и
 * обёртку паролем нельзя подсунуть вместо обёртки ключом восстановления.
 */
describe("обёртка ключа данных", () => {
  it("60 байт: nonce, ключ и признак целостности", async () => {
    const обёртка = await wrapDataKey(await createDataKey(), await ключОбёртки(), "password");

    expect(fromBase64Url(обёртка)).toHaveLength(60);
  });

  it("разворачивается тем же ключом", async () => {
    const kek = await ключОбёртки();
    const обёртка = await wrapDataKey(await createDataKey(), kek, "password");

    const ключДанных = await unwrapDataKey(обёртка, kek, "password");

    expect(ключДанных.handle.algorithm).toEqual({ name: "AES-GCM", length: 256 });
    expect(ключДанных.handle.usages).toEqual(["encrypt", "decrypt"]);
  });

  it("каждая обёртка со своим nonce", async () => {
    const kek = await ключОбёртки();
    const ключДанных = await createDataKey();

    const первая = await wrapDataKey(ключДанных, kek, "password");
    const вторая = await wrapDataKey(ключДанных, kek, "password");

    expect(вторая).not.toBe(первая);
  });

  it("чужим паролем не разворачивается", async () => {
    const обёртка = await wrapDataKey(await createDataKey(), await ключОбёртки(), "password");

    await expect(
      unwrapDataKey(обёртка, await ключОбёртки("другой пароль"), "password"),
    ).rejects.toThrow(CryptoKeyMismatchError);
  });

  it("обёртку паролем нельзя выдать за обёртку ключом восстановления", async () => {
    // Без AAD такая подмена прошла бы: байты те же, ключ тот же.
    const kek = await ключОбёртки();
    const обёртка = await wrapDataKey(await createDataKey(), kek, "password");

    await expect(unwrapDataKey(обёртка, kek, "recovery")).rejects.toThrow(CryptoKeyMismatchError);
  });

  it("развёрнутый ключ данных не вынуть и не переупаковать", async () => {
    const kek = await ключОбёртки();
    const обёртка = await wrapDataKey(await createDataKey(), kek, "password");

    const ключДанных = await unwrapDataKey(обёртка, kek, "password");

    expect(ключДанных.handle.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", ключДанных.handle)).rejects.toThrow();
    await expect(wrapDataKey(ключДанных, kek, "password")).rejects.toThrow();
  });

  it("для смены пароля ключ разворачивается извлекаемым — и только там", async () => {
    const kek = await ключОбёртки();
    const обёртка = await wrapDataKey(await createDataKey(), kek, "password");

    const дляПереупаковки = await unwrapForRewrap(обёртка, kek, "password");

    expect(дляПереупаковки.handle.extractable).toBe(true);
    await expect(
      wrapDataKey(дляПереупаковки, await ключОбёртки("новый пароль"), "password"),
    ).resolves.toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("ключ восстановления разворачивает свою обёртку", async () => {
    const ключВосстановления = generateRecoveryKey();
    const kekRec = await deriveRecoveryKey(АДРЕС, ключВосстановления, CHEAP_KDF);
    const ключДанных = await createDataKey();

    const обёртка = await wrapDataKey(ключДанных, kekRec, "recovery");

    await expect(unwrapDataKey(обёртка, kekRec, "recovery")).resolves.toBeDefined();
  });

  it("не та длина и не тот вид — ошибка формата, а не «не тот пароль»", async () => {
    const kek = await ключОбёртки();

    await expect(unwrapDataKey("AQID", kek, "password")).rejects.toThrow(CryptoFormatError);
    await expect(unwrapDataKey("не base64", kek, "password")).rejects.toThrow(CryptoFormatError);
  });

  it("изменённый байт обёртки виден", async () => {
    const kek = await ключОбёртки();
    const обёртка = await wrapDataKey(await createDataKey(), kek, "password");
    const байты = fromBase64Url(обёртка);
    байты[30] = (байты[30] as number) ^ 1;

    const испорченная = btoa(String.fromCharCode(...байты))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");

    await expect(unwrapDataKey(испорченная, kek, "password")).rejects.toThrow(
      CryptoKeyMismatchError,
    );
  });
});
