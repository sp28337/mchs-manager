import type { MetadataRoute } from "next";

/* Файл собирается один раз на сборке: сайт выгружается в статику, и
   вычислять его на каждый запрос негде и незачем. */
export const dynamic = "force-static";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/** Страница ровно одна — та, у которой есть что показать поиску. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 1,
    },
  ];
}
