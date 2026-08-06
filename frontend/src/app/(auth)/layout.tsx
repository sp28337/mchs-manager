/**
 * Layout зоны входа: центрированная карточка, никакой навигации.
 *
 * Навигации здесь нет намеренно — человеку без сессии нечего открывать, и
 * пункты меню, ведущие на страницы, которые его развернут обратно, были
 * бы обманом.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Полоса цвета службы: единственное декоративное пятно во всём
          приложении, и оно на экране, где больше ничего нет. */}
      <div aria-hidden className="h-1 w-full bg-signal" />
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
