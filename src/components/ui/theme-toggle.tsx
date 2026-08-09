"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Переключатель темы.
 *
 * --- Почему три положения, а не тумблер ---------------------------------
 *
 * «Как в системе» — не то же самое, что светлая: человек, у которого
 * телефон темнеет вечером, ожидает того же и здесь. Тумблер из двух
 * положений это состояние теряет, и вернуться к нему потом нельзя.
 *
 * --- Почему до монтирования рисуется заглушка ---------------------------
 *
 * Тема известна только в браузере: на сервере нет ни `localStorage`, ни
 * системной настройки. Нарисовать на сервере догадку — значит получить
 * ошибку гидратации и подсвеченную не ту кнопку в первый момент. Место
 * при этом занимается сразу, чтобы соседние элементы не прыгнули.
 */

const OPTIONS = [
  { value: "light", label: "Светлая", Icon: Sun },
  { value: "dark", label: "Тёмная", Icon: Moon },
  { value: "system", label: "Как в системе", Icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Тема известна только в браузере, и узнать об этом можно не раньше
  // монтирования — другого способа отличить сервер от клиента нет.
  // Правило запрещает синхронный `setState` в эффекте из-за лишнего
  // прогона отрисовки; здесь он однократный и оправдан.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  return (
    <fieldset
      className="flex items-center gap-0.5 rounded-xl border border-rule p-0.5"
      aria-label="Тема оформления"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={mounted ? active : undefined}
            className={cn(
              "flex size-7 items-center justify-center rounded-xl",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-trace",
              active ? "bg-ink text-paper" : "text-ink-muted hover:text-ink",
            )}
            onClick={() => setTheme(value)}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </fieldset>
  );
}
