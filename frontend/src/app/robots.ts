import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * Что индексировать.
 *
 * Калькулятор закрыт: это форма без единого слова о том, зачем её
 * заполнять, и человек, попавший туда из выдачи, не поймёт, куда пришёл.
 * Объяснение живёт на посадочной странице — её и надо находить.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/calculator" },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
