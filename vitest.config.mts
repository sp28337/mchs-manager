import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Домен — чистые функции без DOM: расчёт нормы не должен зависеть от
    // того, есть ли вокруг браузер.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
