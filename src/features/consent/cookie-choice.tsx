"use client";

import { Check } from "lucide-react";

import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { cn } from "@/lib/utils/cn";

import { answerCookies, useCookieConsent } from "./cookie-consent";
import { METRIKA_ID } from "@/components/shared/metrika";

/**
 * Настройка счётчика — наверху документа о cookie.
 *
 * --- Почему она здесь, а не в настройках приложения -------------------------
 *
 * Отозвать согласие должно быть так же просто, как дать его (ч. 2 ст. 9
 * 152-ФЗ). Полоса с вопросом исчезает после ответа, и единственное место,
 * где человек потом ищет этот выбор, — документ, в котором о нём написано.
 * Ссылка на него стоит в подвале каждой страницы.
 *
 * --- Почему переключатель, а не две кнопки ---------------------------------
 *
 * Потому что это выбор одного из двух положений, а не два действия: занято
 * всегда ровно одно, и видно какое. Тот же переключатель, что у темы и у
 * вида сетки (`ui/segmented.tsx`).
 */
export function CookieChoice() {
  const { choice, at } = useCookieConsent();

  if (METRIKA_ID === undefined) {
    return (
      <p className="rounded-xl border border-rule bg-paper-raised px-4 py-3 text-sm text-ink-muted">
        В этой сборке сайта счётчика посещений нет: выбирать нечего, и
        аналитические cookie не ставятся.
      </p>
    );
  }

  return (
    <div className="lit space-y-3 rounded-xl bg-paper-raised px-5 py-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-ink">Счётчик посещений</h2>
        <p className="text-xs leading-5 text-ink-muted">
          Выбор применяется сразу. «Только необходимое» означает, что счётчик
          больше не загрузится; уже поставленные им cookie удаляются
          средствами браузера.
        </p>
      </div>

      <Segmented label="Согласие на аналитику" className="w-full max-w-md">
        <SegmentedItem
          active={choice === "necessary"}
          onClick={() => answerCookies("necessary")}
          className="flex-1"
        >
          Только необходимое
        </SegmentedItem>
        <SegmentedItem
          active={choice === "all"}
          onClick={() => answerCookies("all")}
          className="flex-1"
        >
          Согласен на аналитику
        </SegmentedItem>
      </Segmented>

      <p className={cn("flex items-center gap-1.5 text-xs", choice === null ? "text-ink-faint" : "text-ink-muted")}>
        {choice === null ? (
          "Вы ещё не отвечали — до ответа счётчик не загружается."
        ) : (
          <>
            <Check aria-hidden className="size-3.5 shrink-0 text-verify" />
            {/* Точка после «г.» своя не ставится: её уже поставил
                сокращённый год. */}
            {`Ответ сохранён${при(at)} Сменить его можно в любой момент.`}
          </>
        )}
      </p>
    </div>
  );
}

/** « 15 октября 2026 г.» или пусто, если даты нет. */
function при(время: string): string {
  if (время === "") return "";

  const дата = new Date(время);

  if (Number.isNaN(дата.getTime())) return "";

  return ` ${дата.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}.`;
}
