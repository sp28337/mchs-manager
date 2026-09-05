import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Появление не мгновенной прозрачностью, а лёгкой расфокусировкой,
 * оседающей в резкость вместе с ней, — как будто собирается ветром, а не
 * просто проявляется.
 *
 * --- Почему это не одна прозрачность --------------------------------------
 *
 * Обычный переход прозрачности превращает «не было» в «есть» одним и тем
 * же числом на всём пути: в середине хода различимо ровно то же самое,
 * только вполсилы. Резкость добавляет второе измерение — то, что появилось,
 * ещё и НАВОДИТСЯ на фокус, — и середина хода читается как момент, когда
 * что-то складывается, а не просто гаснет и включается.
 *
 * Используется везде, где страница на телефоне называет себя заново:
 * слово рядом со знаком сайта, значок кнопки настроек, закладки на месте
 * цифр, анкета на месте графика (`site-header.tsx`, `header-tools.tsx`,
 * `period-summary.tsx`, `workspace.tsx`). Один приём на все — чтобы это
 * читалось одним превращением, а не пятью разными.
 */
export function Materialize({
  show,
  children,
  className,
  durationClassName = "duration-300",
  blurClassName = "blur-[6px]",
  ariaHidden,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
  /** Длительность — своя у каждого места, отсюда и проп, а не константа. */
  durationClassName?: string;
  /** Насколько мутно то, что ещё не проступило. */
  blurClassName?: string;
  /**
   * Читать ли текст программе чтения. Нужен, когда `Materialize` стоит в
   * стопке — гаснущее и проступающее лежат в одной ячейке грида, и без
   * метки читалка озвучивала бы оба сразу (`site-header.tsx`).
   */
  ariaHidden?: boolean;
}) {
  return (
    <span
      aria-hidden={ariaHidden}
      className={cn(
        "inline-block transition-[opacity,filter] ease-out",
        durationClassName,
        show ? "opacity-100 blur-none" : cn("opacity-0", blurClassName),
        className,
      )}
    >
      {children}
    </span>
  );
}
