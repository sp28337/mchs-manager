import type { ReactNode } from "react";

import { HEADER_WORD } from "@/components/shared/header-action";
import { cn } from "@/lib/utils/cn";

/**
 * Знак нижнего ряда: значок без плашки, а на широком экране — с подписью,
 * которая выезжает при наведении.
 *
 * --- Почему без плашки и без подписи ---------------------------------------
 *
 * Ряд стоит поверх сетки, у самой нижней кромки окна, и плашки с
 * подписями под ним читались бы отдельной панелью, положенной на
 * страницу. Знаки без подложки — как легенда и тема, стоявшие в углах
 * раньше всех, — лежат на бумаге и не спорят с сеткой.
 *
 * --- Почему подпись выезжает, а не всплывает ------------------------------
 *
 * Всплывающая подсказка ложится поверх соседа и закрывает его. Подпись,
 * которая раздвигает ряд, не закрывает ничего: соседи справа отъезжают
 * ровно на её ширину и возвращаются, когда курсор уходит. И читается она
 * тем же голосом, что «ГРАФИК» в знаке сайта (`HEADER_WORD`): это имя
 * органа управления, а не пояснение к нему.
 *
 * Ширина анимируется через колонку сетки (`0fr` → `1fr`): у `width: auto`
 * перехода нет, а подобранная на глаз ширина обрезала бы длинные слова.
 * Ход — мягкий на обоих концах: подпись трогается плавно и так же плавно
 * встаёт.
 *
 * Только с `md` и только у устройств с наведением (`hover:` в Tailwind 4
 * само ограничено `(hover: hover)`): на телефоне наводить нечем, а ряд там
 * и так занимает всю ширину. С клавиатуры подпись выезжает по фокусу —
 * иначе человек без мыши никогда бы её не увидел.
 */

/**
 * Гнездо знака: держит наведение (`group/knob`) — и на самом знаке, и на
 * раскрытом из него окошке, чтобы подпись не убегала, пока в окошке
 * выбирают.
 *
 * `pointer-events-auto` — ряд лежит поверх страницы прозрачной полосой во
 * всю ширину и сам нажатий не ловит; ловят только знаки.
 */
export const KNOB_NEST = "group/knob pointer-events-auto relative flex shrink-0";

/**
 * Сама кнопка. Место под палец — 44 точки (`KNOB_ICON`), значок в нём —
 * 28, как знак сайта: ряд читается одним набором с шапкой.
 */
export const KNOB = cn(
  "group/press flex h-11 cursor-pointer items-center rounded-xl",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
);

/** Клетка значка: 44 точки, значок в 28 посередине. */
export const KNOB_ICON = "grid size-11 shrink-0 place-items-center [&_svg]:size-7";

/** Мягкий ход на обоих концах — трогается и встаёт без рывка. */
const ХОД = "duration-[420ms] ease-[cubic-bezier(0.65,0,0.35,1)]";

/** Подпись знака: выезжает вправо при наведении или фокусе с клавиатуры. */
export function KnobLabel({ children }: { children: ReactNode }) {
  return (
    // Для программы чтения подпись лишняя: имя у кнопки своё
    // (`aria-label`), и подпись повторила бы его второй раз.
    <span
      aria-hidden
      className={cn(
        "grid grid-cols-[0fr] transition-[grid-template-columns]",
        ХОД,
        "md:group-hover/knob:grid-cols-[1fr] md:group-focus-visible/press:grid-cols-[1fr]",
      )}
    >
      <span className="min-w-0 overflow-hidden">
        <span
          className={cn(
            HEADER_WORD,
            // Поле слева — тот же просвет, что между знаком сайта и
            // «ГРАФИК» в шапке (`gap-2.5`): клетка значка уже даёт 8 точек
            // справа от рисунка, ещё две — здесь.
            "block pl-0.5 pr-3",
            "-translate-x-2 opacity-0 transition-[translate,opacity]",
            ХОД,
            "md:group-hover/knob:translate-x-0 md:group-hover/knob:opacity-100",
            "md:group-focus-visible/press:translate-x-0 md:group-focus-visible/press:opacity-100",
          )}
        >
          {children}
        </span>
      </span>
    </span>
  );
}

/**
 * Окошко, раскрытое из знака нижнего ряда, — вверх, потому что ряд стоит у
 * нижней кромки окна. Та же кайма и тень, что у окон приложения
 * (`modal-lift`).
 */
export const KNOB_POPOVER = cn(
  "modal-lift absolute bottom-full mb-2 max-w-[calc(100vw-3rem)]",
  "overflow-y-auto rounded-xl bg-paper-raised",
);

/** Строка выбора в окошке: значок, слово, галочка у выбранного. */
export function knobOption(active: boolean): string {
  return cn(
    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2",
    "text-left text-sm transition-colors hover:bg-paper-sunken",
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
    // Значки — в девять десятых рема, как на кнопках шапки: доли кольца
    // периода в шестнадцати точках уже не различить.
    "[&_svg]:size-4.5 [&_svg]:shrink-0",
    active ? "bg-paper-sunken font-medium text-ink" : "text-ink-muted",
  );
}
