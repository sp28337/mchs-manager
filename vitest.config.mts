import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Тот же `@/`, что и во всём коде.
  //
  // Без него проверка видела не то же самое, что сборка: файл с импортом
  // `@/lib/motion` собирался, но падал под vitest с «Cannot find package».
  // Ловилось это уже на CI, и правкой в тесте не лечилось — сокращение
  // стоит в ИСХОДНОМ файле, а тест лишь тянет его за собой. Псевдоним
  // берётся из `tsconfig.json` по смыслу: там он ровно такой же.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Домен — чистые функции без DOM: расчёт нормы не должен зависеть от
    // того, есть ли вокруг браузер.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
