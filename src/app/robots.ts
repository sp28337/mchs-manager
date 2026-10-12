import type { MetadataRoute } from "next";

/* Файл собирается один раз на сборке: сайт выгружается в статику, и
   вычислять его на каждый запрос негде и незачем. */
export const dynamic = "force-static";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * Что индексировать.
 *
 * Калькулятор закрыт: это форма без единого слова о том, зачем её
 * заполнять, и человек, попавший туда из выдачи, не поймёт, куда пришёл.
 * Объяснение живёт на посадочной странице — её и надо находить.
 *
 * Страницы учётной записи закрыты по той же причине и ещё по одной: они
 * личные, и в выдаче им делать нечего. Подстраницы (`/account/verify`,
 * `/account/recover`) попадают под то же правило — в `robots.txt`
 * запрещается путь и всё, что под ним.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/calculator", "/account"] },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
