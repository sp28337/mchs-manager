import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Плоский конфиг ESLint.
 *
 * С `eslint-config-next` 16 пресеты экспортируются готовыми плоскими
 * конфигами, поэтому обёртка `FlatCompat` больше не нужна — и не работает:
 * старый `compat.extends("next/core-web-vitals")` падал при загрузке.
 */
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    // Результат статического экспорта: собранные и минифицированные
    // файлы, которые никто не правит руками.
    "out/**",
    "node_modules/**",
    "next-env.d.ts",
  ]),
]);
