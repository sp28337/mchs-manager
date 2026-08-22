"use client";

import { CircleQuestionMark } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useAnchoredPosition } from "@/lib/hooks/use-anchored-position";
import { cn } from "@/lib/utils/cn";

const HINT_WIDTH = 272;

/**
 * Пояснение, свёрнутое в знак вопроса.
 *
 * --- Зачем прятать то, что раньше было видно -----------------------------
 *
 * Каждое поле в боковой колонке сопровождала выноска на три-четыре
 * строки: чем отличается учётный период от месяца, что именно считать
 * окладом, почему отгул работает не как отпуск. Пока это стояло в широком
 * потоке, оно читалось попутно. В колонке шириной в двадцать знаков те же
 * абзацы вытеснили сами поля: экран стал справочником, в котором где-то
 * есть ввод.
 *
 * Текст при этом выбрасывать нельзя — он объясняет, какое число вписать, и
 * без него человек впишет не то. Поэтому он не удалён, а свёрнут: знак
 * вопроса рядом с подписью, по нажатию — карточка возле самого знака.
 *
 * --- Почему не модальное окно --------------------------------------------
 *
 * Модальное окно забирает фокус, гасит страницу и требует закрытия. Для
 * одного абзаца это несоразмерно: человек смотрит подсказку, не отрываясь
 * от поля, которое заполняет, и поле должно оставаться перед глазами.
 *
 * --- Почему текст всё равно всегда в разметке ----------------------------
 *
 * Свёрнутая подсказка остаётся в документе скрытой и связана с кнопкой
 * через `aria-describedby`. Программа чтения экрана произносит её сразу,
 * как только фокус попадает на знак вопроса, — то есть незрячий человек
 * получает пояснение там же, где раньше, и лишнего нажатия ему не нужно.
 * Прятать текст только визуально дешевле, чем городить объявление
 * раскрытой карточки, и надёжнее.
 *
 * --- Закрытие ------------------------------------------------------------
 *
 * Щелчок мимо и Escape, как у всплывающего календаря. Без первого
 * карточка висит над соседним полем, без второго с клавиатуры из неё не
 * выйти.
 */
export function Hint({
  children,
  label = "Пояснение",
  className,
}: {
  children: ReactNode;
  /** Имя кнопки для программы чтения: «?» она произнесла бы как знак. */
  label?: string;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const place = useAnchoredPosition(open, trigger, {
    width: HINT_WIDTH,
    align: "left",
    gap: 6,
  });

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapper} className={cn("relative inline-flex align-middle", className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={(event) => {
          // Подсказка бывает внутри `summary` сворачиваемого блока, и там
          // щелчок по любому месту раскрывает блок. Нажатие на знак
          // вопроса должно показывать пояснение, а не то и другое сразу.
          event.preventDefault();
          event.stopPropagation();
          setOpen((previous) => !previous);
        }}
        className={cn(
          "cursor-pointer rounded-full text-ink-faint transition-colors",
          "hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-trace",
          open && "text-ink",
        )}
      >
        <CircleQuestionMark aria-hidden className="size-4" />
      </button>

      {open ? (
        <span
          id={id}
          role="note"
          style={{
            top: place?.top ?? 0,
            left: place?.left ?? 0,
            width: HINT_WIDTH,
            visibility: place ? "visible" : "hidden",
          }}
          className={cn(
            "fixed z-50 block rounded-sm border border-rule-strong bg-paper-raised",
            "px-3 py-2 text-xs leading-relaxed text-ink shadow-lg",
            // Знак вопроса часто стоит в подписи, набранной прописными и
            // разряженной, — и карточка наследовала это, превращая абзац
            // в крик. Собственная типографика, а не родительская.
            "normal-case tracking-normal",
          )}
        >
          {children}
        </span>
      ) : (
        <span id={id} className="sr-only">
          {children}
        </span>
      )}
    </span>
  );
}
