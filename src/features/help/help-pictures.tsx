import { Gift } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Детали пиктограмм справки.
 *
 * Пиктограмма здесь — не картинка «в общем виде», а тот самый элемент
 * приложения, только крупнее: клетка собрана теми же цветами и той же
 * буквой, что на сетке (`day-marks.ts`), знак нижнего ряда — тем же знаком.
 * Человек учит справкой то, что потом ищет глазами в приложении, и если
 * нарисованное расходится с настоящим, он не узнает ни то, ни другое.
 *
 * Все пиктограммы декоративны для программы чтения (`aria-hidden` ставит
 * строка справки): заголовок и текст рядом называют то же словами.
 */

/**
 * Клетка сетки в рост текста: число суток, под ним буква или часы — как в
 * настоящей клетке (`shift-strip.tsx`).
 *
 * Свет (`lit-tile`) на обёртке, а цвет, рамка и отметка «сегодня» — на
 * внутреннем квадрате, как и на сетке: свет рисуется тенью, и на одном
 * элементе с красным контуром сегодняшних суток он бы этот контур стёр.
 */
export function CellPicture({
  date = "12",
  mark,
  tone,
  className,
  innerClassName,
  children,
}: {
  date?: string;
  /** Буква или часы под числом. */
  mark?: ReactNode;
  /** Цвет, рамка и буква вида суток из общего словаря (`day-marks.ts`). */
  tone: string;
  /** На обёртку: наклон, тень. */
  className?: string;
  /** На квадрат с цветом: отметка «сегодня». */
  innerClassName?: string;
  /** Угловые метки поверх клетки: праздник, заметка. */
  children?: ReactNode;
}) {
  return (
    <span
      className={cn("lit-tile relative block size-20 shrink-0 rounded-md bg-paper-raised", className)}
    >
      <span
        className={cn(
          "absolute inset-0 flex flex-col items-center justify-center",
          "rounded-md border font-mono leading-tight",
          tone,
          innerClassName,
        )}
      >
        {children}
        <span className="text-xl">{date}</span>
        {mark === undefined ? null : <span className="text-sm">{mark}</span>}
      </span>
    </span>
  );
}

/** Значок праздника в углу клетки — тот же серый подарок, что на сетке. */
export function HolidayCorner() {
  return <Gift aria-hidden className="absolute top-1.5 right-1.5 size-5 text-ink/32" />;
}

/** Уголок заметки — маленький треугольник, как в клетке. */
export function NoteCorner() {
  return (
    <span
      aria-hidden
      className="absolute top-0 right-0 size-0 border-t-[16px] border-l-[16px] border-l-transparent border-t-trace"
    />
  );
}

/** Несколько пиктограмм в ряд или сеткой — для видов, что идут группой. */
export function PictureGroup({
  columns,
  children,
}: {
  columns?: 2 | 3;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex items-center justify-center gap-2",
        columns !== undefined && "grid",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-3",
      )}
    >
      {children}
    </span>
  );
}
