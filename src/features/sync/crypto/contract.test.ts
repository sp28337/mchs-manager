import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { decryptJson } from "./blob";
import { fromBase64Url } from "./base64url";
import { unwrapDataKey } from "./dek";
import { derivePasswordKeys, deriveRecoveryKey, deriveSalt, KDF_V1, normalizeEmail } from "./kdf";
import { formatRecoveryKey, parseRecoveryKey, recoveryKeyBytes } from "./recovery";

/**
 * Векторы крипто-контракта: те же байты через год и через пять лет.
 *
 * `docs/crypto-vectors.json` — выписанные значения на боевых параметрах
 * `kdf_v1`. Проверяют они не правильность алгоритмов (её не проверить
 * тестом вовсе), а **неизменность**: аккаунт, заведённый сегодня,
 * открывается кодом, собранным завтра. Поменяй кто-нибудь приставку
 * соли, метку HKDF, порядок байтов в конверте или алфавит ключа
 * восстановления — эти тесты упадут, и упадут до выкладки, а не на
 * человеке, который не может войти.
 *
 * Тот же файл читают тесты сервера (`api/tests/test_crypto_contract.py`):
 * там argon2id считает argon2-cffi, а HKDF — hmac из стандартной
 * библиотеки. Сходятся два независимых набора реализаций — значит
 * параметры и кодировки описаны однозначно, а не «как получилось у
 * hash-wasm».
 *
 * Менять этот файл можно только вместе с новой версией параметров
 * (`kdf_v2`), добавляя случаи, а не правя старые.
 */
interface Случай {
  readonly email: string;
  readonly email_norm: string;
  readonly password: string;
  readonly salt_master: string;
  readonly salt_rec: string;
  readonly verifier: string;
  readonly recovery_key: string;
  readonly recovery_key_printed: string;
  readonly recovery_key_bytes: string;
  readonly wrapped_dek_pwd: string;
  readonly wrapped_dek_rec: string;
  readonly item: {
    readonly kind: "index" | "profile";
    readonly id: string;
    readonly plaintext: unknown;
    readonly blob: string;
  };
}

const векторы = JSON.parse(readFileSync("docs/crypto-vectors.json", "utf-8")) as {
  kdf: typeof KDF_V1;
  cases: readonly Случай[];
};

const hex = (bytes: Uint8Array) =>
  [...bytes].map((байт) => байт.toString(16).padStart(2, "0")).join("");

describe("векторы крипто-контракта", () => {
  it("записаны на тех параметрах, которые предлагает сервер", () => {
    expect(векторы.kdf).toEqual(KDF_V1);
    expect(векторы.cases.length).toBeGreaterThan(1);
  });

  for (const [номер, случай] of векторы.cases.entries()) {
    describe(`случай ${номер + 1}: ${случай.email_norm}`, () => {
      it("адрес приводится к тому же виду", () => {
        expect(normalizeEmail(случай.email)).toBe(случай.email_norm);
      });

      it("соли те же", async () => {
        expect(hex(await deriveSalt("grafik13/master/v1|", случай.email))).toBe(
          случай.salt_master,
        );
        expect(hex(await deriveSalt("grafik13/rec/v1|", случай.email))).toBe(случай.salt_rec);
      });

      it("verifier тот же", async () => {
        const { verifier } = await derivePasswordKeys(
          случай.email,
          случай.password,
          векторы.kdf,
        );

        expect(verifier).toBe(случай.verifier);
      });

      it("ключ восстановления разбирается и даёт те же байты", () => {
        expect(parseRecoveryKey(случай.recovery_key_printed)).toBe(случай.recovery_key);
        expect(formatRecoveryKey(случай.recovery_key)).toBe(случай.recovery_key_printed);
        expect(hex(recoveryKeyBytes(случай.recovery_key))).toBe(случай.recovery_key_bytes);
      });

      it("пароль открывает блоб через обёртку", async () => {
        const { wrappingKey } = await derivePasswordKeys(
          случай.email,
          случай.password,
          векторы.kdf,
        );
        const dataKey = await unwrapDataKey(случай.wrapped_dek_pwd, wrappingKey, "password");

        expect(
          await decryptJson(
            dataKey,
            { kind: случай.item.kind, itemId: случай.item.id },
            случай.item.blob,
          ),
        ).toEqual(случай.item.plaintext);
      });

      it("ключ восстановления открывает тот же блоб", async () => {
        const kekRec = await deriveRecoveryKey(
          случай.email,
          случай.recovery_key,
          векторы.kdf,
        );
        const dataKey = await unwrapDataKey(случай.wrapped_dek_rec, kekRec, "recovery");

        expect(
          await decryptJson(
            dataKey,
            { kind: случай.item.kind, itemId: случай.item.id },
            случай.item.blob,
          ),
        ).toEqual(случай.item.plaintext);
      });

      it("значения укладываются в схемы сервера", () => {
        // `Verifier` и `WrappedKey` в `api/src/grafik_api/schemas/auth.py`:
        // base64url, не короче 32 знаков, обёртка — ровно 60 байт.
        expect(случай.verifier).toMatch(/^[A-Za-z0-9_-]{32,}$/);
        expect(случай.wrapped_dek_pwd).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(fromBase64Url(случай.wrapped_dek_pwd)).toHaveLength(60);
        expect(fromBase64Url(случай.wrapped_dek_rec)).toHaveLength(60);
        expect(fromBase64Url(случай.item.blob).length).toBeLessThanOrEqual(1024 * 1024);
      });
    });
  }
});
