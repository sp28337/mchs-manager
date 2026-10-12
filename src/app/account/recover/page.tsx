import type { Metadata } from "next";

import { SiteHeader } from "@/components/shared/site-header";
import { ToCalculator } from "@/components/landing/to-calculator";
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
    <>
      <SiteHeader action={<ToCalculator>Открыть график</ToCalculator>} />
      <main className="mx-auto w-full max-w-[44rem] px-6 pt-24 pb-16">
        <RecoverScreen />
      </main>
    </>
  );
}
