import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Панели рабочей области.
 *
 * --- Почему панель, а не карточка ----------------------------------------
 *
 * Первая попытка была карточной: крупное скругление, тень, много воздуха,
 * заголовок в полтора размера. Так выглядит любая учётная панель, и именно
 * поэтому так нельзя: человек несёт отсюда числа в служебный разбор, а
 * интерфейс, похожий на потребительское приложение, обесценивает их
 * заранее.
 *
 * Панель устроена как раздел бланка. У неё есть номер, набранный моноширинно,
 * заголовок в разрядку прописными и волосяная линия под ними. Тени нет
 * вовсе — на утопленном фоне хватает рамки в один пиксель; тень на тёмной
 * теме всё равно превращается в грязь.
 *
 * --- Почему номер --------------------------------------------------------
 *
 * Не украшение. Разделы приказа нумеруются, и на них ссылаются номером;
 * здесь то же самое — человеку, объясняющему коллеге, куда смотреть, проще
 * сказать «в третьем блоке», чем пересказывать заголовок. Заодно номер
 * держит вертикальный ритм заголовков, у которых разная длина.
 *
 * --- Почему `details` ----------------------------------------------------
 *
 * Сворачивание умеет сам браузер: с клавиатуры, экранным диктором и поиском
 * по странице — Ctrl+F раскрывает свёрнутое. Реализация на `useState`
 * ломает всё три.
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

/**
 * Сетка панелей.
 *
 * Двенадцать колонок, а не шесть: разница между «две трети» и «три
 * четверти» на широком экране заметна, а при шести колонках её нельзя
 * выразить. Промежуток узкий — плотность здесь важнее воздуха.
 */
export function BentoGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 lg:grid-cols-12", className)}>
      {children}
    </div>
  );
}

export interface BentoCardProps {
  title: ReactNode;
  /** Номер раздела. Двузначный, как в бланке. */
  index?: number;
  /** Короткая справка справа в шапке: что внутри, не открывая. */
  summary?: ReactNode;
  /** Действие в шапке — кнопка справа. */
  action?: ReactNode;
  children: ReactNode;
  span?: PanelSpan;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /**
   * Смысловой тон. Панель, требующая решения, помечается сигнальной
   * линией сверху — не рамкой целиком: рамка кричит, линия называет.
   */
  tone?: "default" | "signal";
  className?: string;
  bodyClassName?: string;
}

const HEAD = cn(
  "panel-head flex items-center gap-3 border-b border-rule px-4 py-2.5",
);

const TITLE = cn(
  "min-w-0 truncate font-display text-[13px] font-bold uppercase leading-none",
  "tracking-[0.09em] text-ink",
);

const INDEX = "shrink-0 font-mono text-[11px] leading-none text-ink-faint";

const SUMMARY = "ml-auto shrink-0 truncate font-mono text-[11px] leading-none text-ink-muted";

export function BentoCard({
  title,
  index,
  summary,
  action,
  children,
  span = 6,
  collapsible = false,
  defaultOpen = true,
  tone = "default",
  className,
  bodyClassName,
}: BentoCardProps) {
  const shell = cn(
    "relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-rule bg-paper-raised",
    SPAN[span],
    className,
  );

  const marker =
    tone === "signal" ? (
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-signal"
      />
    ) : null;

  const label = (
    <>
      {index === undefined ? null : (
        <span aria-hidden className={INDEX}>
          {String(index).padStart(2, "0")}
        </span>
      )}
      <h2 className={TITLE}>{title}</h2>
      {summary ? <span className={SUMMARY}>{summary}</span> : null}
    </>
  );

  if (!collapsible) {
    return (
      <section className={shell}>
        {marker}
        <div className={HEAD}>
          {label}
          {action ? <div className={summary ? "shrink-0" : "ml-auto shrink-0"}>{action}</div> : null}
        </div>
        <div className={cn("min-w-0 p-4", bodyClassName)}>{children}</div>
      </section>
    );
  }

  return (
    <details open={defaultOpen} className={cn(shell, "group")}>
      {marker}
      <summary
        className={cn(
          HEAD,
          "cursor-pointer list-none select-none",
          "hover:bg-paper-sunken/70",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        {label}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-ink-faint transition-transform duration-150 group-open:rotate-180",
            summary ? "" : "ml-auto",
          )}
        />
      </summary>
      <div className={cn("min-w-0 p-4", bodyClassName)}>{children}</div>
    </details>
  );
}

/**
 * Подпись величины и сама величина.
 *
 * Подпись мелкими прописными в разрядку, значение — моноширинным с
 * табличными цифрами. Это язык приборов и сводок, и он здесь не ради
 * стиля: в столбце чисел разной длины табличные цифры выравниваются по
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
    <div className={cn("min-w-0 space-y-1", className)}>
      <p className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
        {label}
      </p>
      <p
        className={cn(
          "font-mono leading-none",
          size === "sm" && "text-base",
          size === "md" && "text-xl",
          size === "lg" && "text-3xl",
          size === "xl" && "text-[2.75rem] sm:text-[3.25rem]",
          tone === "signal" && "text-signal",
          tone === "verify" && "text-verify",
          tone === "muted" && "text-ink-muted",
        )}
      >
        {value}
        {unit ? (
          <span
            className={cn(
              "ml-1 text-ink-faint",
              size === "xl" ? "text-lg" : size === "lg" ? "text-sm" : "text-xs",
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
 * Одна рамка с внутренними перегородками вместо россыпи отдельных кнопок.
 * Россыпь не показывает, что выбор один: пять одинаковых пилюль в ряд
 * читаются как пять независимых действий.
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
        "inline-flex overflow-hidden rounded-md border border-rule-strong",
        "divide-x divide-rule-strong",
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
        "shrink-0 cursor-pointer whitespace-nowrap px-3 py-1.5 text-xs font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",
        active ? "bg-ink text-paper" : "text-ink-muted hover:bg-paper-sunken hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}
