import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Детали «карточки действия» — окна, которое спрашивает или просит одно.
 *
 * --- Что это и зачем -------------------------------------------------------
 *
 * Окно подтверждения, окно сохранения, окно срока — одного рода: человек
 * нажал кнопку, а приложение переспрашивает или уточняет, и от ответа зависит,
 * что произойдёт. Раньше такое окно было заголовком с крестиком над двумя
 * кнопками, набранными тем же шрифтом, что и всё вокруг, — оно не отличалось
 * от формы, и по виду нельзя было понять, чем оно кончится: сохранит
 * безобидный файл или сотрёт график.
 *
 * Теперь у такого окна три приметы:
 *
 * * **Плитка слева от заголовка** — тем же языком, каким в календаре
 *   нарисованы клетки: квадрат с рамкой, мягкой заливкой и знаком. Цвет плитки
 *   отвечает на вопрос «чем это кончится»: серая — ничего необратимого, зелёная
 *   — человек получает то, ради чего пришёл (файл, сохранённый график), красная
 *   — что-то будет стёрто. Тот же красный, что у переработки и отказа: сигнал в
 *   этом приложении один.
 * * **Заголовок и строка под ним** — что случится. Прописные узкой гарнитурой
 *   названий, как у подписей под числами итога, а под ним обычным шрифтом —
 *   последствие, которое раньше приходилось выискивать в теле.
 * * **Нижняя полоса с кнопками** — тоном глубже тела окна. Не линия поперёк
 *   (линовка здесь живёт внутри карточек), а смена тона; и она стоит вне
 *   прокручиваемого тела, так что ответ всегда на виду.
 *
 * Плитке нарочно не дана кайма от лампы (`lit-tile`): окно само ближайшая к
 * курсору поверхность со светом, и плашки внутри него эту роль забирать не
 * должны (`panel.tsx`).
 */

/** Смысл окна — от него цвет плитки и налёт на шапке. */
export type DialogTone = "neutral" | "verify" | "signal";

/** Плитка: рамка, заливка и цвет знака. Токены те же, что у клеток графика. */
const TILE_TONE: Record<DialogTone, string> = {
  neutral: "border-rule bg-paper text-ink-muted",
  verify: "border-verify/40 bg-verify-soft text-verify",
  signal: "border-signal/40 bg-signal-soft text-signal",
};

/**
 * Налёт цвета смысла на шапке: едва заметный и гаснущий к телу окна.
 *
 * Серому окну он ни к чему — у него и так нечем выделяться, — а у зелёного и
 * красного говорит то же, что плитка, второй раз и крупнее: плитка видна, когда
 * на неё смотрят, налёт — краем глаза, когда окно только раскрылось.
 */
export const HEAD_TINT: Record<DialogTone, string> = {
  neutral: "",
  verify: "bg-linear-to-b from-verify/10 to-transparent",
  signal: "bg-linear-to-b from-signal/10 to-transparent",
};

/** Знак действия плиткой. Только для глаза: слова рядом говорят то же. */
export function DialogTile({ tone, children }: { tone: DialogTone; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-xl border [&_svg]:size-5",
        TILE_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * Кнопки нижней полосы: справа и в одну строку, а на телефоне — столбиком
 * во всю ширину, и главная сверху.
 *
 * Порядок в разметке — «второстепенная, главная»: так клавиатура идёт от
 * отказа к согласию, а на телефоне `flex-col-reverse` ставит главную первой,
 * где под большой палец. С `sm` строка прямая, и главная справа — там, где её
 * ждут от окна, закрывающегося движением «вперёд».
 */
export function DialogActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
      {children}
    </div>
  );
}

const BUTTON =
  "inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 " +
  "font-display text-sm font-bold uppercase tracking-wide whitespace-nowrap transition-colors " +
  "max-sm:h-11 max-sm:w-full disabled:pointer-events-none disabled:opacity-50 " +
  "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

const BUTTON_VARIANT = {
  /** Основное действие окна: чернила на бумаге, единственное залитое пятно. */
  primary: "bg-ink text-paper hover:bg-ink/85",
  /** Действие, которое стирает: сигнальный цвет, как у плитки такого окна. */
  danger: "bg-signal text-white hover:bg-signal/85",
  /** Всё остальное — вполголоса: отказ, второй путь. */
  quiet: "text-ink-muted hover:bg-paper hover:text-ink",
} as const;

export type DialogButtonVariant = keyof typeof BUTTON_VARIANT;

/**
 * Кнопка окна. Тем же голосом, что подписи и меню шапки: узкая гарнитура
 * названий, прописные, разрядка. Своя, а не общая `Button`: у той углы в
 * две точки и обычный шрифт — она живёт в формах на странице, а окну нужна
 * кнопка с размером под палец (44 на телефоне) и под плитку рядом (скругление
 * то же, что у неё).
 */
export function DialogButton({
  variant = "quiet",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: DialogButtonVariant }) {
  return <button type={type} className={cn(BUTTON, BUTTON_VARIANT[variant], className)} {...props} />;
}
