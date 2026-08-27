"use client";

import Link from "next/link";

import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { StoredProfile } from "../storage/profile";

/**
 * Подвал рабочего экрана: тема, условия, время последней правки.
 *
 * --- Что отсюда ушло и почему ---------------------------------------------
 *
 * Здесь стоял рассказ о том, где лежат данные, и под ним две кнопки —
 * выгрузка профиля в файл и его удаление с устройства. Ни одной из них тут
 * больше нет, и текста тоже.
 *
 * Рассказ повторял то, что и так сказано на посадочной странице и в
 * условиях использования, — а на рабочем экране, куда человек приходит
 * считать часы, он занимал экран объяснением, которое читают один раз.
 *
 * Кнопки разъехались туда, куда за ними идут. Выгрузка — в шапку: она
 * нужна отовсюду, а не только с самого низа страницы, докуда ещё надо
 * долистать. Удаление — в настройки, рядом со сбросом календаря: это одна
 * и та же мысль «начать заново» на двух глубинах, и выбирать между ними,
 * не видя обеих, было нельзя.
 *
 * Остаётся то, чему место действительно внизу: переключатель темы, ссылки
 * на условия и строка о том, когда профиль сохранялся в последний раз.
 */

export interface ProfileFooterProps {
  profile: StoredProfile;
}

export function ProfileFooter({ profile }: ProfileFooterProps) {
  return (
    <footer className="space-y-4 border-t border-rule py-6 text-sm">
      <div className="flex flex-col md:flex-row-reverse justify-between items-center">
        <div className="flex justify-center pt-8 pb-12 md:ml-auto md:pb-8 ">
          <ThemeToggle/>
        </div>

        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <Link href="/terms" className="text-ink-muted">
            Условия использования
          </Link>
          <Link href="/terms#data" className="text-ink-muted">
            Данные и приватность
          </Link>
          <span>
          Последнее изменение:{" "}
          {new Date(profile.savedAt).toLocaleString("ru-RU", {
            dateStyle: "long",
            timeStyle: "short",
          })}
          .
          </span>
        </p>
      </div>
    </footer>
  );
}
