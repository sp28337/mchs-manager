"use client";

import { ThemeProvider } from "next-themes";

import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Провайдеры приложения.
 *
 * Здесь был `QueryClientProvider` с настройками кеша, повторов и
 * комментарием о том, что общий на сервере экземпляр отдал бы расчёт
 * одного человека другому. Запросов больше нет — расчёт идёт в браузере, —
 * поэтому нет ни кеша, ни повторов, ни самого риска: делить между
 * пользователями нечего, потому что сервер о них ничего не знает.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
