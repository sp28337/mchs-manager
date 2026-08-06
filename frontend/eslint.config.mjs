import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

/* `next-env.d.ts` и сгенерированные типы не правятся руками, поэтому и
   не проверяются: замечание, которое нельзя исправить, — шум, а шум
   учит игнорировать вывод линтера целиком. */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "src/lib/api-client/schema.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
