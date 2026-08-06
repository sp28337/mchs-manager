import type * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Таблица — основной носитель смысла в этой системе, поэтому примитив
 * задаёт не только вид, но и разметку доступности: обёртка со скроллом
 * получает `role="region"` и `tabIndex`, иначе таблица, уехавшая за край
 * экрана, недостижима с клавиатуры (WCAG 2.2, 2.1.1).
 */
export function Table({
  className,
  caption,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { caption?: string }) {
  return (
    <div
      className="relative w-full overflow-x-auto"
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table
        className={cn("w-full caption-bottom border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-rule-strong", className)} {...props} />;
}

export function TableBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("border-b border-rule transition-colors hover:bg-paper-sunken", className)}
      {...props}
    />
  );
}

export function TableHead({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 px-3 text-left align-middle",
        "font-display text-xs font-bold uppercase tracking-wide text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}

export function TableCaption({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn("mt-3 text-xs text-ink-muted", className)} {...props} />;
}
