import type { NextConfig } from "next";

/**
 * Адрес бэкенда. На сервере используется как есть; в браузер он не
 * попадает — см. `rewrites` ниже.
 */
const API_ORIGIN = process.env.API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Пакеты, которые иначе тянутся баррелем целиком
    // (`bundle-barrel-imports`).
    optimizePackageImports: ["lucide-react", "@tanstack/react-query"],
  },

  /**
   * Браузер ходит ТОЛЬКО в свой origin.
   *
   * Найдено осмотром: клиентские мутации падали с «сервер недоступен».
   * Причина не в сервере — браузер блокировал запрос как межисточниковый:
   * страница на `localhost:3100`, API на `127.0.0.1:8000`, а заголовков
   * CORS у бэкенда нет.
   *
   * Развесить CORS на бэкенде было бы худшим из двух решений: это
   * расширяет поверхность, требует списка разрешённых источников в
   * настройках и ничего не даёт, потому что в проде фронтенд и API всё
   * равно стоят за одним обратным прокси.
   *
   * Rewrite делает то же самое одним origin'ом: браузер запрашивает
   * `/api/backend/...`, Next.js проксирует на бэкенд. Межисточниковых
   * запросов нет вовсе — а значит, нет и разрешений, которые можно
   * настроить неверно.
   */
  async rewrites() {
    return [{ source: "/api/backend/:path*", destination: `${API_ORIGIN}/:path*` }];
  },
};

export default nextConfig;
