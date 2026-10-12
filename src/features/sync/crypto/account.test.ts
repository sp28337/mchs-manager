import { describe, expect, it } from "vitest";

import { changePassword, createAccount, finishRecovery, unlockWithPassword } from "./account";
import { decryptJson, encryptJson, INDEX_ID } from "./blob";
import { fromBase64Url } from "./base64url";
import { unwrapDataKey } from "./dek";
import { CryptoKeyMismatchError } from "./errors";
import { CHEAP_KDF, АДРЕС, ПАРОЛЬ } from "./fixtures";
import { deriveRecoveryKey } from "./kdf";
import { generateRecoveryKey, parseRecoveryKey } from "./recovery";

const ПРОФИЛЬ = { kind: "profile", itemId: "6f1e0000-0000-0000-0000-0000000000a1" } as const;
const ДАННЫЕ = { fmt: 1, body: { name: "Петров И. С.", hours: 172.5 } };
const НОВЫЙ_ПАРОЛЬ = "совсем другой пароль";

/**
 * Четыре случая из раздела 2.6 контракта — и все они о том, как человек
 * не теряет свои данные.
 *
 * Поэтому в каждом тесте проверяется не «отдала ли функция строку», а то
 * единственное, что важно: расшифровывается ли после этого действия
 * ранее записанный профиль.
 */
describe("регистрация", () => {
  it("даёт серверу verifier и две обёртки, а человеку — ключ восстановления", async () => {
    const аккаунт = await createAccount(АДРЕС, ПАРОЛЬ, CHEAP_KDF);

    expect(fromBase64Url(аккаунт.verifier)).toHaveLength(32);
    expect(fromBase64Url(аккаунт.wrapped_dek_pwd)).toHaveLength(60);
    expect(fromBase64Url(аккаунт.wrapped_dek_rec)).toHaveLength(60);
    expect(аккаунт.kdf_version).toBe(CHEAP_KDF.kdf_version);
    expect(parseRecoveryKey(аккаунт.recoveryKey)).toBe(аккаунт.recoveryKey);
    expect(аккаунт.dataKey.handle.extractable).toBe(false);
  });

  it("обёртка, которая уходит на сервер, проверена разворачиванием", async () => {
    // Отправить необратимую обёртку значило бы узнать об этом при
    // следующем входе — когда человек уже внёс месяц смен.
    const аккаунт = await createAccount(АДРЕС, ПАРОЛЬ, CHEAP_KDF);

    const вход = await unlockWithPassword(АДРЕС, ПАРОЛЬ, аккаунт.wrapped_dek_pwd, CHEAP_KDF);
    const блоб = await encryptJson(аккаунт.dataKey, ПРОФИЛЬ, ДАННЫЕ);

    expect(вход.verifier).toBe(аккаунт.verifier);
    expect(await decryptJson(вход.dataKey, ПРОФИЛЬ, блоб)).toEqual(ДАННЫЕ);
  });

  it("у двух аккаунтов разные ключи данных и разные ключи восстановления", async () => {
    const первый = await createAccount(АДРЕС, ПАРОЛЬ, CHEAP_KDF);
    const второй = await createAccount("сидоров@example.com", ПАРОЛЬ, CHEAP_KDF);
    const блоб = await encryptJson(первый.dataKey, ПРОФИЛЬ, ДАННЫЕ);

    expect(второй.recoveryKey).not.toBe(первый.recoveryKey);
    await expect(decryptJson(второй.dataKey, ПРОФИЛЬ, блоб)).rejects.toThrow(
      CryptoKeyMismatchError,
    );
  });
});

describe("вход", () => {
  it("не тот пароль — не тот ответ, и данные недоступны", async () => {
    const аккаунт = await createAccount(АДРЕС, ПАРОЛЬ, CHEAP_KDF);

    await expect(
      unlockWithPassword(АДРЕС, "подобранный пароль", аккаунт.wrapped_dek_pwd, CHEAP_KDF),
    ).rejects.toThrow(CryptoKeyMismatchError);
  });

  it("ключ восстановления открывает тот же ключ данных", async () => {
    const аккаунт = await createAccount(АДРЕС, ПАРОЛЬ, CHEAP_KDF);
    const блоб = await encryptJson(аккаунт.dataKey, ПРОФИЛЬ, ДАННЫЕ);

    const kekRec = await deriveRecoveryKey(АДРЕС, аккаунт.recoveryKey, CHEAP_KDF);
    const поКлючу = await unwrapDataKey(аккаунт.wrapped_dek_rec, kekRec, "recovery");

    expect(await decryptJson(поКлючу, ПРОФИЛЬ, блоб)).toEqual(ДАННЫЕ);
  });
});

