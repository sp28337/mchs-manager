import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils/cn";

/**
 * Шапка сайта.
 *
 * --- Что сюда попало и почему -------------------------------------------
 *
 * Шапка — самое дорогое место на странице, и попасть в неё должно только
 * то, что нужно ОТКУДА УГОДНО. Таких вещей три:
 *
 * * знак и название — они же ссылка домой; без неё с калькулятора некуда
 *   вернуться;
 * * переключатель темы — относится к окну, а не к содержимому, и потому
 *   не имеет своего места ни на одной из страниц;
 * * действие страницы (`action`) — на лендинге это переход к расчёту, на
 *   калькуляторе выгрузка профиля в файл. Второе здесь не для симметрии:
 *   данные лежат только в браузере, и очистка кэша стирает год внесённых
 *   отпусков. Кнопка, которая от этого спасает, обязана быть видна не
 *   только в подвале, докуда ещё нужно долистать.
 *
 * Больше ничего. Разделов у сайта два, и меню из двух пунктов — это
 * не навигация, а украшение.
 *
 * --- Почему она не липкая ------------------------------------------------
 *
 * Календарь на год — двенадцать сеток на всю высоту экрана, и полоса,
 * закреплённая сверху, отняла бы у него строку в самом длинном месте.
 */

export interface SiteHeaderProps {
  /** Подпись под названием: чем именно занята эта страница. */
  tagline?: string;
  /** Главное действие страницы. */
  action?: ReactNode;
  className?: string;
}

export function SiteHeader({ tagline, action, className }: SiteHeaderProps) {
  return (
    <header className={cn("border-b border-rule fixed w-full backdrop-blur-xs backdrop-grayscale bg-paper-sunken/80 z-100", className)}>
      <div className="mx-auto flex w-full max-w-[120rem] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5 rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace"
        >
          <Logo className="size-7 text-signal" />
          <span className="leading-none">
            <span className="block font-display text-black/80 dark:text-ink text-sm font-bold uppercase leading-tight tracking-wide group-hover:underline">
              {/* Пробел перед второй строкой намеренный: `block` делит
                  строки визуально, но в тексте они склеиваются, и
                  программа чтения произносит «переработкидля». */}
              Калькулятор переработки{" "}
              <span className="block text-ink-muted">для пожарных</span>
            </span>
          </span>
        </Link>

        {tagline ? (
          <p className="hidden max-w-xs border-l border-rule pl-6 text-xs text-ink-muted lg:block">
            {tagline}
          </p>
        ) : null}

        <div className="ml-auto flex items-center gap-3">
          {action}
        </div>
      </div>
    </header>
  );
}
