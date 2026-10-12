import { writeFileSync } from "node:fs";

import { it } from "vitest";

import { createAccount, encryptItem } from "./account";
import { derivePasswordKeys, deriveSalt, KDF_V1, normalizeEmail } from "./kdf";
import { formatRecoveryKey, recoveryKeyBytes } from "./recovery";

/**
 * Генератор векторов крипто-контракта. В обычном прогоне ПРОПУСКАЕТСЯ.
 *
 * ```
 * GRAFIK_WRITE_VECTORS=1 pnpm vitest run src/features/sync/crypto/vectors.gen.test.ts
 * ```
 *
 * Векторы (`docs/crypto-vectors.json`) — это обещание: аккаунт,
 * заведённый сегодня, открывается кодом, собранным через год. Поэтому
 * перезаписывать их можно только нарочно и только вместе с новой версией
 * параметров (`kdf_v2`), добавляя случаи, а не правя старые. Если бы этот
 * файл работал в обычном прогоне, он бы молча подгонял ожидания под любую
 * правку — то есть ровно отменял бы смысл проверки.
 *
 * Проверяют векторы два независимых набора реализаций: `contract.test.ts`
 * здесь и `api/tests/test_crypto_contract.py` на сервере.
 */
const ПИШЕМ = process.env.GRAFIK_WRITE_VECTORS === "1";

const СЛУЧАИ = [
  {
    email: "petrov@example.com",
    password: "pravilnyj-parol-7",
    item: { kind: "profile" as const, id: "6f1e0000-0000-0000-0000-0000000000a1" },
    body: { name: "Петров И. С.", hours: 172.5, vacations: [] },
  },
  {
    // Адрес с пробелами и заглавными буквами — проверка нормализации;
    // пароль с кириллицей и пробелом — проверка UTF-8 на обеих сторонах.
    email: "  Петров@Example.COM ",
    password: "мой длинный пароль 42",
    item: { kind: "index" as const, id: "index" },
    body: { folders: [], entries: [] },
  },
];

const hex = (bytes: Uint8Array) =>
  [...bytes].map((байт) => байт.toString(16).padStart(2, "0")).join("");

it.skipIf(!ПИШЕМ)(
  "выписать векторы заново",
  async () => {
    const cases = [];

    for (const случай of СЛУЧАИ) {
      const аккаунт = await createAccount(случай.email, случай.password, KDF_V1);
      const ref = { kind: случай.item.kind, itemId: случай.item.id };
      const конверт = {
        fmt: 1,
        kind: случай.item.kind,
        id: случай.item.id,
        updatedAt: "2026-10-11T07:21:03.512Z",
        body: случай.body,
      };

      cases.push({
        email: случай.email,
        email_norm: normalizeEmail(случай.email),
        password: случай.password,
        salt_master: hex(await deriveSalt("grafik13/master/v1|", случай.email)),
        salt_rec: hex(await deriveSalt("grafik13/rec/v1|", случай.email)),
        verifier: (await derivePasswordKeys(случай.email, случай.password, KDF_V1)).verifier,
        recovery_key: аккаунт.recoveryKey,
        recovery_key_printed: formatRecoveryKey(аккаунт.recoveryKey),
        recovery_key_bytes: hex(recoveryKeyBytes(аккаунт.recoveryKey)),
        wrapped_dek_pwd: аккаунт.wrapped_dek_pwd,
        wrapped_dek_rec: аккаунт.wrapped_dek_rec,
        item: {
          kind: случай.item.kind,
          id: случай.item.id,
          plaintext: конверт,
          blob: await encryptItem(аккаунт.dataKey, ref, конверт),
        },
      });
    }

    writeFileSync(
      "docs/crypto-vectors.json",
      `${JSON.stringify({ kdf: KDF_V1, cases }, null, 2)}\n`,
      "utf-8",
    );
  },
  60_000,
);
