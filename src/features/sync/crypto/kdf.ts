/**
 * Вывод ключей из пароля: одна дорогая операция вместо двух.
 *
 * Пароль на сервер не уходит ни разу. Из него выводятся две величины:
 * `verifier` — им сервер опознаёт человека, и `KEK` — им развёрнута
 * обёртка ключа данных. Раздел 2.1 контракта.
 *
 * --- Почему argon2id считается ОДИН раз, а не два -------------------------
 *
 * Контракт в первой редакции выводил `verifier` и `KEK` двумя отдельными
 * прогонами argon2id с разными солями. Для нападающего это ничего не
 * меняет: ему достаточно подобрать пароль через любой из двух прогонов,
 * то есть цена подбора — один argon2id на попытку в обоих случаях. А вот
 * человеку это удваивало ожидание на каждом входе, и на недорогом
 * телефоне (где 64 МиБ argon2id идёт около секунды) вход упирался бы в
 * обещанные контрактом «не больше двух секунд».
 *
 * Поэтому argon2id считается один раз — он даёт `master`, — а `verifier`
 * и `KEK` получаются из него HKDF-SHA-256 с разными метками. HKDF —
 * расширение ключа, а не защита пароля: он дешёвый, и это правильно, его
 * вход уже имеет полную энтропию после argon2id. Из `verifier` (а он
 * единственное, что уходит наружу) ни `master`, ни `KEK` не выводятся:
 * метки у них разные, а HKDF для этого и сделан.
 *
 * --- Соли выводятся из адреса, а не хранятся ------------------------------
 *
 * Случайную соль пришлось бы отдавать по адресу почты до входа, то есть
 * завести оракул «такой человек у нас есть». Соль не секрет, её задача —
 * не повторяться у разных людей; адрес уникален по определению, а
 * приставка `grafik13/...` разводит наши ключи с чужими сервисами.
 * Нормализация адреса здесь обязана совпадать с серверной
 * (`normalize_email` в `services/auth.py`) — разойдись они, и человек с
 * адресом в другом регистре не войдёт по своему же паролю.
 */

import { argon2id } from "hash-wasm";
import { z } from "zod";

import { toBase64Url } from "./base64url";
import { type Bytes, utf8 } from "./bytes";
import { recoveryKeyBytes } from "./recovery";

/** Параметры argon2id: сервер присылает их до входа (`POST /auth/params`). */
export const kdfParamsSchema = z.object({
  kdf_version: z.string().min(1).max(32),
  algorithm: z.literal("argon2id"),
  memory_kib: z.number().int().positive(),
  iterations: z.number().int().positive(),
  parallelism: z.number().int().positive(),
  length: z.literal(32),
});

export type KdfParams = z.infer<typeof kdfParamsSchema>;

/**
 * Единственная пока версия — та же, что у сервера (`KDF_V1` в
 * `core/security.py`). Держится здесь для тестов и для работы без сети;
 * в бою параметры приходят от сервера, потому что у аккаунта они свои.
 */
export const KDF_V1: KdfParams = {
  kdf_version: "kdf_v1",
  algorithm: "argon2id",
  memory_kib: 65536,
  iterations: 3,
  parallelism: 1,
  length: 32,
};

const SALT_MASTER = "grafik13/master/v1|";
const SALT_RECOVERY = "grafik13/rec/v1|";

const INFO_AUTH = "grafik13/auth/v1";
const INFO_KEK = "grafik13/kek/v1";


/** Ключ, которым упаковывают и распаковывают ключ данных. */
export type WrappingKey = CryptoKey;

/** Что получается из пароля: опознание для сервера и ключ для обёртки. */
export interface PasswordKeys {
  /** base64url 32 байт — уходит на сервер. */
  readonly verifier: string;
  /** Неизвлекаемый ключ AES-GCM: им развёрнута обёртка ключа данных. */
  readonly wrappingKey: WrappingKey;
}

/**
 * Адрес почты к единому виду: NFKC, без краёв, в нижнем регистре.
 *
 * То же самое делает сервер, прежде чем искать аккаунт.
 */
export function normalizeEmail(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

/** Соль: первые 16 байт SHA-256 от приставки и нормализованного адреса. */
export async function deriveSalt(prefix: string, email: string): Promise<Bytes> {
  const digest = await crypto.subtle.digest("SHA-256", utf8(prefix + normalizeEmail(email)));

  return new Uint8Array(digest).subarray(0, 16);
}

/** `verifier` и ключ обёртки — из пароля, одним прогоном argon2id. */
export async function derivePasswordKeys(
  email: string,
  password: string,
  params: KdfParams,
): Promise<PasswordKeys> {
  const master = await runArgon2(password, await deriveSalt(SALT_MASTER, email), params);
  // Байты `master` дальше не нужны: HKDF работает с дескриптором ключа.
  const masterKey = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveBits"]);

  const [verifier, kek] = await Promise.all([
    expand(masterKey, INFO_AUTH),
    expand(masterKey, INFO_KEK),
  ]);

  return {
    verifier: toBase64Url(verifier),
    wrappingKey: await importWrappingKey(kek),
  };
}

/**
 * Ключ обёртки из ключа восстановления.
 *
 * Здесь HKDF не нужен: из ключа восстановления выводится одна величина, а
 * опознаваться им перед сервером нечем — после восстановления человек
 * задаёт новый пароль, и новый `verifier` берётся уже из него.
 *
 * Выводится ключ из **байтов**, а не из печатной записи: ключ
 * восстановления — это 128 бит, а тире, регистр и контрольный знак —
 * способ их переписать. Поменяй мы однажды печатный вид (другая
 * группировка, другой контрольный знак), обёртки, выданные раньше,
 * продолжат разворачиваться. Заодно сюда можно передавать то, что человек
 * ввёл, как есть: разбор и проверка внутри.
 */
export async function deriveRecoveryKey(
  email: string,
  recoveryKey: string,
  params: KdfParams,
): Promise<WrappingKey> {
  const kek = await runArgon2(
    recoveryKeyBytes(recoveryKey),
    await deriveSalt(SALT_RECOVERY, email),
    params,
  );

  return importWrappingKey(kek);
}

async function runArgon2(
  secret: string | Uint8Array,
  salt: Bytes,
  params: KdfParams,
): Promise<Bytes> {
  const out = await argon2id({
    password: secret,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory_kib,
    hashLength: params.length,
    outputType: "binary",
  });

  // hash-wasm отдаёт массив с общим типом буфера, а WebCrypto нужен
  // обычный. Копия тридцати двух байт честнее утверждения `as`, и
  // стоит она ничего.
  return Uint8Array.from(out as Uint8Array);
}

/**
 * HKDF с пустой солью: вход уже дорого посолен argon2id, и вторая соль
 * добавила бы к стойкости ноль, а к числу величин, которые надо где-то
 * хранить, — одну. Пустая соль у HKDF означает извлечение нулевым ключом
 * (RFC 5869) — это определённое поведение, а не отсутствие шага, и
 * воспроизводится на любом языке.
 */
async function expand(masterKey: CryptoKey, info: string): Promise<Bytes> {
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(info) },
    masterKey,
    256,
  );

  return new Uint8Array(bits);
}

/**
 * Ключ заводится неизвлекаемым и только для упаковки: прочитать его байты
 * нельзя даже нашему коду, а шифровать им что-либо, кроме ключа данных,
 * незачем.
 */
async function importWrappingKey(bytes: Bytes): Promise<WrappingKey> {
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["wrapKey", "unwrapKey"]);
}
