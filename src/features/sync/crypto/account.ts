/**
 * Что делает браузер при регистрации, входе, смене пароля и восстановлении.
 *
 * Здесь собраны те самые четыре случая из раздела 2.6 контракта — по
 * функции на каждый. Экрану (шаг 11) остаётся спросить пароль и отправить
 * то, что вернулось: решать, в каком порядке что шифровать, он не должен.
 *
 * Ни одна из этих функций не ходит в сеть. Это сознательно: сетевой слой
 * проверяется моками и ошибками HTTP, криптография — векторами, и мешать
 * их в одном месте значит проверять каждую половину через другую.
 *
 * --- Что уходит на сервер и что не уходит никогда -------------------------
 *
 * Уходит: `verifier` (производная пароля), обёртки ключа данных,
 * зашифрованные блобы. Не уходит никогда: пароль, ключ восстановления,
 * ключ данных и его байты, открытый текст профиля. Возвращаемые значения
 * этого модуля устроены так, чтобы случайно отправить лишнее было нечем:
 * в них лежит либо то, что предназначено серверу, либо `DataKey` —
 * дескриптор, который невозможно сериализовать.
 */

import { encryptJson } from "./blob";
import {
  createDataKey,
  type DataKey,
  unwrapDataKey,
  unwrapForRewrap,
  wrapDataKey,
} from "./dek";
import { derivePasswordKeys, deriveRecoveryKey, type KdfParams } from "./kdf";
import { generateRecoveryKey } from "./recovery";

/** Поля `POST /auth/register`, которые считает браузер, и ключ для работы. */
export interface NewAccount {
  readonly verifier: string;
  readonly wrapped_dek_pwd: string;
  readonly wrapped_dek_rec: string;
  readonly kdf_version: string;
  /** Показать один раз и предложить напечатать. Больше нигде не хранится. */
  readonly recoveryKey: string;
  readonly dataKey: DataKey;
}

/** Что нужно для работы после входа. */
export interface Unlocked {
  readonly verifier: string;
  readonly dataKey: DataKey;
}

/** Поля `POST /account/password`. */
export interface PasswordChange {
  readonly current_verifier: string;
  readonly verifier: string;
  readonly wrapped_dek_pwd: string;
  readonly wrapped_dek_rec?: string;
  readonly kdf_version: string;
}

/** Поля `POST /auth/recover/finish`. */
export interface RecoveredAccess {
  readonly verifier: string;
  readonly wrapped_dek_pwd: string;
  readonly kdf_version: string;
  readonly dataKey: DataKey;
}

/**
 * Новый аккаунт: ключ данных, две обёртки, ключ восстановления.
 *
 * Обёртка паролем тут же разворачивается обратно — и это не
 * перестраховка, а две вещи сразу. Во-первых, проверка: отправить на
 * сервер обёртку, которая не разворачивается, значит узнать об этом при
 * следующем входе, когда человек уже внёс месяц смен. Во-вторых, именно
 * так получается неизвлекаемый дескриптор для работы: тот, что отдал
 * `createDataKey`, извлекаем — иначе его не упаковать.
 */
export async function createAccount(
  email: string,
  password: string,
  params: KdfParams,
): Promise<NewAccount> {
  const recoveryKey = generateRecoveryKey();
  const [{ verifier, wrappingKey }, recoveryWrappingKey] = await Promise.all([
    derivePasswordKeys(email, password, params),
    deriveRecoveryKey(email, recoveryKey, params),
  ]);

  const fresh = await createDataKey();
  const [wrappedPwd, wrappedRec] = await Promise.all([
    wrapDataKey(fresh, wrappingKey, "password"),
    wrapDataKey(fresh, recoveryWrappingKey, "recovery"),
  ]);

  return {
    verifier,
    wrapped_dek_pwd: wrappedPwd,
    wrapped_dek_rec: wrappedRec,
    kdf_version: params.kdf_version,
    recoveryKey,
    dataKey: await unwrapDataKey(wrappedPwd, wrappingKey, "password"),
  };
}

/** Вход: `verifier` для сервера и ключ данных для работы. */
export async function unlockWithPassword(
  email: string,
  password: string,
  wrappedDekPwd: string,
  params: KdfParams,
): Promise<Unlocked> {
  const { verifier, wrappingKey } = await derivePasswordKeys(email, password, params);

  return { verifier, dataKey: await unwrapDataKey(wrappedDekPwd, wrappingKey, "password") };
}

/**
 * Смена пароля: перешифровывается обёртка, а не данные.
 *
 * Старый пароль нужен дважды: им разворачивается ключ данных и из него
 * берётся `current_verifier`, который сервер спрашивает перед опасным
 * действием. Новый ключ восстановления — по желанию человека; не
 * попросил, значит старая обёртка ключом восстановления остаётся годной,
 * ключ данных-то прежний.
 */
export async function changePassword(
  email: string,
  options: {
    readonly currentPassword: string;
    readonly newPassword: string;
    readonly wrappedDekPwd: string;
    readonly newRecoveryKey?: string;
  },
  params: KdfParams,
): Promise<PasswordChange> {
  const [current, next] = await Promise.all([
    derivePasswordKeys(email, options.currentPassword, params),
    derivePasswordKeys(email, options.newPassword, params),
  ]);

  const dataKey = await unwrapForRewrap(options.wrappedDekPwd, current.wrappingKey, "password");

  return {
    current_verifier: current.verifier,
    verifier: next.verifier,
    wrapped_dek_pwd: await wrapDataKey(dataKey, next.wrappingKey, "password"),
    ...(options.newRecoveryKey === undefined
      ? {}
      : {
          wrapped_dek_rec: await wrapDataKey(
            dataKey,
            await deriveRecoveryKey(email, options.newRecoveryKey, params),
            "recovery",
          ),
        }),
    kdf_version: params.kdf_version,
  };
}

/**
 * Восстановление доступа: ключ восстановления разворачивает ключ данных,
 * новый пароль его упаковывает заново.
 *
 * Ключ восстановления на сервер не уходит — сервер проверяет только
 * ссылку из письма. Обёртка ключом восстановления остаётся прежней: тот
 * же ключ данных, тот же ключ восстановления. Если человек заодно хочет
 * новый ключ восстановления, это отдельное действие — смена пароля с
 * `newRecoveryKey`, уже после входа.
 */
export async function finishRecovery(
  email: string,
  options: {
    readonly recoveryKey: string;
    readonly newPassword: string;
    readonly wrappedDekRec: string;
  },
  params: KdfParams,
): Promise<RecoveredAccess> {
  const [recoveryWrappingKey, { verifier, wrappingKey }] = await Promise.all([
    deriveRecoveryKey(email, options.recoveryKey, params),
    derivePasswordKeys(email, options.newPassword, params),
  ]);

  const dataKey = await unwrapForRewrap(options.wrappedDekRec, recoveryWrappingKey, "recovery");
  const wrappedPwd = await wrapDataKey(dataKey, wrappingKey, "password");

  return {
    verifier,
    wrapped_dek_pwd: wrappedPwd,
    kdf_version: params.kdf_version,
    dataKey: await unwrapDataKey(wrappedPwd, wrappingKey, "password"),
  };
}

/**
 * Зашифровать элемент перед отправкой — ровно то, что делает слой
 * синхронизации (шаг 11). Здесь это одна строка, но она показывает, что
 * криптомодуль отдаёт готовое к отправке значение, а не байты наружу.
 */
export { encryptJson as encryptItem };
