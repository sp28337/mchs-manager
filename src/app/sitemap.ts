import type { MetadataRoute } from "next";

/* Файл собирается один раз на сборке: сайт выгружается в статику, и
   вычислять его на каждый запрос негде и незачем. */
export const dynamic = "force-static";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * Посадочная страница, справка и четыре документа.
 *
 * Калькулятора здесь нет намеренно — он закрыт от индексации (`robots.ts`):
 * форма без единого слова о том, зачем её заполнять, в выдаче бесполезна.
 * Страниц учётной записи нет по той же причине и ещё по одной: они личные.
 *
 * Документы перечислены все: оператор обязан обеспечить к политике
 * неограниченный доступ (ч. 2 ст. 18.1 152-ФЗ), а документ, которого нет в
 * карте сайта, находится хуже. Страница про cookie здесь же — на ней
 * отзывают согласие на аналитику, и найти её человек должен и поиском.
 */
const ДОКУМЕНТЫ = ["/terms", "/privacy", "/consent", "/cookies"];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: SITE,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 1,
    },
    {
      url: `${SITE}/help`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    },
    ...ДОКУМЕНТЫ.map((путь) => ({
      url: `${SITE}${путь}`,
      lastModified: now,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
