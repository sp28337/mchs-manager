import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { Hint } from "@/components/ui/hint";
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
  hint,
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  title: ReactNode;
  /**
   * Знак вопроса сразу после заголовка.
   *
   * Для того, что раньше стояло абзацем над содержимым раздела и
   * отодвигало его вниз. У сетки года это не мелочь: она показывается на
   * месте другой сетки по нажатию кнопки, и абзац над ней сдвигал бы её
   * при каждом переключении.
   */
  hint?: ReactNode;
  /** Короткая подпись справа: что внутри, не открывая. */
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={cn("group", className)}>
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
        <h2 className="text-xl flex items-center">{title}</h2>
        {hint ? <Hint>{hint}</Hint> : null}
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
 *
 * --- Зачем значок ---------------------------------------------------------
 *
 * Не для украшения: свёрнутая в полоску колонка показывает ОДНИ значки, и
 * человек выбирает блок по ним. Значок обязан быть тем же самым в полоске
 * и в заголовке, иначе полоска станет ребусом. Поэтому он приходит
 * снаружи — набор блоков знает вызывающий код, а не этот компонент.
 *
 * --- Почему открытость можно задать снаружи -------------------------------
 *
 * Обычно блок сам помнит, раскрыт он или нет, и вмешиваться незачем. Но по
 * нажатию на значок в свёрнутой полоске колонка обязана не только
 * развернуться, но и открыть нужный блок, — а это решение принимается вне
 * блока. Поэтому `open`/`onOpenChange` необязательны: без них блок
 * работает сам по себе.
 */
export function CollapsiblePanel({
  id,
  title,
  icon,
  hint,
  summary,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
}: {
  /** Нужен, чтобы блок можно было найти и увести в него фокус снаружи. */
  id?: string;
  title: ReactNode;
  /** Значок блока: он же представляет блок в свёрнутой полоске. */
  icon?: ReactNode;
  /** Знак вопроса рядом с заголовком: пояснение, что это за блок. */
  hint?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Управление снаружи. Вместе с `onOpenChange`, иначе блок замрёт. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  // Неуправляемый случай тоже задаётся через `open`, а не `defaultOpen`:
  // React выставит атрибут один раз и больше его не тронет, пока значение
  // не изменится, — дальше блоком распоряжается сам браузер.
  const isOpen = open ?? defaultOpen;

  return (
    <details
      id={id}
      open={isOpen}
      onToggle={
        onOpenChange
          ? (event) => onOpenChange(event.currentTarget.open)
          : undefined
      }
      className={cn("group rounded-xl border border-rule bg-paper-raised", className)}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-start gap-3 rounded-xl p-4",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        {icon ? (
          <span aria-hidden className="mt-px shrink-0 text-ink-faint [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 font-display text-sm font-bold uppercase tracking-wide text-ink">
              {title}
            </span>
            {hint ? <Hint>{hint}</Hint> : null}
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
