/**
 * Шифрование элементов: профиль и указатель библиотеки.
 *
 * ```
 * blob = nonce(12) ‖ AES-256-GCM(DEK, открытый текст, AAD) ‖ признак(16)
 * AAD  = "grafik13/blob/v1|" + kind + "|" + item_id
 * ```
 *
 * Раздел 2.5 контракта. Сервер видит эти байты, их размер и ревизию — и
 * больше ничего: ключа у него нет.
 *
 * --- Зачем в AAD вид и опознание элемента --------------------------------
 *
 * AAD привязывает кусок к его месту. Без него сервер (или тот, кто до
 * него добрался) мог бы положить блоб профиля на место указателя
 * библиотеки, подсунуть вместо нового профиля прошлогодний или
 * переложить блоб одного человека другому — и клиент расшифровал бы
 * подмену, не заметив её. С AAD расшифровка такой подмены не проходит
 * проверку целостности.
 *
 * --- Nonce свежий на каждую запись ----------------------------------------
 *
 * Повтор nonce при одном и том же ключе ломает GCM:два сообщения с общим
 * nonce выдают ключ потока и дают подделывать признак целостности.
 * Поэтому nonce берётся из `crypto.getRandomValues` каждый раз, а не
 * ведётся счётчиком: счётчик пришлось бы хранить, синхронизировать между
 * устройствами и не сбивать при восстановлении из копии.
 */

import { fromBase64Url, toBase64Url } from "./base64url";
import { type Bytes, concat, utf8 } from "./bytes";
import { CryptoFormatError, CryptoKeyMismatchError } from "./errors";
import type { DataKey } from "./dek";

/** Вид элемента. Те же два, что у сервера (`ITEM_KINDS`). */
export type ItemKind = "index" | "profile";

/** Опознание единственного указателя библиотеки — строка `index`. */
export const INDEX_ID = "index";

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

const utf8Decoder = new TextDecoder();

export interface ItemRef {
  readonly kind: ItemKind;
  readonly itemId: string;
}

/** AAD элемента — ровно то, что сказано в контракте. */
export function itemAad({ kind, itemId }: ItemRef): Bytes {
  return utf8(`grafik13/blob/v1|${kind}|${itemId}`);
}

/** Зашифровать байты элемента. Возвращает base64url — то, что едет на сервер. */
export async function encryptBlob(
  dataKey: DataKey,
  ref: ItemRef,
  plaintext: Bytes,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: itemAad(ref) },
    dataKey.handle,
    plaintext,
  );

  return toBase64Url(concat(nonce, new Uint8Array(sealed)));
}

/** Расшифровать блоб элемента. */
export async function decryptBlob(
  dataKey: DataKey,
  ref: ItemRef,
  blob: string,
): Promise<Bytes> {
  const bytes = fromBase64Url(blob);

  if (bytes.length < NONCE_BYTES + TAG_BYTES) {
    throw new CryptoFormatError("блоб короче, чем конверт AES-GCM");
  }

  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes.subarray(0, NONCE_BYTES),
        additionalData: itemAad(ref),
      },
      dataKey.handle,
      bytes.subarray(NONCE_BYTES),
    );

    return new Uint8Array(plain);
  } catch {
    throw new CryptoKeyMismatchError();
  }
}

/**
 * То же, но с конвертом в JSON.
 *
 * Разбирать расшифрованное обязан вызывающий — схемой (`storedProfileSchema`
 * и схема указателя, шаг 11). Здесь только UTF-8 и `JSON.parse`: что
 * внутри конверта, криптомодуля не касается.
 */
export async function encryptJson(
  dataKey: DataKey,
  ref: ItemRef,
  value: unknown,
): Promise<string> {
  return encryptBlob(dataKey, ref, utf8(JSON.stringify(value)));
}

export async function decryptJson(
  dataKey: DataKey,
  ref: ItemRef,
  blob: string,
): Promise<unknown> {
  const plain = await decryptBlob(dataKey, ref, blob);

  try {
    return JSON.parse(utf8Decoder.decode(plain));
  } catch {
    // Расшифровалось, но внутри не JSON. Ключ при этом верный — проверку
    // целостности мы уже прошли, — значит дело в записи, а не в пароле, и
    // путать человека словами про пароль нельзя.
    throw new CryptoFormatError("расшифрованный элемент — не JSON");
  }
}
