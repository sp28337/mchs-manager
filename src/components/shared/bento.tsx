import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Плитки.
 *
 * --- Что изменилось и зачем ----------------------------------------------
 *
 * Раньше экран расчёта был вертикальной лентой разделов, разделённых
 * тонкой линейкой, — вёрстка документа. На узком экране это правильно, но
 * на широком получалась колонка текста посреди пустоты: календарь на год
 * занимал треть ширины, а две трети оставались полями.
 *
 * Теперь то же содержимое разложено плитками. Плитка — не украшение, а
 * граница смысла: у неё свой заголовок, своя подпись «что внутри» и своё
 * состояние «свёрнута/развёрнута». Человек, пришедший за одним вопросом,
 * видит все ответы сразу и выбирает нужный, а не листает.
 *
 * --- Почему `details`, а не своё состояние -------------------------------
 *
 * Открытие и закрытие умеет сам браузер: с клавиатуры, экранным диктором и
 * поиском по странице — Ctrl+F раскрывает свёрнутое и подсвечивает
 * найденное. Своя реализация на `useState` ломает всё три и не даёт
 * ничего взамен.
 *
 * --- Почему высота плиток в ряду одинаковая ------------------------------
 *
 * Сетка растягивает плитки по высоте ряда намеренно. Разновысокие плитки с
 * рваным низом читаются как сбой вёрстки, а не как замысел; ровный ряд —
 * то, ради чего раскладку и делают плиточной.
 */

/** Сколько колонок из шести занимает плитка на широком экране. */
export type BentoSpan = 2 | 3 | 4 | 6;

const SPAN: Record<BentoSpan, string> = {
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  6: "lg:col-span-6",
};

/**
 * Сетка плиток.
 *
 * Шесть колонок, а не двенадцать: делится на 2 и 3, и этого хватает на
 * все нужные пропорции — половина, треть, две трети, вся ширина. При
 * двенадцати пришлось бы держать в голове, что «6» это половина.
 */
export function BentoGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-6", className)}>
      {children}
    </div>
  );
}

export interface BentoCardProps {
  title: ReactNode;
  /** Короткая подпись справа от заголовка: что внутри, не открывая. */
  summary?: ReactNode;
  /** Действие в шапке плитки — кнопка справа. */
  action?: ReactNode;
  children: ReactNode;
  span?: BentoSpan;
  /** Плитка со сворачиванием. Без этого содержимое всегда видно. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /**
   * Смысловой тон рамки: плитка, требующая решения, отличается от
   * остальных. Пользоваться редко — сигнальный цвет не украшает.
   */
  tone?: "default" | "signal" | "verify";
  className?: string;
  /** Классы внутренней области, чаще всего отступы или прокрутка. */
  bodyClassName?: string;
}

const TONE: Record<NonNullable<BentoCardProps["tone"]>, string> = {
  default: "border-rule",
  signal: "border-signal/40",
  verify: "border-verify/40",
};

export function BentoCard({
  title,
  summary,
  action,
  children,
  span = 3,
  collapsible = false,
  defaultOpen = true,
  tone = "default",
  className,
  bodyClassName,
}: BentoCardProps) {
  const shell = cn(
    "bento-card flex min-w-0 flex-col overflow-hidden rounded-xl border bg-paper-raised",
    TONE[tone],
    SPAN[span],
    className,
  );

  const head = (
    <>
      <h2 className="min-w-0 text-lg leading-tight">{title}</h2>
      {summary ? (
        <span className="min-w-0 truncate text-sm text-ink-muted">{summary}</span>
      ) : null}
    </>
  );

  if (!collapsible) {
    return (
      <section className={shell}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-4 sm:px-5 sm:pt-5">
          {head}
          {action ? <div className="ml-auto">{action}</div> : null}
        </div>
        <div className={cn("min-w-0 px-4 pb-4 pt-3 sm:px-5 sm:pb-5", bodyClassName)}>
          {children}
        </div>
      </section>
    );
  }

  return (
    <details open={defaultOpen} className={cn(shell, "group")}>
      <summary
        className={cn(
          "flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1",
          "px-4 py-4 sm:px-5 sm:py-5",
          "hover:bg-paper-sunken/60",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        {head}
        {/* Стрелка прижата вправо и поворачивается при раскрытии — она же
            единственный признак того, что плитка вообще сворачивается. */}
        <span
          aria-hidden
          className="ml-auto self-center font-mono text-ink-faint transition-transform group-open:rotate-90"
        >
          ›
        </span>
      </summary>
      <div className={cn("min-w-0 px-4 pb-4 sm:px-5 sm:pb-5", bodyClassName)}>{children}</div>
    </details>
  );
}
