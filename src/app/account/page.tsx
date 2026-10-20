import type { Metadata } from "next";

import { SiteFooter } from "@/components/shared/site-footer";
import { SiteHeader } from "@/components/shared/site-header";
import { ThemeCorner } from "@/components/ui/theme-toggle";
import { AccountMenuItems } from "@/features/shift/components/header-tools";
import { AccountScreen } from "@/features/sync/ui/account-screen";

export const metadata: Metadata = {
  title: "Учётная запись",
  description:
    "Синхронизация графиков между устройствами: данные уходят на сервер " +
    "зашифрованными, ключ остаётся в браузере.",
  robots: { index: false, follow: true },
};

export default function AccountPage() {
  return (
    <>
      <SiteHeader menu={<AccountMenuItems />} />
      <main className="mx-auto w-full max-w-[2000px] min-h-[var(--fold-min-h)] px-6 pt-24 pb-16">
        <AccountScreen />
      </main>

      <SiteFooter />

      {/* Тема — знаком в правом нижнем углу, как на посадочной: меню в шапке
          этой странице не нужно, а тема относится к окну, а не к странице. */}
      <ThemeCorner />
    </>
  );
}
