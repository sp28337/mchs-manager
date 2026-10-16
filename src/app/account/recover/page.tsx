import type { Metadata } from "next";

import { SiteFooter } from "@/components/shared/site-footer";
import { SiteHeader } from "@/components/shared/site-header";
import { OpenScheduleItem } from "@/components/shared/header-menu";
import { RecoverScreen } from "@/features/sync/ui/recover-screen";

export const metadata: Metadata = {
  title: "Восстановление доступа",
  robots: { index: false, follow: false },
};

/**
 * Восстановление доступа по ссылке из письма.
 *
 * Письмо подтверждает владение адресом, ключ восстановления
 * разворачивает ключ данных, новый пароль упаковывает его заново
 * (раздел 2.6 контракта). Ключ восстановления на сервер не уходит ни на
 * одном шаге.
 */
export default function RecoverPage() {
  return (
    // Содержимое — не ниже экрана (`--fold-min-h`): на короткой странице
    // подвал уходит за нижнюю кромку окна и показывается прокруткой, а не
    // висит под содержимым посреди бумаги.
    <>
      {/* Переход к расчёту — строкой в меню, а не словом в шапке:
          справа на всех страницах одно и то же «МЕНЮ». */}
      <SiteHeader menu={<OpenScheduleItem />} />
      <main className="mx-auto w-full max-w-[44rem] min-h-[var(--fold-min-h)] px-6 pt-24 pb-16">
        <RecoverScreen />
      </main>

      <SiteFooter />
    </>
  );
}
