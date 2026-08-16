"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Переключатель из нескольких взаимоисключающих положений.
 *
 * --- Почему не россыпь кнопок --------------------------------------------
 *
 * Раньше выбор вида сетки и выбор учётного периода делались обычными
 * кнопками в ряд. Ряд одинаковых кнопок читается как несколько независимых
 * действий — «нажми эту, потом ту», — а выбор здесь ровно один из
 * нескольких. Общая утопленная подложка и одна поднятая плашка внутри
 * говорят это без слов: положений столько, сколько ячеек, и занято одно.
 *
 * --- Почему выбранное поднято, а не залито ------------------------------
 *
 * Залить выбранную ячейку чернилами (как у обычной кнопки) значило бы
 * поставить в строку управления самое тёмное пятно на экране — и увести
 * взгляд с чисел, ради которых человек пришёл. Поднятая плашка цвета
 * бумаги на утопленной подложке заметна не меньше, но не кричит.
 */
export function Segmented({
  label,
  className,
  children,
}: {
  /** Имя группы для программы чтения: без него это просто кнопки подряд. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex h-9 items-center gap-0.5 rounded-xl border border-rule",
        "bg-paper-sunken p-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SegmentedItem({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5",
        "whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        active
          ? "bg-paper-raised text-ink shadow-sm"
          : "text-ink-muted hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}
