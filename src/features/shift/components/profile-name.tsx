"use client";

import { User } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

import type { LibraryEntry } from "../storage/library";
import type { StoredProfile } from "../storage/profile";

/**
 * Имя профиля — водяным знаком, и через него же — выбор другого профиля.
 *
 * --- Почему имя больше не правится нажатием --------------------------------
 *
 * Правилось: нажатие превращало водяной знак в поле, и имя менялось прямо
 * на месте. Удобно, пока на имя нажимают ради правки, — но нажимали на
 * него и случайно, и чтобы переключиться на другой профиль, и в обоих
 * случаях получали курсор в чужом слове. Имя — такое же свойство профиля,
 * как график и норма, и правится оно там же, где они: в настройках.
 *
 * --- Что делает нажатие теперь ---------------------------------------------
 *
 * Открывает перечень ДРУГИХ профилей — тех, что лежат в проводнике, — и
 * выбранный открывается вместо нынешнего. Имя стоит там, где человек и так
 * смотрит, и «этот график не тот» — ровно тот вопрос, с которым на него
 * смотрят. Через проводник то же самое стоило трёх нажатий: меню, «Открыть
 * профиль», строка.
 *
 * Других профилей нет — нажимать незачем, и имя остаётся просто надписью:
 * без указателя-«пальца» и без отклика на наведение. Кнопка, открывающая
 * пустой перечень, обещала бы выбор, которого нет.
 *
 * Открытие идёт тем же путём, что из проводника (`workspace.tsx`,
 * `askOpenEntry`): с вопросом, не сохранить ли нынешний в файл, если он
 * правился, и с переставленным указателем на открытую запись.
 *
 * --- Почему так бледно ------------------------------------------------------
 *
 * Водяной знак нарочно бледный — и в шапке тоже: это подпись к экрану, а
 * не заголовок, и спорить с цифрами ему не за что. Под указателем он
 * проступает чуть ярче, если на него можно нажать.
 */
export function ProfileName({
  profile,
  others,
  onPick,
  place = "page",
}: {
  profile: StoredProfile;
  /** Другие профили проводника — те, на которые можно переключиться. */
  others: readonly LibraryEntry[];
  /** Открыть выбранный профиль вместо нынешнего. */
  onPick: (entry: LibraryEntry) => void;
  /**
   * Где стоит имя.
   *
   * `page` — над цифрами, крупно: так оно стоит на узком экране, где в
   * шапке места нет.
   *
   * `header` — в строке шапки, сразу за знаком сайта, в размер букв
   * «ГРАФИК 1|3».
   */
  place?: "page" | "header";
}) {
  const [открыто, setОткрыто] = useState(false);
  const гнездо = useRef<HTMLDivElement>(null);
  const id = useId();
  const вШапке = place === "header";
  const имя = profile.displayName || "Имя профиля";
  const выбор = others.length > 0;

  // Закрывается всеми способами, какими обязано: `Esc`, нажатие мимо, уход
  // фокуса. Те же три, что у меню в шапке и у легенды.
  useEffect(() => {
    if (!открыто) return;

    const закрыть = () => setОткрыто(false);
    const мимо = (событие: PointerEvent) => {
      if (!гнездо.current?.contains(событие.target as Node)) закрыть();
    };
    const клавиша = (событие: KeyboardEvent) => {
      if (событие.key === "Escape") закрыть();
    };
    const фокус = (событие: FocusEvent) => {
      if (!гнездо.current?.contains(событие.target as Node)) закрыть();
    };

    document.addEventListener("pointerdown", мимо);
    document.addEventListener("keydown", клавиша);
    document.addEventListener("focusin", фокус);

    return () => {
      document.removeEventListener("pointerdown", мимо);
      document.removeEventListener("keydown", клавиша);
      document.removeEventListener("focusin", фокус);
    };
  }, [открыто]);

  // По алфавиту, а не по свежести: место профиля в перечне не должно
  // меняться от того, какой правили последним, — тогда рука запоминает,
  // где он.
  const перечень = [...others].sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return (
    // Окошко — вне заголовка, а не внутри: у имени в шапке стоит
    // `truncate`, и всё, что выходит за его рамку, обрезалось бы вместе с
    // длинным именем.
    <div ref={гнездо} className={cn("relative min-w-0", !вШапке && "text-center")}>
      <h1
        className={cn(
          "font-hand",
          вШапке
            ? // Рукописная гарнитура мельче печатной при том же кегле: её
              // строчные — в полроста прописных, а росчерки уходят вверх и
              // вниз. В тех же 20 точках, что «ГРАФИК», имя читалось бы
              // сноской; в 30 высота строчных встаёт вровень с высотой
              // прописных названия. `truncate` — длинное имя обрезается, а
              // не выталкивает меню за край строки.
              "min-w-0 truncate text-3xl leading-none"
            : "text-3xl leading-tight sm:text-5xl",
        )}
      >
        {выбор ? (
          <button
            type="button"
            onClick={() => setОткрыто((было) => !было)}
            aria-expanded={открыто}
            aria-controls={id}
            // Имя кнопки — само имя профиля и то, что нажатие делает:
            // «Петров И. С.» без продолжения не говорит, что за ним выбор.
            aria-label={`${имя}. Выбрать другой профиль`}
            className={cn(
              // Указатель над текстом везде стрелка (`globals.css`), и
              // «палец» — единственный признак нажимаемого. У имени он тем
              // нужнее, что на кнопку оно не похоже вовсе.
              "max-w-full cursor-pointer truncate rounded-sm opacity-10 transition-opacity",
              "hover:opacity-20",
              открыто && "opacity-20",
              "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink",
            )}
          >
            {имя}
          </button>
        ) : (
          <span className="opacity-10">{имя}</span>
        )}
      </h1>

      {открыто && (
        <div
          id={id}
          role="group"
          aria-label="Другие профили"
          className={cn(
            // `modal-lift` — та же кайма и тень, что у меню в шапке: окошко
            // лежит поверх страницы на той же высоте. Выше полосы цифр
            // (`z-40`), иначе на узком экране оно уходило бы под неё.
            "modal-lift absolute top-full z-50 mt-2 w-64 max-w-[calc(100vw-3rem)]",
            "max-h-[60svh] overflow-y-auto rounded-xl bg-paper-raised p-1.5 text-left",
            // В шапке — от левого края имени, вниз; над цифрами — по
            // середине, под самим именем: оно там стоит по центру.
            вШапке ? "left-0" : "left-1/2 -translate-x-1/2",
          )}
        >
          <p className="px-2.5 pt-1.5 pb-1 text-xs text-ink-muted">Открыть другой профиль</p>
          {перечень.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                setОткрыто(false);
                onPick(entry);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink",
                "cursor-pointer transition-colors hover:bg-paper-sunken",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
              )}
            >
              <User aria-hidden className="size-4 shrink-0 text-ink-muted" />
              <span className="min-w-0 truncate">{entry.name || "Без имени"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
