import type { Metadata } from "next";

import { loadLegalDocument } from "@/features/legal/documents";
import { LegalPage } from "@/features/legal/legal-page";

/**
 * Условия использования.
 *
 * Текст — в [`docs/legal/terms.md`](../../../docs/legal/terms.md), и
 * страница собирает его оттуда на сборке. Прежде он лежал прямо здесь,
 * разметкой, вместе с разделом «Данные и приватность»; раздел уехал в
 * отдельную политику (`/privacy`), а текст — в Markdown, потому что у
 * него появился второй и третий читатель: архив редакций и хэш, который
 * сервер отдаёт в `GET /legal/documents`. Три копии одного документа
 * разошлись бы в первую же правку.
 */
const документ = loadLegalDocument("terms");

export const metadata: Metadata = {
  title: "Условия использования",
  description:
    "Условия использования сервиса «График 1 3» — калькулятора рабочего " +
    "времени при сменном графике. Расчёт и данные живут в браузере, копия " +
    "на сервере — зашифрованная.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalPage document={документ} />;
}
