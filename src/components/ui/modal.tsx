"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Модальное окно со справкой.
 *
 * --- Почему родной `dialog` ----------------------------------------------
 *
 * Всё, что модальное окно обязано делать, кроме показа текста, браузер
 * умеет сам, если открыть его через `showModal()`: увести фокус внутрь и
 * не выпускать его по Tab, закрыться по Esc, вернуть фокус на кнопку, с
 * которой его открыли, объявить себя диалогом и сделать остальную
 * страницу недоступной для экранного диктора. Своя реализация на `div` с
 * `position: fixed` не делает ничего из этого, пока не написать это всё
 * руками, — а написать это всё руками означает завести пять новых
 * способов запереть человека в окне без выхода.
 *
 * --- Ловушка с `display` -------------------------------------------------
 *
 * Закрытый `dialog` скрыт правилом `display: none` из таблицы браузера.
 * Любая утилита раскладки — `flex`, `grid`, `block` — это правило
 * перебивает, и окно остаётся на экране навсегда. Поэтому раскладка
 * задана вариантом `open:`: она применяется только к открытому окну.
 *
 * --- Прокрутка страницы под окном ----------------------------------------
 *
 * Браузер не запрещает прокручивать страницу за модальным окном, и на
 * телефоне это выглядит так, будто закрылось не то. Прокрутка снимается
 * на время показа и возвращается ровно та, что была: чужое значение
 * `overflow` тут перетирать нельзя — его мог поставить кто-то ещё.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** Заголовок окна: он же его имя для экранного диктора. */
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      // `close` срабатывает и на Esc, и на кнопку, и на вызов `close()`.
      // Слушать нужно именно его: иначе состояние снаружи останется
      // «открыто», и повторное нажатие не откроет окно снова.
      onClose={onClose}
      // Клик мимо окна. У модального `dialog` подложка — часть самого
      // элемента, поэтому щелчок по ней приходит с `target` равным
      // диалогу. Отступов у него нет намеренно: с ними в эту же ветку
      // попадали бы клики по полям внутри окна.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="modal-title"
      className={cn(
        "m-auto w-[min(44rem,calc(100vw-2rem))] max-h-[min(85dvh,52rem)]",
        "rounded-xl border border-rule bg-paper p-0 text-ink",
        "backdrop:bg-black/60",
        "open:flex open:flex-col",
        className,
      )}
    >
      <header className="flex items-start gap-4 border-b border-rule px-5 py-4">
        <h2 id="modal-title" className="min-w-0 flex-1 text-lg leading-snug">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className={cn(
            "-mr-1 -mt-1 shrink-0 cursor-pointer rounded-sm p-1.5 text-ink-muted",
            "transition-colors hover:bg-paper-sunken hover:text-ink",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
          )}
        >
          <X className="size-4" />
        </button>
      </header>

      {/* `min-h-0` обязателен: без него элемент внутри `flex` не даёт себя
          сжать ниже содержимого, и вместо прокрутки внутри окна страница
          получает окно выше экрана. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}
