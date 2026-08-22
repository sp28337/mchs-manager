import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * FE002 — примитив кнопки в конвенции shadcn/ui (`cva` + `asChild`),
 * с палитрой этого проекта.
 *
 * Вариантов пять, и один из них требует объяснения. `signal` — НЕ
 * «основное действие»: сигнальный цвет в интерфейсе означает «требует
 * решения человека», и красить им кнопку «Сохранить» значило бы
 * обесценить единственный цвет, которым помечены переработка, отказ и
 * конфликт. `signal` — для действий, которые сами по себе являются
 * вмешательством: удаление профиля, отмена внесённого отсутствия.
 *
 * Основное действие — `default`: чернила на бумаге. Спокойное, но
 * единственное залитое пятно в форме, и потому заметное.
 */
const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm",
    "text-sm font-medium transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        default: "bg-ink text-paper hover:bg-ink/85",
        outline:
          "border border-rule-strong bg-transparent text-ink hover:bg-paper-sunken",
        ghost: "text-ink-muted hover:bg-paper-sunken hover:text-ink",
        signal: "bg-signal text-white hover:bg-signal/85",
        link: "text-trace underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-9 px-3 text-xs",
        lg: "h-11 px-6",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className, 'cursor-pointer')}
      {...props}
    />
  );
}

export { buttonVariants };
