"use client";

import { cn } from "@/lib/utils/cn";

/**
 * Переключатель одного состояния — включено или нет.
 *
 * --- Почему не флажок и не две кнопки ------------------------------------
 *
 * Флажок отвечает на вопрос «отметить ли»: он про выбор в списке. Здесь
 * вопрос другой — «включить ли режим», и ответ виден мгновенно на самом
 * экране: сетка и числа меняются под ним. Тумблер это и говорит формой:
 * положение кружка — состояние, а не галочка о согласии.
 *
 * --- Почему `role="switch"`, а не `checkbox` -----------------------------
 *
 * Программа чтения экрана произносит «переключатель, включён» вместо
 * «флажок, отмечен». Разница не косметическая: «отмечен» подразумевает,
 * что где-то есть кнопка применения, а её нет — режим включается сразу.
 *
 * --- Почему подпись обязательна ------------------------------------------
 *
 * Тумблер без подписи — это загадка: два положения, и ни одно не
 * называет, чем они отличаются. Подпись входит в компонент, а не
 * оставляется вызывающему, чтобы её нельзя было забыть.
 */
export function Switch({
  checked,
  onChange,
  label,
  spread,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Что включает этот тумблер. Произносится вместе с состоянием. */
  label: string;
  /**
   * Подпись слева, дорожка справа, во всю ширину строки.
   *
   * Для строк настроек, где слева стоит вопрос, а справа ответ: тумблер
   * там такой же ответ, как список или поле, и вставать он обязан на то же
   * место. Обычный порядок — дорожка, потом подпись — остаётся умолчанием:
   * в строке легенды или рядом с кнопкой тумблер читается слева направо.
   */
  spread?: boolean;
  className?: string;
}) {
  /* Дорожка и кружок. Размеры кратны четырём точкам, чтобы кружок стоял
     ровно посередине в обоих положениях: 36 − 2×2 − 20 = 12 — столько он и
     проезжает. */
  const track = (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-6 w-9 shrink-0 items-center rounded-full",
        "transition-colors",
        checked ? "bg-verify/25" : "bg-paper-sunken group-hover:border-ink-muted",
      )}
    >
      <span
        className={cn(
          "absolute size-4 rounded-full transition-transform duration-200",
          "left-1",
          checked ? "translate-x-3 bg-verify" : "translate-x-0 bg-ink-faint",
        )}
      />
    </span>
  );

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "group inline-flex cursor-pointer items-center gap-2 rounded-xl",
        "text-sm text-ink transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
        spread ? "w-full justify-between" : "shrink-0",
        className,
      )}
    >
      {spread ? (
        <>
          {label}
          {track}
        </>
      ) : (
        <>
          {track}
          {label}
        </>
      )}
    </button>
  );
}
