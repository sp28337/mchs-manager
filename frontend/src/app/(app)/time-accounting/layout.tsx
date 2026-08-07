import { ModuleTabs } from "@/components/shell/module-tabs";
import { getServerSession } from "@/lib/auth/server";
import { navigationFor } from "@/lib/auth/navigation";

/**
 * Саб-навигация модуля (Frontend_Architecture разд. 3): состав табов
 * фильтруется по ролям тем же словарём, что и сайдбар. Второй список
 * разошёлся бы с первым при первой же правке.
 */
export default async function TimeAccountingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  const sections = navigationFor(session?.roles ?? []);
  const items = sections.find((s) => s.title === "Служебное время")?.items ?? [];

  return (
    <div className="space-y-6">
      <ModuleTabs items={items} />
      {children}
    </div>
  );
}
