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
        "flex h-9 w-full rounded-md border border-rule bg-paper px-3 py-1",
        "text-sm text-ink placeholder:text-ink-faint",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // `aria-invalid` вместо собственного пропа `error`: состояние поля
        // обязано быть объявлено средствам доступности, а не только
        // покрашено (WCAG 2.2, 3.3.1 Error Identification).
        "transition-colors focus:border-beacon/60",
        "aria-invalid:border-signal",
        className,
      )}
      {...props}
    />
  );
}
