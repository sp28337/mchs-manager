import type { Metadata } from "next";

import { SiteFooter } from "@/components/shared/site-footer";
import { SiteHeader } from "@/components/shared/site-header";
import { OpenSchedule } from "@/components/shared/header-action";
import { AccountScreen } from "@/features/sync/ui/account-screen";

export const metadata: Metadata = {
  title: "Учётная запись",
  description:
    "Синхронизация графиков между устройствами: данные уходят на сервер " +
    "зашифрованными, ключ остаётся в браузере.",
  // Страница личная: в выдаче ей делать нечего, как и калькулятору.
  robots: { index: false, follow: true },
};

/**
 * Учётная запись и синхронизация.
 *
 * Отдельным адресом, а не закладкой в настройках: в настройках лежат
 * ответы анкеты, из которых считается норма, а это страница про данные и
 * права — здесь же, на шаге 12, встанет «мои данные» с выгрузкой и
 * удалением.
 */
export default function AccountPage() {
  return (
    // Колонка во весь экран: на короткой странице подвал уходит к нижней
    // кромке окна, а не висит под содержимым посреди бумаги.
    <div className="flex min-h-[var(--page-min-h)] flex-col">
      <SiteHeader action={<OpenSchedule />} />
      <main className="mx-auto w-full max-w-[2000px] flex-1 px-6 pt-24 pb-16">
        <AccountScreen />
      </main>

      <SiteFooter />
    </div>
  );
}
