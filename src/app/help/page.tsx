import type { Metadata } from "next";

import { SiteFooter } from "@/components/shared/site-footer";
import { SiteHeader } from "@/components/shared/site-header";
import { AccountMenuItems, AccountRail } from "@/features/shift/components/header-tools";
import { HelpScreen } from "@/features/help/help-screen";

export const metadata: Metadata = {
  title: "Справка",
  description:
    "Как пользоваться графиком и календарём: шапка, итоги, клетки сетки, правка дней, " +
    "знаки у нижней кромки, производственный календарь, сохранение графиков.",
  alternates: { canonical: "/help" },
};

export default function HelpPage() {
  return (
    <>
      <SiteHeader menu={<AccountMenuItems help={false} />} rail={<AccountRail />} />
      <main className="mx-auto w-full max-w-[2000px] min-h-[var(--fold-min-h)] px-6 pt-24 pb-16">
        <HelpScreen />
      </main>

      <SiteFooter />
    </>
  );
}
