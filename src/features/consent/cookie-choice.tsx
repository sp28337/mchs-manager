"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils/cn";

import { CookieCategories } from "./cookie-categories";
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
 * --- Почему те же категории, что в панели внизу страницы --------------------
 *
 * Отозвать согласие надо теми же средствами, какими его дали: здесь стоит
 * тот же блок «Необходимые» / «Аналитические» с кнопкой «Сохранить
 * настройки» (`cookie-categories.tsx`), что и в панели.
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
        <h2 className="text-sm font-medium text-ink">Настройка файлов cookie</h2>
        <p className="text-xs leading-5 text-ink-muted">
          Выбор применяется сразу после сохранения. Если аналитика выключена,
          счётчик больше не загрузится; уже поставленные им cookie удаляются
          средствами браузера.
        </p>
      </div>

      {/* Ключ — прежний ответ: сменился он в другой вкладке, и переключатель
          встаёт в новое положение, а не остаётся в устаревшем. */}
      <CookieCategories
        key={choice ?? "none"}
        analytics={choice === "all"}
        onSave={(analytics) => answerCookies(analytics ? "all" : "necessary")}
      />

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

  return ` ${дата.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}`;
}
