import type { MetadataRoute } from "next";

/* Файл собирается один раз на сборке: сайт выгружается в статику, и
   вычислять его на каждый запрос негде и незачем. */
export const dynamic = "force-static";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * Две страницы: та, у которой есть что показать поиску, и условия.
 *
 * Калькулятора здесь нет намеренно — он закрыт от индексации (`robots.ts`):
 * форма без единого слова о том, зачем её заполнять, в выдаче бесполезна.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 1,
    },
    {
      url: `${SITE}/terms`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
