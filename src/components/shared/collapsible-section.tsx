import { ChevronDown } from "lucide-react";
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

/**
 * То же самое, но карточкой — для боковой колонки.
 *
 * --- Почему не тот же компонент с пропом --------------------------------
 *
 * Разделу в основном потоке границу задаёт линия сверху и крупный
 * заголовок: он лежит в колонке для чтения, и рамка вокруг каждого только
 * дробила бы её. В боковой колонке наоборот — блоки стоят вплотную друг к
 * другу, и без рамки не видно, где кончается один и начинается другой.
 * Это разная вёрстка, а не разное значение одного пропа.
 *
 * --- Почему заголовок мелкий, а не крупный ------------------------------
 *
 * В колонке пять заголовков подряд. Набранные как в основном потоке, они
 * перетянули бы на себя внимание с того, ради чего человек пришёл, —
 * с чисел справа. Здесь заголовок называет блок, а не открывает главу.
 *
 * --- Почему подпись есть у свёрнутого -----------------------------------
 *
 * Свёрнутый блок обязан отвечать на свой главный вопрос, не раскрываясь:
 * «внесено периодов: 3», «расхождений нет». Иначе колонка из пяти
 * закрытых крышек заставляет открывать их по очереди, чтобы вспомнить,
 * что где.
 */
export function CollapsiblePanel({
  title,
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  title: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details
      open={defaultOpen}
      className={cn("group rounded-xl border border-rule bg-paper-raised", className)}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-start gap-3 rounded-xl p-4",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
            {title}
          </span>
          {summary ? (
            <span className="block text-xs text-ink-faint">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}
