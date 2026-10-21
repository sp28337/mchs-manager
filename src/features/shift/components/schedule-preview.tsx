"use client";

import { useMemo, useSyncExternalStore, type CSSProperties } from "react";

import { BalanceCaption } from "@/components/ui/balance-caption";
import { FIGURE_TRIO, FigureSep } from "@/components/ui/figure-sep";
import { Figure } from "@/components/ui/summary-figure";
import { cn } from "@/lib/utils/cn";

import { formatHoursTrim } from "../domain/decimal";
import { formatDayMonthRu } from "../domain/format";
import { dayOfMonth, todayIso } from "../domain/plain-date";
import { CUSTOM_PATTERN_ID } from "../domain/schedule-pattern";
import { patternOfProfile } from "../model/derive";
import {
  previewCells,
  previewTotals,
  type PreviewCell,
} from "../model/schedule-preview";
import type { StoredProfile } from "../storage/profile";
import { SHIFT_TAIL_TONE, SHIFT_TONE } from "./day-marks";
import { TODAY_MARK, WEEKDAY_LABELS } from "./month-grid";
import { MONTH_NAMES } from "./month-names";

/**
 * «Стол»: график, каким он ляжет на календарь, — рядом с вопросами анкеты.
 *
 * Человек, открывший приложение впервые, отвечает на вопросы, не видя ни
 * одного числа, и боится не нажать, а ошибиться: поставить смену не на те
 * сутки, выбрать не тот график. Стол отвечает на это сразу: клетки с часами,
 * тот же рисунок, что в самом расчёте, и они перестраиваются при каждом
 * ответе — выбрал «2|2», и зелёные сутки встали парами. Тот ли это график,
 * который висит у него на работе, он узнаёт глазами, а не по надписи.
 *
 * Имя графика стоит над сеткой тем же рукописным шрифтом, каким оно потом
 * встанет в шапке расчёта: ещё не нажав на кнопку, человек видит титульный лист
 * своего графика, а не пустое поле «Имя».
 *
 * Красная рамка у сегодняшних суток — тот же знак, что в расчёте, и единственный
 * сигнальный цвет на столе: от неё читается всё остальное.
 *
 * --- Почему «на клиенте после гидратации» ------------------------------------
 *
 * «Сегодня» знает только браузер: на сборке оно было бы днём выкладки, а окно
 * закрыто и в разметке страницы всё равно присутствует. Расчёт стола — после
 * гидратации и заново при каждом открытии окна (`round`), чтобы волна клеток
 * играла на глазах, а не за закрытой дверью.
 *
 * --- Что читает программа чтения -----------------------------------------------
 *
 * Сетка для неё — картинка (`aria-hidden`): сорок пять дат подряд не говорят
 * ничего. Вместо них одна фраза — какой график и когда ближайшие смены.
 */

/** Сколько клеток видно на телефоне: три недели. */
const PHONE_CELLS = 21;

const subscribeNever = () => () => undefined;
const readHydrated = () => true;
const readNotHydrated = () => false;

export function SchedulePreview({
  profile,
  round,
}: {
  profile: StoredProfile;
  /** Сколько раз окно открывали: смена номера пересобирает стол, и клетки приходят волной заново. */
  round: number;
}) {
  const hydrated = useSyncExternalStore(subscribeNever, readHydrated, readNotHydrated);
  const today = useMemo(() => todayIso(), [round]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hydrated) return <div aria-hidden className="stage min-h-72 rounded-xl bg-paper-sunken" />;

  return <Stage profile={profile} today={today} round={round} />;
}

