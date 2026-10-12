/**
 * Ключ данных и его обёртки.
 *
 * Ключ данных (DEK) один на аккаунт, им зашифрованы все блобы. Пароль
 * шифрует не данные, а этот ключ, — поэтому смена пароля стоит
 * перешифровки тридцати двух байт, а не всего года смен (раздел 2.3
 * контракта).
 *
 * --- Байтов ключа в нашем коде нет вовсе ----------------------------------
 *
 * Ключ существует как дескриптор WebCrypto (`CryptoKey`), а упаковка и
 * распаковка делаются `wrapKey`/`unwrapKey` — то есть целиком внутри
 * браузера. Наш код не видит байты ключа данных ни на одном шаге: ни при
 * заведении, ни при входе, ни при смене пароля. Прочитать их нельзя и
 * случайно — для этого пришлось бы позвать `exportKey`, а его здесь нет.
 *
 * Разворачиваем мы ключ **неизвлекаемым** (`extractable: false`): такой
 * браузер не отдаст наружу даже по прямой просьбе, и переупаковать его
 * тоже нельзя. Для смены пароля извлекаемая копия всё-таки нужна —
 * `wrapKey` отказывается упаковывать неизвлекаемый ключ, — и она
 * заводится ровно внутри `unwrapForRewrap`, живёт несколько строк и
 * наружу не возвращается. Смена пароля и так требует ввести пароль, то
 * есть этот путь человек открывает сам.
 *
 * --- Зачем у обёртки AAD --------------------------------------------------
 *
 * Обёрток две — паролем и ключом восстановления, — и в AAD сказано, какая
 * это. Подложить человеку обёртку ключом восстановления на место обёртки
 * паролем не выйдет: проверка целостности не пройдёт. Без AAD такая
 * подмена прошла бы незамеченной.
 */

import { fromBase64Url, toBase64Url } from "./base64url";
import { concat, utf8 } from "./bytes";
import { CryptoFormatError, CryptoKeyMismatchError } from "./errors";
import type { WrappingKey } from "./kdf";

/** Чем упакован ключ данных. Названия — те же, что у сервера. */
export type WrapKind = "password" | "recovery";

/**
 * Ключ данных: дескриптор, а не байты.
 *
 * Обёртка-объект, а не просто `CryptoKey`, чтобы ключ данных нельзя было
 * перепутать с ключом обёртки: у них разные применения, а тип один.
 */
export interface DataKey {
  readonly handle: CryptoKey;
}

const AAD: Record<WrapKind, string> = {
  password: "grafik13/wrap/v1|pwd",
  recovery: "grafik13/wrap/v1|rec",
};

const NONCE_BYTES = 12;
/** nonce + 32 байта ключа + 16 байт признака целостности. */
const WRAPPED_BYTES = NONCE_BYTES + 32 + 16;


const AES = { name: "AES-GCM", length: 256 } as const;

/** Новый ключ данных: 32 случайных байта, которые браузер не отдаёт. */
export async function createDataKey(): Promise<DataKey> {
  // `extractable: true` здесь обязателен: без него `wrapKey` откажется
  // упаковывать ключ, а упаковать его надо сразу двумя обёртками. Сразу
  // после этого ключ разворачивается заново, уже неизвлекаемым, — им и
  // работают (см. `account.ts`).
  return { handle: await crypto.subtle.generateKey(AES, true, ["encrypt", "decrypt"]) };
}

/** Упаковать ключ данных: `base64url(nonce ‖ шифротекст ‖ признак)`. */
export async function wrapDataKey(
  dataKey: DataKey,
  wrappingKey: WrappingKey,
  kind: WrapKind,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const wrapped = await crypto.subtle.wrapKey("raw", dataKey.handle, wrappingKey, {
    name: "AES-GCM",
    iv: nonce,
    additionalData: utf8(AAD[kind]),
  });

  return toBase64Url(concat(nonce, new Uint8Array(wrapped)));
}

/** Развернуть ключ данных для работы: дескриптор, который не вынуть. */
export async function unwrapDataKey(
  wrapped: string,
  wrappingKey: WrappingKey,
  kind: WrapKind,
): Promise<DataKey> {
  return unwrap(wrapped, wrappingKey, kind, false);
}

/**
 * Развернуть ключ данных, чтобы переупаковать его новым паролем.
 *
 * Отдельная функция с говорящим названием, а не флаг у предыдущей: это
 * единственное место, где ключ данных становится извлекаемым, и такое
 * место должно быть видно в списке вызовов.
 */
export async function unwrapForRewrap(
  wrapped: string,
  wrappingKey: WrappingKey,
  kind: WrapKind,
): Promise<DataKey> {
  return unwrap(wrapped, wrappingKey, kind, true);
}

async function unwrap(
  wrapped: string,
  wrappingKey: WrappingKey,
  kind: WrapKind,
  extractable: boolean,
): Promise<DataKey> {
  const bytes = fromBase64Url(wrapped);

  if (bytes.length !== WRAPPED_BYTES) {
    throw new CryptoFormatError(`обёртка ключа должна быть ${WRAPPED_BYTES} байт, а не ${bytes.length}`);
  }

  try {
    return {
      handle: await crypto.subtle.unwrapKey(
        "raw",
        bytes.subarray(NONCE_BYTES),
        wrappingKey,
        {
          name: "AES-GCM",
          iv: bytes.subarray(0, NONCE_BYTES),
          additionalData: utf8(AAD[kind]),
        },
        AES,
        extractable,
        ["encrypt", "decrypt"],
      ),
    };
  } catch {
    // Не тот пароль, чужая обёртка, подменённые байты — для AES-GCM это
    // один и тот же случай: проверка целостности не прошла.
    throw new CryptoKeyMismatchError();
  }
}
