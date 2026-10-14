import type { Metadata } from "next";

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
    <>
      <SiteHeader action={<OpenSchedule />} />
      <main className="mx-auto w-full max-w-[44rem] px-6 pt-24 pb-16">
        <VerifyEmailScreen />
      </main>
    </>
  );
}
