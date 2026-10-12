import type { Metadata } from "next";

import { loadLegalDocument } from "@/features/legal/documents";
import { LegalPage } from "@/features/legal/legal-page";

/**
 * Согласие на обработку персональных данных.
 *
 * Тот самый текст, на который человек ставит отметку при регистрации.
 * Лежит отдельной страницей, потому что согласие должно быть конкретным и
 * информированным (ч. 1 ст. 9 152-ФЗ): отметка «согласен» без текста,
 * который можно прочитать до нажатия, этому не отвечает. Версия этого
 * текста уходит в запись о согласии, а её хэш — в `GET /legal/documents`.
 */
const документ = loadLegalDocument("consent");

export const metadata: Metadata = {
  title: "Согласие на обработку персональных данных",
  description:
    "Текст согласия, которое даётся при создании учётной записи в " +
    "«График 1 3»: какие данные, с какой целью и на какой срок.",
  alternates: { canonical: "/consent" },
};

export default function ConsentPage() {
  return <LegalPage document={документ} />;
}
