"use client";

import { useState } from "react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils/cn";

/**
 * Настройка cookie по категориям: «Необходимые» и «Аналитические».
 *
 * Одна на два места — панель внизу страницы (`shared/cookie-banner.tsx`) и
 * блок над документом о cookie (`cookie-choice.tsx`): выбор должен выглядеть
 * и работать одинаково там, где его дают, и там, где его меняют.
 *
 * --- Почему «Необходимые» не переключаются ----------------------------------
 *
 * Без них сайт не работает, и согласия они не требуют (см.
 * `docs/legal/cookies.md`, раздел 1). Выключатель, который нельзя
 * выключить, обещал бы выбор, которого нет, — поэтому вместо него надпись.
 *
 * --- Почему аналитика выключена, пока человек не включил --------------------
 *
 * Согласие должно быть однозначным (ч. 1 ст. 9 152-ФЗ): отметка, стоявшая
 * заранее, — это молчание, принятое за «да». Исходное положение берётся из
 * прежнего ответа человека, а если ответа не было — выключено.
 *
 * --- Почему кнопка «Сохранить», а не мгновенное применение ------------------
 *
 * Человек выбирает категории и подтверждает выбор разом; ответ записывается
 * один раз и с датой. Переключатель сам по себе ничего не записывает.
 */

/** Кнопка панели: одного вида в баннере и в настройке на странице. */
export const COOKIE_BUTTON = cn(
  "inline-flex h-9 cursor-pointer items-center justify-center whitespace-nowrap",
  "rounded-xl px-4 text-sm font-medium transition-colors",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
);

export function CookieCategories({
  analytics,
  onSave,
}: {
  /** Прежний ответ: включена ли аналитика. */
  analytics: boolean;
  /** Что человек подтвердил кнопкой «Сохранить настройки». */
  onSave: (analytics: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(analytics);

  return (
    <div className="space-y-3">
      <section className="space-y-1 rounded-xl border border-rule px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-medium text-ink">Необходимые</h3>
          <span className="text-xs text-ink-faint">Всегда включены</span>
        </div>
        <p className="text-xs leading-5 text-ink-muted">
          Необходимы для корректной работы сайта и сохранения пользовательских
          настроек: вход в учётную запись, тема оформления, ваши графики на этом
          устройстве.
        </p>
      </section>

      <section className="space-y-1 rounded-xl border border-rule px-4 py-3">
        <Switch
          spread
          checked={enabled}
          onChange={setEnabled}
          label={<span className="font-medium">Аналитические</span>}
        />
        <p className="text-xs leading-5 text-ink-muted">
          Яндекс Метрика помогает анализировать посещаемость и улучшать сайт.
          Собирает обезличенные данные: тип устройства, посещённые страницы,
          источник перехода, примерное местоположение (регион). Яндекс
          обрабатывает их как самостоятельный оператор.
        </p>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSave(enabled)}
          className={cn(COOKIE_BUTTON, "bg-ink text-paper hover:opacity-90")}
        >
          Сохранить настройки
        </button>
      </div>
    </div>
  );
}
