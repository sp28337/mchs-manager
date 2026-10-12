import { describe, expect, it } from "vitest";

import { fromBase64Url } from "./base64url";
import { createDataKey, unwrapDataKey, wrapDataKey } from "./dek";
import { CHEAP_KDF, ПАРОЛЬ } from "./fixtures";
import { derivePasswordKeys, deriveRecoveryKey, deriveSalt, normalizeEmail } from "./kdf";
import { formatRecoveryKey, generateRecoveryKey } from "./recovery";

/**
 * Вывод ключей — то место, где расхождение с сервером стоит входа.
 *
 * Нормализация адреса обязана совпадать с серверной (`normalize_email`),
 * иначе человек, набравший свой адрес с заглавной буквы, не войдёт по
 * своему же паролю: соли выводятся из адреса, а значит и ключи.
 */
describe("вывод ключей из пароля", () => {
  it("адрес приводится так же, как на сервере", () => {
    expect(normalizeEmail("  ПеТров@Example.COM ")).toBe("петров@example.com");
    expect(normalizeEmail("ПЕТРОВ@EXAMPLE.COM")).toBe("петров@example.com");
  });

  it("соль детерминирована, по 16 байт, и у каждой приставки своя", async () => {
    const master = await deriveSalt("grafik13/master/v1|", "петров@example.com");
    const recovery = await deriveSalt("grafik13/rec/v1|", "петров@example.com");

    expect(master).toHaveLength(16);
    expect([...master]).toEqual([...(await deriveSalt("grafik13/master/v1|", "Петров@Example.com"))]);
    expect([...master]).not.toEqual([...recovery]);
  });

  it("у разных людей соли разные", async () => {
    const первая = await deriveSalt("grafik13/master/v1|", "петров@example.com");
    const вторая = await deriveSalt("grafik13/master/v1|", "сидоров@example.com");

    expect([...первая]).not.toEqual([...вторая]);
  });

  it("verifier — 32 байта в base64url", async () => {
    const { verifier } = await derivePasswordKeys("петров@example.com", ПАРОЛЬ, CHEAP_KDF);

    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(verifier)).toHaveLength(32);
    // Схема сервера требует не меньше 32 знаков (`Verifier` в
    // `schemas/auth.py`) — 32 байта дают 43.
    expect(verifier.length).toBeGreaterThanOrEqual(32);
  });

  it("тот же пароль и адрес дают тот же verifier", async () => {
    const первый = await derivePasswordKeys("петров@example.com", ПАРОЛЬ, CHEAP_KDF);
    const второй = await derivePasswordKeys(" Петров@Example.COM ", ПАРОЛЬ, CHEAP_KDF);

    expect(второй.verifier).toBe(первый.verifier);
  });

  it("другой адрес при том же пароле — другой verifier", async () => {
    const первый = await derivePasswordKeys("петров@example.com", ПАРОЛЬ, CHEAP_KDF);
    const второй = await derivePasswordKeys("сидоров@example.com", ПАРОЛЬ, CHEAP_KDF);

    expect(второй.verifier).not.toBe(первый.verifier);
  });

  it("ключ обёртки не выдаётся наружу байтами", async () => {
    const { wrappingKey } = await derivePasswordKeys("петров@example.com", ПАРОЛЬ, CHEAP_KDF);

    expect(wrappingKey.extractable).toBe(false);
    expect(wrappingKey.usages).toEqual(["wrapKey", "unwrapKey"]);
    await expect(crypto.subtle.exportKey("raw", wrappingKey)).rejects.toThrow();
  });

  it("verifier и ключ обёртки — разные величины из одного прогона", async () => {
    // Из `verifier` (а он единственное, что уходит на сервер) ключ
    // обёртки не выводится: метки HKDF у них разные. Проверяется это
    // так: обёртка, сделанная ключом обёртки, не разворачивается
    // ключом, собранным из байтов verifier.
    const { verifier, wrappingKey } = await derivePasswordKeys(
      "петров@example.com",
      ПАРОЛЬ,
      CHEAP_KDF,
    );
    const обёртка = await wrapDataKey(await createDataKey(), wrappingKey, "password");
    const изVerifier = await crypto.subtle.importKey(
      "raw",
      fromBase64Url(verifier),
      "AES-GCM",
      false,
      ["wrapKey", "unwrapKey"],
    );

    await expect(unwrapDataKey(обёртка, изVerifier, "password")).rejects.toThrow();
  });
});

describe("вывод ключа из ключа восстановления", () => {
  it("печатный вид, канонический и строчный дают один ключ", async () => {
    const ключ = generateRecoveryKey();
    const адрес = "петров@example.com";
    const dataKey = await createDataKey();

    const обёртка = await wrapDataKey(
      dataKey,
      await deriveRecoveryKey(адрес, ключ, CHEAP_KDF),
      "recovery",
    );

    for (const вариант of [formatRecoveryKey(ключ), formatRecoveryKey(ключ).toLowerCase()]) {
      const kek = await deriveRecoveryKey(адрес, вариант, CHEAP_KDF);

      await expect(unwrapDataKey(обёртка, kek, "recovery")).resolves.toBeDefined();
    }
  });

  it("ключ восстановления с опечаткой отвергается до вывода", async () => {
    // Проверка записи — в разборе ключа, а не после неудачной
    // расшифровки: человеку надо сказать «переписано с ошибкой», а не
    // «не тот ключ».
    const ключ = generateRecoveryKey();
    const знак = ключ[3] === "0" ? "1" : "0";
    const сОпечаткой = `${ключ.slice(0, 3)}${знак}${ключ.slice(4)}`;

    await expect(
      deriveRecoveryKey("петров@example.com", сОпечаткой, CHEAP_KDF),
    ).rejects.toThrow(/с ошибкой/);
  });
});
