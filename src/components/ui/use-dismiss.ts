import { useEffect, type RefObject } from "react";

/**
 * Закрыть раскрытое окошко всеми способами, какими оно обязано
 * закрываться: `Esc`, нажатие мимо и уход фокуса за его пределы. Те же
 * три, что у меню в шапке (`shared/header-menu.tsx`).
 *
 * Принимает сам установщик состояния, а не обёртку над ним: установщик у
 * React постоянный, и подписка не перевешивается на каждой отрисовке.
 */
export function useDismiss(
  open: boolean,
  setOpen: (open: boolean) => void,
  nest: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;

    const мимо = (событие: Event) => {
      if (!nest.current?.contains(событие.target as Node)) setOpen(false);
    };
    const клавиша = (событие: KeyboardEvent) => {
      if (событие.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", мимо);
    document.addEventListener("focusin", мимо);
    document.addEventListener("keydown", клавиша);

    return () => {
      document.removeEventListener("pointerdown", мимо);
      document.removeEventListener("focusin", мимо);
      document.removeEventListener("keydown", клавиша);
    };
  }, [open, setOpen, nest]);
}
