import type * as React from "react";

import { cn } from "@/lib/utils/cn";

export function Input({
  className,
  type,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-lg bg-paper px-3 py-1 transition-all duration-200",
        "text-sm text-ink placeholder:text-ink-faint border border-paper hover:border-ink-muted",
        // Своя рамка вместо браузерной обводки. Без этого фокус показывал
        // системное кольцо — в тёмной теме бледно-фиолетовое, цвета, какого
        // в приложении нет нигде. Чернильная кромка говорит то же самое
        // («сюда набирают») и говорит это здешним языком.
        "focus-visible:border-ink focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // `aria-invalid` вместо собственного пропа `error`: состояние поля
        // обязано быть объявлено средствам доступности, а не только
        // покрашено (WCAG 2.2, 3.3.1 Error Identification).
        "",
        className,
      )}
      {...props}
    />
  );
}
