import type { Metadata } from "next";

import { SiteFooter } from "@/components/shared/site-footer";
import { SiteHeader } from "@/components/shared/site-header";
import { AccountMenuItems } from "@/features/shift/components/header-tools";
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
    // Содержимое — не ниже экрана (`--fold-min-h`): на короткой странице
    // подвал уходит за нижнюю кромку окна и показывается прокруткой, а не
    // висит под содержимым посреди бумаги.
    <>
      {/* В меню — те же пункты, что на расчёте: настройки, события,
          статистика, графики, «Сохранить» (`AccountMenuItems`). Справа на
          всех страницах одно и то же «МЕНЮ», и в нём одно и то же. */}
      <SiteHeader menu={<AccountMenuItems />} />
      <main className="mx-auto w-full max-w-[2000px] min-h-[var(--fold-min-h)] px-6 pt-24 pb-16">
        <AccountScreen />
      </main>

      <SiteFooter />
    </>
  );
}
