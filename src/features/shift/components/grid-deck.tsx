"use client";

import { CalendarCog, CalendarDays } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import type { StoredProfile } from "../storage/profile";
import { LiveModeCell } from "./live-mode";
import { PeriodPicker, type StatutoryChoice } from "./period-picker";
import type { YearViewKind } from "./year-view";

/**
 * Нижняя панель телефона: чем управляют сеткой, не поднимая руки.
 *
 * --- Зачем она понадобилась ------------------------------------------------
 *
 * Управление сеткой — что показать, за какой период, считать ли по
 * сегодняшний день — стояло строкой НАД сеткой. На настольном экране это
 * верно: орган управления вплотную к тому, чем управляет, и виден вместе с
 * ним.
 *
 * На телефоне же сетка длиной в двенадцать экранов, и строка эта видна
 * ровно до первого движения пальцем. Дальше человек, долиставший до
 * октября и захотевший переключиться на календарь, должен вернуться на
 * самый верх, нажать и снова долистать до октября. Управление, до которого
 * нужно прокручивать, — это управление, которым не пользуются.
 *
 * Внизу оно всегда на месте и всегда под большим пальцем. Так устроены
 * телефонные приложения не из моды: верхняя треть экрана в шесть дюймов
 * рукой попросту не достаётся.
 *
 * --- Почему панель не заведена сама по себе --------------------------------
 *
 * В ней стоят ТЕ ЖЕ органы управления, что и в строке над сеткой, — не
 * похожие, а те же самые: переключатель сеток, кнопка периода со своим
 * окном, режим «Онлайн». Заведи их здесь заново — и однажды строка
 * научилась бы чему-то, чего не умеет панель. Поэтому кнопка периода
 * приходит из `period-picker.tsx` вместе со своим окном, а режим — из
 * `live-mode.tsx`, и разойтись им негде.
 *
 * Какая из двух показана, решает не скрипт, а ширина экрана: строка скрыта
 * до `md`, панель — от `md` и выше. Замер ширины скриптом означал бы, что
 * до его выполнения не показано ни то ни другое, а заглушка рабочего
 * экрана (`workspace-skeleton.tsx`), где скрипта нет вовсе, не совпала бы
 * с расчётом.
 *
 * --- Почему это корыто с плашками, а не полоса значков ---------------------
 *
 * В приложении уже есть способ сказать «вот несколько положений, занято
 * одно»: утопленная подложка и поднятая плашка на ней (`ui/segmented.tsx`).
 * Панель сделана тем же способом — иначе она была бы деталью своего рода,
 * похожей на телефонное приложение вообще и ни на что в этом.
 *
 * Поднято здесь ровно то, что ВЫБРАНО: показанная сетка, включённый режим
 * и период — тот всегда, потому что он не выбор из двух, а название того,
 * что человек сейчас видит.
 */

/** Ячейка: знак, под ним подпись. Одна мера на панель и на её заглушку. */
export const DECK_CELL = cn(
  "inline-flex h-12 min-w-0 flex-1 cursor-pointer select-none flex-col",
  "items-center justify-center gap-1 rounded-xl px-1 transition-colors",
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",
  "[&_svg]:size-5.5 [&_svg]:shrink-0",
);

/**
 * Подпись под знаком — той же гарнитурой, что «Масштаб» и «Онлайн» в
 * строке над сеткой: узкая, одиннадцать точек, прописные. Ряд органов
 * управления набран в приложении так везде.
 *
 * `max-w-full truncate`: подпись у периода приходит извне и бывает длинной
 * («2-е полугодие»), а ячейка узкая — перенос сломал бы высоту панели.
 */
export const DECK_CAPTION =
  "max-w-full truncate font-display text-[11px] font-bold uppercase leading-none tracking-wide";

/** Занятая ячейка поднята и ловит свет, пустая — нет. Как у `Segmented`. */
export const DECK_RAISED = "lit bg-paper-raised";

