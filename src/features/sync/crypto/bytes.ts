/**
 * Байты: один тип и две склейки, чтобы не повторять их в каждом модуле.
 *
 * --- Почему тип, а не просто `Uint8Array` ---------------------------------
 *
 * TypeScript 6 различает, над каким буфером живёт типизированный массив, а
 * WebCrypto принимает только обычный `ArrayBuffer`: `SharedArrayBuffer`
 * ему не годится, и в типах это сказано прямо. Поэтому всё, что идёт в
 * `crypto.subtle`, объявляется как `Bytes`.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

/**
 * Текст в UTF-8.
 *
 * Уточнение типа здесь не обман: `TextEncoder` всегда выделяет обычный
 * буфер, а описание в `lib.dom` просто шире правды.
 */
export function utf8(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

/** Склеить куски в один массив — конверт собирается из двух-трёх частей. */
export function concat(...parts: readonly Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((всего, часть) => всего + часть.length, 0));
  let смещение = 0;

  for (const часть of parts) {
    out.set(часть, смещение);
    смещение += часть.length;
  }

  return out;
}
