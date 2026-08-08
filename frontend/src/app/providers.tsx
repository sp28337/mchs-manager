"use client";

import { ThemeProvider } from "next-themes";

/**
 * Провайдеры приложения.
 *
 * Остался один. Здесь был `QueryClientProvider` с настройками кеша и
 * комментарием о том, что общий на сервере экземпляр отдал бы расчёт
 * одного человека другому, — запросов больше нет, делить между
 * пользователями нечего. `TooltipProvider` ушёл следом за последней
 * подсказкой: пояснения к числам стоят рядом с ними текстом, а не
 * прячутся под наведение, которого нет на телефоне.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}