/**
 * Пара ячеек-сеток внутри корыта.
 *
 * Две доли места, а не одна: ячеек внутри две, и с одной долей на двоих они
 * выходили вдвое уже соседних — «Календарь» в них не помещался и обрезался
 * многоточием.
 *
 * Мера вынесена сюда, а не оставлена в разметке, потому что повторить её
 * обязана заглушка: доли и просвет между ячейками задают их ширину, и
 * заглушка без этой обёртки делила корыто на четыре равные части — в миг
 * подстановки ячейки разъезжались на девять точек вбок.
 */
export const DECK_PAIR = "flex min-w-0 flex-2 items-stretch gap-0.5";

/** Корыто: подложка панели с полем в четыре точки вокруг ячеек. */
export const DECK_TROUGH = cn(
  "relative mx-auto flex max-w-lg items-stretch gap-0.5 rounded-2xl",
  "border border-rule bg-paper-sunken p-1",
);

/**
 * Место панели на экране. Закрепление у нижней кромки, отступ под системную
 * полосу телефона и растворение сетки над панелью — в `globals.css`,
 * правило `.deck`: всё это считается от безопасной зоны, а её знает только
 * таблица стилей.
 */
export const DECK_SHELL = "deck px-3 md:hidden";

/**
 * Поле под панель в самом низу страницы.
 *
 * Панель закреплена у кромки окна и в потоке места не занимает — подвал без
 * этого поля уезжал бы под неё. Считается оно от той же безопасной зоны:
 * корыто (48 + 8 точек), отступ панели (12) и воздух под подвалом.
 *
 * Одно на рабочий экран и на его заглушку: разойдись они — и страница
 * дёрнулась бы в момент подстановки ровно на разницу.
 */
export const WORKSPACE_PAD = "pb-[calc(5.5rem+var(--safe-bottom))] md:pb-0";

export function GridDeck({
  profile,
  onChange,
  view,
  onViewChange,
  statutory,
  onStatutory,
  month,
  onMonth,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  view: YearViewKind;
  onViewChange: (view: YearViewKind) => void;
  statutory: StatutoryChoice;
  onStatutory: (choice: StatutoryChoice) => void;
  month: number | null;
  onMonth: (month: number | null) => void;
}) {
  return (
    <div className={DECK_SHELL}>
      <div className={DECK_TROUGH}>
        {/* Две сетки — взаимоисключающий выбор, и группа названа вслух:
            без имени это просто две кнопки подряд. */}
        <div
          role="group"
          aria-label="Что показывать на сетке"
          className={DECK_PAIR}
        >
          <DeckTab
            active={view === "shifts"}
            onClick={() => onViewChange("shifts")}
            caption="График"
          >
            <CalendarDays aria-hidden />
          </DeckTab>
          <DeckTab
            active={view === "calendar"}
            onClick={() => onViewChange("calendar")}
            caption="Календарь"
          >
            <CalendarCog aria-hidden />
          </DeckTab>
        </div>

        <PeriodPicker
          cellClassName={cn(DECK_CELL, DECK_RAISED)}
          captionClassName={DECK_CAPTION}
          accountingYear={profile.accountingYear}
          onAccountingYear={(accountingYear) =>
            onChange((previous) => ({ ...previous, accountingYear }))
          }
          statutory={statutory}
          onStatutory={onStatutory}
          month={month}
          onMonth={onMonth}
        />

        <LiveModeCell
          profile={profile}
          onChange={onChange}
          className={cn(DECK_CELL, profile.liveMode && DECK_RAISED)}
          captionClassName={DECK_CAPTION}
        />
      </div>
    </div>
  );
}

function DeckTab({
  active,
  onClick,
  caption,
  children,
}: {
  active: boolean;
  onClick: () => void;
  caption: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(DECK_CELL, active ? cn(DECK_RAISED, "text-ink") : "text-ink-muted")}
    >
      {children}
      <span className={DECK_CAPTION}>{caption}</span>
    </button>
  );
}
