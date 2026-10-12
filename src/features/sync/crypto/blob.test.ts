import { describe, expect, it } from "vitest";

import { decryptBlob, decryptJson, encryptBlob, encryptJson, INDEX_ID, itemAad } from "./blob";
import { fromBase64Url, toBase64Url } from "./base64url";
import { createDataKey, type DataKey } from "./dek";
import { CryptoFormatError, CryptoKeyMismatchError } from "./errors";

const ПРОФИЛЬ = { kind: "profile", itemId: "6f1e0000-0000-0000-0000-0000000000a1" } as const;
const УКАЗАТЕЛЬ = { kind: "index", itemId: INDEX_ID } as const;

const utf8 = new TextEncoder();

async function ключ(): Promise<DataKey> {
  return createDataKey();
}

/**
 * Блоб — всё, что сервер видит о данных человека.
 *
 * Главное здесь — AAD. Он привязывает кусок к его месту, и без этой
 * привязки сервер (или тот, кто до него добрался) мог бы переложить блоб
 * профиля на место указателя библиотеки, вернуть прошлогодний профиль
 * вместо нового или подсунуть блоб одного человека другому — а клиент
 * расшифровал бы подмену, не заметив её.
 */
describe("шифрование элементов", () => {
  it("туда и обратно", async () => {
    const dataKey = await ключ();
    const открытый = utf8.encode("двадцать четыре часа через трое суток");

    const блоб = await encryptBlob(dataKey, ПРОФИЛЬ, открытый);

    expect(блоб).toMatch(/^[A-Za-z0-9_-]+$/);
    expect([...(await decryptBlob(dataKey, ПРОФИЛЬ, блоб))]).toEqual([...открытый]);
  });

  it("конверт — nonce, шифротекст и признак целостности", async () => {
    const блоб = await encryptBlob(await ключ(), ПРОФИЛЬ, utf8.encode("x"));

    // 12 байт nonce + 1 байт данных + 16 байт признака.
    expect(fromBase64Url(блоб)).toHaveLength(29);
  });

  it("одно и то же дважды даёт разные блобы", async () => {
    // Повтор nonce при одном ключе ломает GCM, поэтому он свежий на
    // каждую запись — и два одинаковых профиля не видны серверу как
    // одинаковые.
    const dataKey = await ключ();
    const открытый = utf8.encode("один и тот же профиль");

    const первый = await encryptBlob(dataKey, ПРОФИЛЬ, открытый);
    const второй = await encryptBlob(dataKey, ПРОФИЛЬ, открытый);

    expect(второй).not.toBe(первый);
  });

  it("блоб профиля не расшифровать как указатель", async () => {
    const dataKey = await ключ();
    const блоб = await encryptBlob(dataKey, ПРОФИЛЬ, utf8.encode("профиль"));

    await expect(decryptBlob(dataKey, УКАЗАТЕЛЬ, блоб)).rejects.toThrow(CryptoKeyMismatchError);
  });

  it("блоб одной записи не расшифровать как другую", async () => {
    const dataKey = await ключ();
    const блоб = await encryptBlob(dataKey, ПРОФИЛЬ, utf8.encode("профиль"));
    const чужой = { kind: "profile", itemId: "6f1e0000-0000-0000-0000-0000000000b2" } as const;

    await expect(decryptBlob(dataKey, чужой, блоб)).rejects.toThrow(CryptoKeyMismatchError);
  });

  it("чужим ключом данных не расшифровать", async () => {
    const блоб = await encryptBlob(await ключ(), ПРОФИЛЬ, utf8.encode("профиль"));

    await expect(decryptBlob(await ключ(), ПРОФИЛЬ, блоб)).rejects.toThrow(CryptoKeyMismatchError);
  });

  it("AAD — ровно то, что сказано в контракте", async () => {
    expect(new TextDecoder().decode(itemAad(ПРОФИЛЬ))).toBe(
      "grafik13/blob/v1|profile|6f1e0000-0000-0000-0000-0000000000a1",
    );
    expect(new TextDecoder().decode(itemAad(УКАЗАТЕЛЬ))).toBe("grafik13/blob/v1|index|index");
  });

  it("огрызок блоба — ошибка формата", async () => {
    const dataKey = await ключ();

    await expect(decryptBlob(dataKey, ПРОФИЛЬ, toBase64Url(new Uint8Array(12)))).rejects.toThrow(
      CryptoFormatError,
    );
  });

  it("мегабайт шифруется и расшифровывается", async () => {
    // Предел размера блоба из раздела 7 контракта.
    const dataKey = await ключ();
    const большой = new Uint8Array(1024 * 1024).fill(7);

    const блоб = await encryptBlob(dataKey, ПРОФИЛЬ, большой);

    expect((await decryptBlob(dataKey, ПРОФИЛЬ, блоб)).length).toBe(большой.length);
  });
});

describe("конверт в JSON", () => {
  it("туда и обратно сохраняет значение", async () => {
    const dataKey = await ключ();
    const конверт = {
      fmt: 1,
      kind: "profile",
      id: ПРОФИЛЬ.itemId,
      updatedAt: "2026-10-11T07:21:03.512Z",
      body: { name: "Петров И. С.", hours: 172.5, vacations: [] },
    };

    const блоб = await encryptJson(dataKey, ПРОФИЛЬ, конверт);

    expect(await decryptJson(dataKey, ПРОФИЛЬ, блоб)).toEqual(конверт);
  });

  it("расшифровалось, но не JSON — ошибка формата, а не про пароль", async () => {
    // Ключ верный, проверку целостности прошли: путать человека словами
    // про пароль здесь нельзя.
    const dataKey = await ключ();
    const блоб = await encryptBlob(dataKey, ПРОФИЛЬ, utf8.encode("{не json"));

    await expect(decryptJson(dataKey, ПРОФИЛЬ, блоб)).rejects.toThrow(CryptoFormatError);
  });
});
