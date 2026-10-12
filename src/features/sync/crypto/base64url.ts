/**
 * base64url без выравнивающих знаков — ровно тот вид, в котором значения
 * ездят к серверу и обратно.
 *
 * Без `=` на конце, потому что знак выравнивания в JSON и в ссылке только
 * мешает; сервер разбирает так же (`decode_wrapped` в
 * `api/src/grafik_api/core/security.py`), и расхождение в одном знаке
 * стоило бы невозможности войти.
 *
 * `btoa`/`atob` вместо ручной арифметики: они есть и в браузере, и в
 * Node (а значит в тестах), и перевод через двоичную строку заметно
 * быстрее, чем побитовая сборка на JS. Строка собирается кусками по 8 КиБ:
 * `String.fromCharCode(...bytes)` на мегабайтном блобе переполняет стек
 * аргументов.
 */

import type { Bytes } from "./bytes";
import { CryptoFormatError } from "./errors";

const CHUNK = 8192;

export function toBase64Url(bytes: Bytes): string {
  let binary = "";

  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64Url(text: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) {
    throw new CryptoFormatError("значение не в base64url");
  }

  const остаток = text.length % 4;
  const выровнено =
    text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(остаток ? 4 - остаток : 0);

  let binary: string;
  try {
    binary = atob(выровнено);
  } catch {
    // Длина вида 4n+1 допустимым base64 не бывает ни при каком выравнивании.
    throw new CryptoFormatError("значение не в base64url");
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}
