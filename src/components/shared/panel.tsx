import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Панели, пилюли и величины — материалы этого интерфейса.
 *
 * --- Из чего он сделан ---------------------------------------------------
 *
 * Холст глубокий сине-чёрный с мягким свечением сверху. Панель — не
 * наклейка на нём, а его же поверхность, поднятая на пару процентов
 * прозрачной заливкой: свечение проходит сквозь неё, и блок принадлежит
 * фону. Держит панель волосяная рамка, а не тень; на наведении рамка
 * набирает бирюзу.
 *
 * Бирюза здесь не случайный акцент. Это тот же цвет, которым в системе
 * помечено ПОДТВЕРЖДЁННОЕ, а всё приложение существует ради проверки —
 * поэтому цвет проверки и есть цвет продукта. Сигнальный красный при этом
 * остаётся тем, чем был: он появляется там, где требуется решение
 * человека, и никогда не украшает.
 *
 * --- Чем это отличается от витрины ---------------------------------------
 *
 * Материалы одни, плотность разная. Лендинг читают — там панели дышат.
 * Калькулятор используют — там те же панели сжаты, потому что на экране
 * числа, а не витрина. Разделять это на две дизайн-системы было бы
 * ошибкой: человек переходит между страницами за секунду.
 */

/** Сколько колонок из двенадцати занимает панель на широком экране. */
export type PanelSpan = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;

const SPAN: Record<PanelSpan, string> = {
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  9: "lg:col-span-9",
  12: "lg:col-span-12",
};

export function PanelGrid({
  children,
  className,
  dense = false,
}: {
  children: ReactNode;
  className?: string;
  /** Рабочий экран: тот же материал, меньше воздуха. */
  dense?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 lg:grid-cols-12",
        dense ? "gap-3" : "gap-4 sm:gap-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface PanelProps {
  title?: ReactNode;
  /** Надзаголовок мелкими прописными в разрядку. */
  eyebrow?: ReactNode;
  /** Короткая справка справа в шапке: что внутри, не открывая. */
  summary?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  span?: PanelSpan;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Панель первого плана: со свечением изнутри. */
  feature?: boolean;
  /** Требует решения человека — сигнальная грань сверху. */
  attention?: boolean;
  dense?: boolean;
  className?: string;
  bodyClassName?: string;
}

const EYEBROW =
  "font-display text-[10px] font-bold uppercase leading-none tracking-[0.14em] text-verify";

export function Panel({
  title,
  eyebrow,
  summary,
  action,
  children,
  span = 6,
  collapsible = false,
  defaultOpen = true,
  feature = false,
  attention = false,
  dense = false,
  className,
  bodyClassName,
}: PanelProps) {
  const shell = cn(
    "panel relative flex min-w-0 flex-col overflow-hidden rounded-2xl",
    collapsible && "panel-hover",
    feature && "panel-feature",
    SPAN[span],
    className,
  );

  const pad = dense ? "px-4" : "px-5 sm:px-6";
  const headPad = dense ? "py-3" : "py-4 sm:py-5";
  const bodyPad = dense ? "pb-4" : "pb-5 sm:pb-6";

  const head = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {eyebrow ? <span className={EYEBROW}>{eyebrow}</span> : null}
      {title ? (
        <h2
          className={cn(
            "min-w-0 font-sans font-semibold leading-tight text-ink",
            dense ? "text-[15px]" : "text-lg sm:text-xl",
          )}
        >
          {title}
        </h2>
      ) : null}
    </div>
  );

  const aside = summary ? (
    <span className="shrink-0 self-center font-mono text-[11px] leading-none text-ink-faint">
      {summary}
    </span>
  ) : null;

  if (!collapsible) {
    return (
      <section className={shell}>
        {attention ? <AttentionEdge /> : null}
        {title || eyebrow ? (
          <div className={cn("flex items-start gap-4", pad, headPad)}>
            {head}
            {aside}
            {action ? <div className="shrink-0 self-center">{action}</div> : null}
          </div>
        ) : null}
        <div className={cn("min-w-0", pad, bodyPad, !title && !eyebrow && "pt-5", bodyClassName)}>
          {children}
        </div>
      </section>
    );
  }

  return (
    <details open={defaultOpen} className={cn(shell, "group")}>
      <summary
        className={cn(
          "flex cursor-pointer list-none select-none items-start gap-4",
          pad,
          headPad,
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        {attention ? <AttentionEdge /> : null}
        {head}
        {aside}
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 self-center text-ink-faint transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className={cn("min-w-0", pad, bodyPad, bodyClassName)}>{children}</div>
    </details>
  );
}

/** Сигнальная грань сверху: панель называет, а не кричит рамкой целиком. */
function AttentionEdge() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-px bg-signal"
    />
  );
}

/**
 * Пилюля: короткая метка.
 *
 * Тон — смысл, а не украшение. `verify` у подтверждённого, `signal` у
 * требующего решения, `trace` у правового основания, `plain` у всего
 * остального.
 */
export function Pill({
  children,
  tone = "plain",
  className,
}: {
  children: ReactNode;
  tone?: "plain" | "verify" | "signal" | "trace" | "accent";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
        "text-[11px] font-medium leading-5",
        tone === "plain" && "border-rule bg-paper/60 text-ink-muted",
        tone === "verify" && "border-verify/35 bg-verify-soft text-verify",
        tone === "signal" && "border-signal/35 bg-signal-soft text-signal",
        tone === "trace" && "border-trace/35 bg-trace-soft text-trace",
        tone === "accent" && "border-trip/35 bg-trip-soft text-trip",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Подпись величины и сама величина.
 *
 * Подпись мелкими прописными в разрядку, значение — моноширинным с
 * табличными цифрами: в столбце чисел разной длины они выравниваются по
 * разрядам, а пропорциональные — нет.
 */
export function Metric({
  label,
  value,
  unit,
  tone,
  size = "md",
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "signal" | "verify" | "muted";
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <p className="font-display text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </p>
      <p
        className={cn(
          "font-mono leading-none tracking-tight",
          size === "sm" && "text-base",
          size === "md" && "text-xl",
          size === "lg" && "text-3xl",
          size === "xl" && "text-[2.75rem] sm:text-[3.5rem]",
          tone === "signal" && "text-signal",
          tone === "verify" && "text-verify",
          tone === "muted" && "text-ink-muted",
        )}
      >
        {value}
        {unit ? (
          <span
            className={cn(
              "ml-1.5 font-sans text-ink-faint",
              size === "xl" ? "text-base" : size === "lg" ? "text-sm" : "text-xs",
            )}
          >
            {unit}
          </span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Переключатель из нескольких взаимоисключающих значений.
 *
 * Одна оболочка с внутренними перегородками вместо россыпи кнопок:
 * россыпь одинаковых пилюль читается как несколько независимых действий,
 * а выбор здесь ровно один.
 */
export function Segmented({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex overflow-hidden rounded-full border border-rule bg-paper/60 p-0.5",
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
        "shrink-0 cursor-pointer whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium",
        "transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2",
        "focus-visible:outline-trace",
        active
          ? "bg-ink text-paper-raised"
          : "text-ink-muted hover:bg-paper-sunken hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}
