"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * FE003 — переключатель темы.
 *
 * DoD: «переключение темы меняет цвета без перезагрузки страницы».
 *
 * `mounted` нужен потому, что на сервере тема неизвестна: разметка,
 * отрисованная с иконкой светлой темы, разошлась бы с браузером, где
 * выбрана тёмная. До монтирования отдаётся кнопка-заглушка того же
 * размера — так не прыгает вёрстка (`rendering-hydration-no-flicker`).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const dark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}
    >
      {mounted ? (
        dark ? (
          <Sun aria-hidden />
        ) : (
          <Moon aria-hidden />
        )
      ) : (
        <span className="size-4" />
      )}
    </Button>
  );
}