describe("смена пароля", () => {
  it("данные остаются, старый пароль перестаёт открывать", async () => {
    const аккаунт = await createAccount(АДРЕС, ПАРОЛЬ, CHEAP_KDF);
    const блоб = await encryptJson(аккаунт.dataKey, ПРОФИЛЬ, ДАННЫЕ);

    const смена = await changePassword(
      АДРЕС,
      {
        currentPassword: ПАРОЛЬ,
        newPassword: НОВЫЙ_ПАРОЛЬ,
        wrappedDekPwd: аккаунт.wrapped_dek_pwd,
      },
      CHEAP_KDF,
    );

    expect(смена.current_verifier).toBe(аккаунт.verifier);
    expect(смена.verifier).not.toBe(аккаунт.verifier);
    expect(смена.wrapped_dek_rec).toBeUndefined();

    // Новым паролем — те же данные.
    const вход = await unlockWithPassword(АДРЕС, НОВЫЙ_ПАРОЛЬ, смена.wrapped_dek_pwd, CHEAP_KDF);
    expect(await decryptJson(вход.dataKey, ПРОФИЛЬ, блоб)).toEqual(ДАННЫЕ);

    // Старым — ничего.
    await expect(
      unlockWithPassword(АДРЕС, ПАРОЛЬ, смена.wrapped_dek_pwd, CHEAP_KDF),
    ).rejects.toThrow(CryptoKeyMismatchError);
  });

  it("не тот текущий пароль — смены не будет", async () => {
    const аккаунт = await createAccount(АДРЕС, ПАРОЛЬ, CHEAP_KDF);

    await expect(
      changePassword(
        АДРЕС,
        {
          currentPassword: "не тот",
          newPassword: НОВЫЙ_ПАРОЛЬ,
          wrappedDekPwd: аккаунт.wrapped_dek_pwd,
        },
        CHEAP_KDF,
      ),
    ).rejects.toThrow(CryptoKeyMismatchError);
  });

  it("старая обёртка ключом восстановления остаётся годной", async () => {
    // Ключ данных не менялся — значит и обёртка ключом восстановления
    // по-прежнему его открывает. Иначе смена пароля молча отнимала бы у
    // человека единственный способ вернуть доступ.
    const аккаунт = await createAccount(АДРЕС, ПАРОЛЬ, CHEAP_KDF);
    const блоб = await encryptJson(аккаунт.dataKey, ПРОФИЛЬ, ДАННЫЕ);

    await changePassword(
      АДРЕС,
      {
        currentPassword: ПАРОЛЬ,
        newPassword: НОВЫЙ_ПАРОЛЬ,
        wrappedDekPwd: аккаунт.wrapped_dek_pwd,
      },
      CHEAP_KDF,
    );

    const kekRec = await deriveRecoveryKey(АДРЕС, аккаунт.recoveryKey, CHEAP_KDF);
    const поКлючу = await unwrapDataKey(аккаунт.wrapped_dek_rec, kekRec, "recovery");

    expect(await decryptJson(поКлючу, ПРОФИЛЬ, блоб)).toEqual(ДАННЫЕ);
  });

  it("новый ключ восстановления перевыпускает вторую обёртку", async () => {
    const аккаунт = await createAccount(АДРЕС, ПАРОЛЬ, CHEAP_KDF);
    const блоб = await encryptJson(аккаунт.dataKey, ПРОФИЛЬ, ДАННЫЕ);
    const новыйКлюч = generateRecoveryKey();

    const смена = await changePassword(
      АДРЕС,
      {
        currentPassword: ПАРОЛЬ,
        newPassword: НОВЫЙ_ПАРОЛЬ,
        wrappedDekPwd: аккаунт.wrapped_dek_pwd,
        newRecoveryKey: новыйКлюч,
      },
      CHEAP_KDF,
    );

    expect(смена.wrapped_dek_rec).toBeDefined();

    const kekRec = await deriveRecoveryKey(АДРЕС, новыйКлюч, CHEAP_KDF);
    const поНовому = await unwrapDataKey(смена.wrapped_dek_rec as string, kekRec, "recovery");

    expect(await decryptJson(поНовому, ПРОФИЛЬ, блоб)).toEqual(ДАННЫЕ);
  });
});

describe("восстановление доступа", () => {
  it("ключ восстановления и новый пароль возвращают данные", async () => {
    const аккаунт = await createAccount(АДРЕС, ПАРОЛЬ, CHEAP_KDF);
    const указатель = await encryptJson(
      аккаунт.dataKey,
      { kind: "index", itemId: INDEX_ID },
      { fmt: 1, folders: [], entries: [] },
    );

    const восстановлено = await finishRecovery(
      АДРЕС,
      {
        recoveryKey: аккаунт.recoveryKey,
        newPassword: НОВЫЙ_ПАРОЛЬ,
        wrappedDekRec: аккаунт.wrapped_dek_rec,
      },
      CHEAP_KDF,
    );

    expect(
      await decryptJson(восстановлено.dataKey, { kind: "index", itemId: INDEX_ID }, указатель),
    ).toEqual({ fmt: 1, folders: [], entries: [] });

    const вход = await unlockWithPassword(
      АДРЕС,
      НОВЫЙ_ПАРОЛЬ,
      восстановлено.wrapped_dek_pwd,
      CHEAP_KDF,
    );
    expect(вход.verifier).toBe(восстановлено.verifier);
  });

  it("чужой ключ восстановления не подходит", async () => {
    const аккаунт = await createAccount(АДРЕС, ПАРОЛЬ, CHEAP_KDF);

    await expect(
      finishRecovery(
        АДРЕС,
        {
          recoveryKey: generateRecoveryKey(),
          newPassword: НОВЫЙ_ПАРОЛЬ,
          wrappedDekRec: аккаунт.wrapped_dek_rec,
        },
        CHEAP_KDF,
      ),
    ).rejects.toThrow(CryptoKeyMismatchError);
  });
});
