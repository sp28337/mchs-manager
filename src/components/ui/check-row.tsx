"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Флажок с отметкой слева и текстом справа — для согласий и условий.
 *
 * --- Чем он отличается от `Checkbox` ---------------------------------------
 *
 * `Checkbox` (`ui/checkbox.tsx`) — строка настроек: подпись слева, отметка
 * справа, нажимается вся строка, подпись — слово. Для согласия он не годится
 * по двум причинам. Во-первых, привычное место отметки в таких формах —
 * слева, перед фразой, которая её поясняет: глаз читает «отметка → что я
 * подтверждаю». Во-вторых, внутри фразы стоят ссылки на документы, а ссылка
 * внутри `<button>` — вложенный интерактивный элемент, невалидный и для
 * клавиатуры, и для программы чтения.
 *
 * Поэтому здесь настоящий `<input type="checkbox">` под `<label>`: нажатие по
 * тексту ставит отметку, а нажатие по ссылке внутри текста открывает
 * документ и отметку не трогает (так устроена привязка подписи к флажку:
 * вложенные ссылки и кнопки свою работу делают сами).
 *
 * Сам `<input>` скрыт визуально, а не убран (`sr-only`): он остаётся в порядке
 * обхода клавишей, читается как флажок с состоянием, а видимую отметку
 * рисует соседний квадрат. Фокус с клавиатуры показывается обводкой этого
 * квадрата (`peer-focus-visible`).
 *
 * Цвета те же, что у `Checkbox`: отмеченный — зелёный, каким на сетке
 * отмечены смены; пустой — утопленная бумага в тонком контуре.
 */
export function CheckRow({
  checked,
  onChange,
  children,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Что человек подтверждает этой отметкой. Может содержать ссылки. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "group flex cursor-pointer items-start gap-3 text-sm leading-5 text-ink-muted",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-sm border",
          "transition-colors",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink",
          checked
            ? "border-verify bg-verify text-paper"
            : "border-ink-faint/70 bg-paper text-transparent group-hover:border-ink-muted",
        )}
      >
        {/* Галочка стоит всегда, но у пустого флажка она цвета пустоты: квадрат
            не меняет размера в момент отметки. */}
        <Check aria-hidden className="size-3.5" strokeWidth={3} />
      </span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}
