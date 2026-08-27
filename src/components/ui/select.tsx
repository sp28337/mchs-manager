import { ChevronDown } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Выпадающий список.
 *
 * --- Почему родной `select`, а не свой список ----------------------------
 *
 * Свой список из `div`-ов пришлось бы учить всему, что родной умеет с
 * рождения: открытию с клавиатуры, стрелкам, поиску по первым буквам,
 * закрытию по Esc, возврату фокуса, объявлению «список, 3 из 12» экранным
 * диктором. Каждый из этих пунктов — отдельная возможность сломать выбор
 * периода человеку, который пришёл посмотреть свой график, а не бороться
 * с интерфейсом.
 *
 * Вдобавок на телефоне родной `select` открывает системный барабан —
 * крупный, привычный и попадающий пальцем с первого раза. Сайт читают
 * люди сорока-пятидесяти лет, и это не мелочь.
 *
 * Плата за это одна: раскрытый список рисует операционная система, и
 * подогнать его под палитру сайта нельзя. Тема ему всё же передаётся —
 * `color-scheme` объявлен в `globals.css`, поэтому в тёмной теме список
 * тоже тёмный.
 *
 * --- Почему стрелка нарисована отдельно ----------------------------------
 *
 * `appearance: none` снимает вместе с рамкой и родную стрелку, а без неё
 * поле неотличимо от обычного ввода — человек будет пытаться печатать в
 * него. Стрелка `pointer-events: none`, иначе она перехватывала бы клик у
 * самого поля.
 */
export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          "block h-9 w-full cursor-pointer appearance-none rounded-lg",
          "bg-paper py-1 pl-3 pr-9 border border-paper hover:border-ink-muted",
          "text-sm text-ink transition-colors hover:border-ink-muted",
          "disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
      />
    </div>
  );
}
