import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { AppTopBar } from "@/components/shell/app-top-bar";
import { getServerSession } from "@/lib/auth/server";
import { navigationFor } from "@/lib/auth/navigation";

/**
 * FE006 — оболочка защищённой зоны.
 *
 * DoD: «redirect на `/login` без сессии; пункты меню отличаются для двух
 * ролей».
 *
 * --- Почему проверка здесь, а не только в middleware --------------------
 *
 * Middleware отсекает запрос до маршрутизации и потому дёшев, но он видит
 * только cookie. Layout видит РАЗОБРАННУЮ сессию и потому ловит случай,
 * которого middleware не различает: cookie есть, а токен просрочен или
 * испорчен. Обе проверки нужны, и вторая — та, что решает.
 *
 * --- `?from=` ------------------------------------------------------------
 *
 * Адрес, на который человек шёл, сохраняется в параметре. Вход, после
 * которого человек оказывается на главной вместо страницы, ради которой
 * он вошёл, — маленькая, но ежедневная потеря.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const sections = navigationFor(session.roles);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Пропуск к содержимому — первое, на что попадает Tab. Без него
          человек с клавиатуры каждый раз проходит всё меню (WCAG 2.2,
          2.4.1 Bypass Blocks). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-ink focus:px-3 focus:py-2 focus:text-paper"
      >
        Перейти к содержимому
      </a>

      <AppTopBar session={session} />

      <div className="flex flex-1">
        <AppSidebar sections={sections} />
        <main id="main" className="min-w-0 flex-1 px-6 py-6">
          <div className="mx-auto max-w-6xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
