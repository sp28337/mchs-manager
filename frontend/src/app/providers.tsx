"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api-client/client";

/**
 * FE004 — провайдеры приложения.
 *
 * `QueryClient` создаётся в `useState`, а не в модуле: модульный
 * экземпляр на сервере был бы ОБЩИМ ДЛЯ ВСЕХ ЗАПРОСОВ, то есть кеш
 * одного пользователя достался бы другому. Здесь это не абстрактный риск
 * — в кеше лежат расчёты конкретных людей.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Минута: данные учёта меняются приказами и утверждениями, а не
        // ежесекундно, и повторный запрос при каждом переключении вкладки
        // нагружал бы сервер без пользы.
        staleTime: 60_000,
        retry: (failureCount, error) => {
          // Повторять отказ по существу бессмысленно: 409, 422 и 423 —
          // ответы о состоянии, они не станут другими от повтора. 401 и
          // 403 тем более.
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        // Команды не повторяются автоматически НИКОГДА. Даже с ключом
        // идемпотентности решение о повторе принимает человек: он один
        // знает, была ли операция намеренной.
        retry: false,
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster
              position="bottom-right"
              // Уведомление обязано быть объявлено программе чтения с
              // экрана, а не только показано (WCAG 2.2, 4.1.3 Status
              // Messages).
              toastOptions={{ className: "font-sans text-sm" }}
            />
          </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
