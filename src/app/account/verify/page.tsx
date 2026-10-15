import type { Metadata } from "next";

import { SiteFooter } from "@/components/shared/site-footer";
import { SiteHeader } from "@/components/shared/site-header";
import { OpenSchedule } from "@/components/shared/header-action";
import { VerifyEmailScreen } from "@/features/sync/ui/verify-screen";

export const metadata: Metadata = {
  title: "Подтверждение адреса",
  robots: { index: false, follow: false },
};

/**
 * Страница, на которую ведёт ссылка из письма.
 *
 * Токен приходит строкой запроса (`?token=…`) и читается в браузере:
 * сайт выгружается в статику, серверного обработчика у страницы нет и
 * быть не может. Это не обходной путь, а то же свойство приватности, что
 * и у всего остального, — у сайта, который не исполняет код, нет и
 * журналов с одноразовыми ссылками.
 */
export default function VerifyEmailPage() {
  return (
    // Колонка во весь экран: на короткой странице подвал уходит к нижней
    // кромке окна, а не висит под содержимым посреди бумаги.
    <div className="flex min-h-[var(--page-min-h)] flex-col">
      <SiteHeader action={<OpenSchedule />} />
      <main className="mx-auto w-full max-w-[44rem] flex-1 px-6 pt-24 pb-16">
        <VerifyEmailScreen />
      </main>

      <SiteFooter />
    </div>
  );
}
