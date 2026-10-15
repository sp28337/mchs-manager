import type { Metadata } from "next";

import { CookieChoice } from "@/features/consent/cookie-choice";
import { loadLegalDocument } from "@/features/legal/documents";
import { LegalPage } from "@/features/legal/legal-page";

/**
 * Файлы cookie и счётчик посещений.
 *
 * Документ и настройка на одной странице: читать о счётчике и отвечать про
 * него человек приходит в одно и то же место, и разводить это по двум
 * адресам значило бы заставить его искать второй.
 *
 * Ссылка в подвале названа «Настройки cookie» — по делу, за которым сюда
 * идут чаще всего; заголовок самой страницы остаётся заголовком документа.
 */
const документ = loadLegalDocument("cookies");

export const metadata: Metadata = {
  title: "Файлы cookie и счётчик посещений",
  description:
    "Что «График 1 3» хранит в браузере, какие данные достаются счётчику " +
    "посещений и как отказаться от аналитики.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return <LegalPage document={документ} before={<CookieChoice />} />;
}
