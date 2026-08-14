import type * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Многострочное поле.
 *
 * Форма повторяет `Input` до пикселя, кроме высоты: разные рамки у соседних
 * полей одной формы читаются как разный род ввода, хотя разница только в
 * числе строк.
 */
export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex w-full rounded-sm border border-rule-strong bg-paper-raised px-3 py-2",
        "text-sm text-ink placeholder:text-ink-faint",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-signal",
        className,
      )}
      {...props}
    />
  );
}
