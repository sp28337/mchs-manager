"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { CookieCategories, COOKIE_BUTTON } from "@/features/consent/cookie-categories";
import { answerCookies, useCookieConsent } from "@/features/consent/cookie-consent";
import { METRIKA_ID } from "@/components/shared/metrika";
import { cn } from "@/lib/utils/cn";

/**
 * Панель управления cookie — один раз на браузер.
 *
 * --- Почему она вообще есть -------------------------------------------------
 *
 * Счётчик посещений ставит cookie и собирает IP-адрес: это согласие
 * (п. 1 ч. 1 ст. 6 152-ФЗ), и оно должно быть конкретным, информированным и
 * данным ДО обработки (ч. 1 ст. 9). Поэтому счётчик не загружается, пока
 * человек не ответил, а не «загружается, пока не отказался».
 *
 * --- Почему три действия ----------------------------------------------------
 *
 * «Принять все» и «Только необходимые» — два ответа одним нажатием, равные
 * по размеру: отказ даётся так же просто, как согласие. «Настроить» — третий
 * путь для тех, кому нужно прочитать, что именно входит в категории, и
 * решить по ним: он открывает те же две категории, что и страница
 * `/cookies`, и аналитика там выключена, пока её не включили сами.
 *
 * --- Почему без затемнения и ловушки фокуса ---------------------------------
 *
 * Панель не окно: читать страницу и считать часы можно, не отвечая. Она не
 * перехватывает ни фокус, ни прокрутку и стоит в конце разметки — последней
 * и для клавиатуры, и для программы чтения. Фокус переносится только внутри
 * неё самой: на заголовок настройки и обратно на «Настроить».
 *
 * --- Чего она не делает -----------------------------------------------------
 *
 * Не появляется там, где счётчика нет: без `NEXT_PUBLIC_METRIKA_ID` спрашивать
 * не о чем, и спрашивать значило бы врать.
 */
export function CookieBanner() {
  const { choice } = useCookieConsent();
  const [settings, setSettings] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  /** Первая отрисовка фокус не двигает: человек его сюда не приглашал. */
  const moved = useRef(false);

  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }

    (settings ? heading.current : opener.current)?.focus();
  }, [settings]);

  if (METRIKA_ID === undefined || choice !== null) return null;

  return (
    <div
      role="region"
      aria-label="Файлы cookie и счётчик посещений"
      className={cn(
        // Поверх всего, включая нижнюю панель телефона: ответ нужен один
        // раз, и пока его нет, панель — самое нижнее, что есть на экране.
        "fixed inset-x-0 bottom-0 z-110 p-3",
        "pb-[calc(0.75rem+var(--safe-bottom))]",
        // Обёртка растянута во всю ширину, а карточка в ней — узкая и по
        // середине. Поля по бокам пусты на вид, но нажатия ловили именно
        // они: в этих полях стоят знаки по углам окна (легенда и тема), и
        // пока на панель не ответили, они не нажимались вовсе. Поэтому
        // обёртка нажатий не берёт, а карточка берёт.
        "pointer-events-none",
      )}
    >
      <div
        className={cn(
          "pointer-events-auto modal-lift mx-auto w-full max-w-4xl rounded-xl bg-paper-raised",
          // Настройка выше строки с кнопками: на низком экране она
          // прокручивается внутри карточки, а не уезжает за кромку.
          "max-h-[calc(100dvh-1.5rem)] overflow-y-auto",
        )}
      >
        {settings ? (
          <div className="space-y-4 px-5 py-4">
            <button
              type="button"
              onClick={() => setSettings(false)}
              className={cn(
                "cursor-pointer rounded-xs text-sm text-ink-muted transition-colors hover:text-ink",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
              )}
            >
              ← Назад
            </button>

            <h2
              ref={heading}
              tabIndex={-1}
              className="text-lg font-medium text-ink focus:outline-none"
            >
              Настройка файлов cookie
            </h2>

            <CookieCategories
              analytics={false}
              onSave={(analytics) => answerCookies(analytics ? "all" : "necessary")}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
            {/* Что и зачем и что решать человеку — в одном абзаце; ссылки на
                подробности — внутри него же. Ответ не должен зависеть от
                того, что их открыли. */}
            <p className="min-w-0 flex-1 text-pretty text-sm leading-6 text-ink-muted">
              Сайт использует cookie для работы. Яндекс Метрику (аналитику)
              включаем только с вашего согласия. Подробнее — в{" "}
              <Link href="/privacy" className="text-ink underline hover:no-underline">
                политике конфиденциальности
              </Link>{" "}
              и{" "}
              <Link href="/cookies" className="text-ink underline hover:no-underline">
                документе о cookie
              </Link>
              .
            </p>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => answerCookies("all")}
                className={cn(COOKIE_BUTTON, "bg-ink text-paper hover:opacity-90")}
              >
                Принять все
              </button>
              <button
                type="button"
                onClick={() => answerCookies("necessary")}
                className={cn(
                  COOKIE_BUTTON,
                  "border border-rule-strong text-ink hover:bg-paper-sunken",
                )}
              >
                Только необходимые
              </button>
              <button
                ref={opener}
                type="button"
                onClick={() => setSettings(true)}
                className={cn(
                  COOKIE_BUTTON,
                  "px-2 text-ink-muted underline hover:text-ink hover:no-underline",
                )}
              >
                Настроить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
