/**
 * Замер вывода ключа: сколько человек ждёт на входе.
 *
 * Запуск: `pnpm bench:kdf`.
 *
 * Чего этот замер НЕ показывает: сколько то же самое займёт на телефоне.
 * Здесь x86 и Node, там ARM и браузер, разница в три-пять раз — и
 * решение про `kdf_v2` принимается по замеру на живом телефоне (шаг 11,
 * когда появится экран входа). Этот скрипт нужен, чтобы такой замер
 * можно было повторить одной командой и сравнить числа между собой.
 *
 * Чего ждём: вход — один прогон argon2id (`verifier` и `KEK` берутся из
 * него через HKDF, см. раздел 2.1 контракта), регистрация — два прогона,
 * второй на ключ восстановления.
 */

import { argon2id } from "hash-wasm";

/** Те же наборы, что обсуждаются в контракте. */
const ВАРИАНТЫ = [
  { имя: "kdf_v1 (боевой)", memorySize: 65536, iterations: 3 },
  { имя: "kdf_v2 (запасной)", memorySize: 32768, iterations: 3 },
  { имя: "серверный хэш verifier", memorySize: 19456, iterations: 2 },
];

const ПОВТОРОВ = 5;
const salt = new Uint8Array(16).fill(7);

console.log(`Узел: ${process.version}, ${process.arch}. По ${ПОВТОРОВ} прогонов на вариант.\n`);

for (const вариант of ВАРИАНТЫ) {
  const замеры = [];

  for (let i = 0; i < ПОВТОРОВ; i += 1) {
    const начало = performance.now();
    await argon2id({
      password: "пароль для замера",
      salt,
      parallelism: 1,
      iterations: вариант.iterations,
      memorySize: вариант.memorySize,
      hashLength: 32,
      outputType: "binary",
    });
    замеры.push(performance.now() - начало);
  }

  замеры.sort((a, b) => a - b);
  const середина = замеры[Math.floor(замеры.length / 2)];

  console.log(
    `${вариант.имя.padEnd(24)} ${(вариант.memorySize / 1024).toFixed(0).padStart(3)} МиБ ` +
      `× ${вариант.iterations}: ${середина.toFixed(0)} мс на прогон, ` +
      `вход ≈ ${середина.toFixed(0)} мс, регистрация ≈ ${(середина * 2).toFixed(0)} мс`,
  );
}

console.log(
  "\nНа недорогом телефоне умножить на 3–5. Больше двух секунд на входе —\n" +
    "повод заводить kdf_v2 (раздел 2.1 контракта).",
);