function Stage({
  profile,
  today,
  round,
}: {
  profile: StoredProfile;
  today: string;
  round: number;
}) {
  const pattern = patternOfProfile(profile);
  // У своего цикла в названии стоит «Настроить» — слово про действие, а не про
  // график; на столе он называется тем, что человек задал.
  const title =
    profile.schedulePattern === CUSTOM_PATTERN_ID ? `Свой цикл ${pattern.label}` : pattern.title;
  const cells = previewCells(profile, today);
  const totals = previewTotals(profile, today);

  const name = profile.displayName.trim();
  const upcoming = cells
    .filter((cell) => cell.kind === "start" && cell.day >= today)
    .slice(0, 4)
    .map((cell) => formatDayMonthRu(cell.day));

  const first = cells[0]!.day;
  const last = cells[cells.length - 1]!.day;
  // На телефоне видны три недели из пяти (`PreviewDay`): подпись над сеткой
  // называет те, что на экране, а не те, что посчитаны.
  const lastShort = cells[PHONE_CELLS - 1]!.day;

  return (
    <section
      aria-label="Так график ляжет на календарь"
      className="stage flex h-full flex-col gap-4 rounded-xl bg-paper-sunken p-4 md:p-5"
    >
      <header className="space-y-1.5">
        {/* Рукописный шрифт мельче печатного при том же кегле: потому и крупно.
            Пустое имя — не ошибка (график получит имя по умолчанию), но и
            пустого места на титуле быть не должно: блёклое «Ваш график». */}
        <p
          className={cn(
            "truncate font-hand text-4xl leading-tight md:text-5xl",
            name === "" ? "text-ink-faint" : "text-ink",
          )}
        >
          {name === "" ? "Ваш график" : name}
        </p>
        <p className="font-display text-sm font-bold tracking-wide text-ink-muted uppercase">
          {title}
          <span className="font-mono text-xs font-normal normal-case">
            {" · смена "}
            {formatHoursTrim(profile.shiftDurationHours)}
            {" ч с "}
            {profile.shiftStartTime}
          </span>
        </p>
      </header>

      <p className="sr-only">
        {title}. Ближайшие смены: {upcoming.join(", ")}.
      </p>

      <div aria-hidden>
        <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-ink-faint">
          <span className="font-display tracking-wide uppercase">Ближайшие недели</span>
          <span className="font-mono">
            {formatDayMonthRu(first)} —{" "}
            <span className="max-sm:hidden">{formatDayMonthRu(last)}</span>
            <span className="sm:hidden">{formatDayMonthRu(lastShort)}</span>
          </span>
        </div>

        {/* Ключ — номер открытия: окно открыли заново, и клетки снова приходят
            волной. Правка ответов ключ не меняет, и клетки перекрашиваются на
            месте, с задержкой по номеру клетки, — волной же. */}
        <div key={round} className="grid grid-cols-7 gap-1.5 select-none">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="pb-0.5 text-center text-[10px] text-ink-faint uppercase"
            >
              {label}
            </div>
          ))}

          {cells.map((cell, index) => (
            <PreviewDay key={cell.day} cell={cell} index={index} />
          ))}
        </div>
      </div>

      {/* Условные обозначения — в одну строку и только то, чего нет в самой
          клетке: цвет смены, её продолжение и красную рамку. «В» подписана в
          каждой свободной клетке и пояснения не требует. На телефоне строки нет
          вовсе: там и без неё тесно, а сетка читается так же. */}
      <ul
        aria-hidden
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted max-sm:hidden"
      >
        <Key tone={SHIFT_TONE}>смена</Key>
        <Key tone={SHIFT_TAIL_TONE}>продолжение</Key>
        <Key tone={cn("border-transparent", TODAY_MARK)}>сегодня</Key>
      </ul>

      {/* Итог — у нижней кромки стола: стол тянется вровень с формой, и
          итог стоит против кнопок, а не повисает посреди пустоты. */}
      <div className="mt-auto space-y-2 border-t border-rule pt-3">
        <p className="text-center font-display text-xs font-bold tracking-wide text-ink-faint uppercase">
          Итог месяца · {MONTH_NAMES[totals.month]}
        </p>
        <dl className={cn("mx-auto max-w-xs gap-x-2", FIGURE_TRIO)}>
          <Figure parts={[{ value: totals.norm, unit: "ч" }]} caption="Норма" />
          <FigureSep />
          <Figure parts={[{ value: totals.actual, unit: "ч" }]} caption="Отработано" />
          <FigureSep />
          <Figure
            parts={[{ value: totals.balance, unit: "ч" }]}
            caption={<BalanceCaption under={totals.under} />}
            tone={totals.under ? "signal" : totals.over ? "verify" : undefined}
          />
        </dl>
      </div>
    </section>
  );
}

/**
 * Клетка суток — та же, что в расчёте: бумага снизу со светом лампы по кромке,
 * вид суток сверху. Часы у заступления и продолжения, «В» — у свободных.
 */
function PreviewDay({ cell, index }: { cell: PreviewCell; index: number }) {
  const tone =
    cell.kind === "start"
      ? SHIFT_TONE
      : cell.kind === "tail"
        ? SHIFT_TAIL_TONE
        : "border-transparent text-ink-faint";

  return (
    <div
      // Ниже третьей недели на телефоне клеток нет: места мало, а ритм виден и так.
      className={cn(
        "stage-cell relative rounded-md bg-paper-raised lit-tile",
        index >= PHONE_CELLS && "max-sm:hidden",
      )}
      style={{ "--i": index } as CSSProperties}
    >
      <div
        className={cn(
          "flex aspect-square w-full flex-col items-center justify-center rounded-md border leading-tight",
          tone,
          cell.today && TODAY_MARK,
        )}
      >
        <span className="font-mono text-xs md:text-sm">{dayOfMonth(cell.day)}</span>
        {/* Вторая строка есть у каждой клетки — часы или «В»: без неё число в
            свободной клетке стояло бы по центру, а в смене — выше, и ряд пошёл
            бы волной. */}
        <span className="font-mono text-[9px] md:text-[10px]">
          {cell.kind === "free" ? "В" : cell.hours}
        </span>
      </div>
    </div>
  );
}

function Key({ tone, children }: { tone: string; children: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={cn("size-3.5 rounded-[3px] border", tone)} />
      {children}
    </li>
  );
}
