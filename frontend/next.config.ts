import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Тип ответа бэкенда — RFC 7807 `application/problem+json`, и Next.js
  // ничего с ним не делает: разбирает его `lib/api-client`.
  reactStrictMode: true,
  experimental: {
    // Пакеты, которые иначе тянутся баррелем целиком
    // (`bundle-barrel-imports`).
    optimizePackageImports: ["lucide-react", "@tanstack/react-query"],
  },
};

export default nextConfig;
