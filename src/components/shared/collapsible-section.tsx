import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Сворачиваемый раздел.
 *
 * --- Почему `details`, а не своё состояние -------------------------------
 *
 * Открытие и закрытие умеет сам браузер: с клавиатуры, экранным диктором и
 * поиском по странице (Ctrl+F раскрывает свёрнутое). Своя реализация на
 * `useState` всё это ломает и не даёт ничего взамен.
 *
 * --- Почему разделы вообще сворачиваются ---------------------------------
 *
 * Экран калькулятора длинный: расчёт, год из двенадцати сеток, ещё год
 * календаря, отсутствия, сверка. Человек приходит с одним вопросом за раз —
 * сверить месяц или внести отпуск, — и остальное в этот момент только
 * заставляет листать.
 */
export function CollapsibleSection({
  title,
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  title: ReactNode;
  /** Короткая подпись справа: что внутри, не открывая. */
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={cn("group border-t border-rule pt-4", className)}>
      <summary
        className={cn(
          "flex cursor-pointer list-none flex-wrap items-baseline gap-x-3",
          "rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <span aria-hidden className="font-mono text-ink-faint transition-transform group-open:rotate-90">
          ›
        </span>
        <h2 className="text-xl">{title}</h2>
        {summary ? <span className="text-sm text-ink-muted">{summary}</span> : null}
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}
