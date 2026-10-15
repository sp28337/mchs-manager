"use client";

import Link from "next/link";

import { answerCookies, useCookieConsent } from "@/features/consent/cookie-consent";
import { METRIKA_ID } from "@/components/shared/metrika";
import { cn } from "@/lib/utils/cn";

/**
 * Полоса с вопросом про аналитику — один раз на браузер.
 *
 * --- Почему она вообще есть -------------------------------------------------
 *
 * Счётчик посещений ставит cookie и собирает IP-адрес: это согласие
 * (п. 1 ч. 1 ст. 6 152-ФЗ), и оно должно быть конкретным, информированным и
 * данным ДО обработки (ч. 1 ст. 9). Поэтому счётчик не загружается, пока
 * человек не ответил, а не «загружается, пока не отказался».
 *
 * --- Почему два равных ответа, а не кнопка «Принять» ------------------------
 *
 * Отказ должен даваться так же просто, как согласие: кнопка «Принять» и
 * ссылка «настройки» мелким шрифтом — это не выбор, а его видимость.
 * Поэтому две кнопки рядом, одними словами и одного размера. Залита
 * чернилами всё же одна — согласие: оно действие, а отказ — отказ от
 * действия.
 *
 * --- Почему без затемнения и ловушки фокуса ---------------------------------
 *
 * Полоса не окно: читать страницу и считать часы можно, не отвечая. Она не
 * перехватывает ни фокус, ни прокрутку и стоит в конце разметки — последней
 * и для клавиатуры, и для программы чтения.
 *
 * --- Чего она не делает -----------------------------------------------------
 *
 * Не появляется там, где счётчика нет: без `NEXT_PUBLIC_METRIKA_ID` спрашивать
 * не о чем, и спрашивать значило бы врать.
 */
export function CookieBanner() {
  const { choice } = useCookieConsent();

  if (METRIKA_ID === undefined || choice !== null) return null;

  return (
    <div
      role="region"
      aria-label="Файлы cookie и счётчик посещений"
      className={cn(
        // Поверх всего, включая нижнюю панель телефона: ответ нужен один
        // раз, и пока его нет, полоса — самое нижнее, что есть на экране.
        "fixed inset-x-0 bottom-0 z-110 p-3",
        "pb-[calc(0.75rem+var(--safe-bottom))]",
      )}
    >
      <div
        className={cn(
          "modal-lift mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-xl",
          "bg-paper-raised px-5 py-4 sm:flex-row sm:items-center",
        )}
      >
        <p className="min-w-0 flex-1 text-sm leading-6 text-ink-muted">
          Сайт считает посещения — это обезличенный счётчик Яндекс Метрики. Без
          вашего согласия он не загружается. Что именно он собирает и как
          отказаться потом —{" "}
          <Link href="/cookies" className="text-ink underline hover:no-underline">
            в документе о cookie
          </Link>
          .
        </p>

        <div className="grid shrink-0 grid-cols-2 gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => answerCookies("necessary")}
            className={cn(КНОПКА, "border border-rule-strong text-ink hover:bg-paper-sunken")}
          >
            Только необходимое
          </button>
          <button
            type="button"
            onClick={() => answerCookies("all")}
            className={cn(КНОПКА, "bg-ink text-paper hover:opacity-90")}
          >
            Согласен
          </button>
        </div>
      </div>
    </div>
  );
}

const КНОПКА = cn(
  "inline-flex h-9 cursor-pointer items-center justify-center whitespace-nowrap",
  "rounded-xl px-4 text-sm font-medium transition-colors",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
);
