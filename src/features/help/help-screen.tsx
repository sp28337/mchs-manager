"use client";

import { EMAIL } from "@/components/shared/site-footer";
import { SectionLayout } from "@/components/ui/section-layout";
import { useHashSection } from "@/components/ui/use-hash-section";

import { HELP_SECTIONS, HELP_SECTION_IDS, HelpSection } from "./help-sections";

/**
 * Справка: как пользоваться графиком и календарём.
 *
 * Слева разделы со значками, справа открытый, как на страницах учётной записи
 * и настроек. Раздел живёт и в адресе (`/help#events`), чтобы на него можно было
 * сослаться. Каждая строка раздела — сам элемент приложения крупнее обычного и
 * рядом объяснение, что это и зачем (`help-sections.tsx`).
 *
 * Адреса прежних разделов (`#cells`, `#dock`, …) исчезли вместе с ними: ссылок
 * на них в приложении нет, а чужая ссылка просто откроет первый раздел.
 */
export function HelpScreen() {
  const [section, choose] = useHashSection(HELP_SECTION_IDS);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <h1 className="text-xl font-medium text-ink">Справка</h1>

      <SectionLayout
        label="Разделы справки"
        sections={HELP_SECTIONS}
        active={section}
        onSelect={choose}
        footer={
          <p>
            Не нашли ответ? Напишите на{" "}
            <a href={`mailto:${EMAIL}`} className="underline hover:no-underline">
              {EMAIL}
            </a>
            .
          </p>
        }
      >
        <HelpSection id={section} />
      </SectionLayout>
    </div>
  );
}
