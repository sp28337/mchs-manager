"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

import { formatDateRu } from "../domain/format";
import { dayOfMonth, monthIndex, weekday, type IsoDate } from "../domain/plain-date";
import {
  calendarWithOverrides,
  pendingTransfers,
  type CalendarDay,
} from "../domain/production-calendar";
import type { StoredProfile } from "../storage/profile";
import {
  DAY_TYPE_EFFECT,
  DAY_TYPE_LABELS,
  DAY_TYPE_MARK,
  DAY_TYPE_TONE,
  type DayType,
} from "../schemas";
import { DateField } from "./date-field";
import { MONTH_NAMES } from "./month-names";
import { MonthGrid, WEEKDAY_LABELS } from "./month-grid";

/**
 * Календарь учётного года: какие дни нерабочие.
 *
 * --- Зачем он человеку --------------------------------------------------
 *
 * Норма периода считается по числу рабочих дней (ст. 104 ТК РФ), и ошибка
 * в одном дне — это 8 часов нормы. Праздники по ст. 112 ТК РФ размечены
 * заранее, но переносы выходных Правительство устанавливает отдельным
 * постановлением на каждый год, и приложение их не знает. Зато их знает
 * человек: производственный календарь у него перед глазами.
 *
 * --- Почему той же формы, что и график ----------------------------------
 *
 * Здесь была таблица 12×31 с горизонтальным ползунком: месяцы строками,
 * числа столбцами. Она не совпадала ни с одним календарём, который человек
 * видел, — ни с настенным, ни с графиком смен на этой же странице, — и
 * сверять по ней «выходной ли 9 марта» приходилось счётом по строке.
 *
 * Теперь месяц выглядит ровно как в графике: строка — неделя, столбец —
 * день недели. Одно и то же число оказывается на одном и том же месте в
 * обоих блоках, и глазу не нужно перестраиваться. Ползунка нет вовсе:
 * сетка переносится по ширине окна.
 *
 * --- Почему видно, откуда взят день -------------------------------------
 *
 * Правка помечается точкой. Человек должен различать, что он утверждает
 * сам, а что взято из закона: при разборе с начальником это разные по весу
 * утверждения, и стирать между ними границу нельзя.
 *
 * --- Правки сохраняются сразу -------------------------------------------
 *
 * Кнопки «Сохранить» здесь нет и быть не должно: запись идёт в браузер, а
 * не по сети, и отдельный шаг сохранения означал бы только возможность
 * потерять правку, закрыв вкладку.
 *
 * --- Почему он больше не сворачивается сам ------------------------------
 *
 * Здесь была своя кнопка «Открыть календарь»: блок стоял отдельным
 * разделом, и двенадцать сеток сразу отодвинули бы всё остальное вниз.
 * Теперь календарь показывается по переключателю в `YearView` — то есть
 * его уже выбрали и хотят видеть. Вторая крышка внутри означала бы, что
 * на нажатие «Производственный календарь» человек получает кнопку
 * «Открыть календарь».
 */

export const DAY_TYPES: DayType[] = ["working", "pre_holiday", "holiday", "weekend"];

export interface YearCalendarEditorProps {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  /** Раскладка месяцев: её задаёт масштаб, общий с графиком смен. */
  gridClassName?: string;
  /**
   * Чем помечать день. Выбирается в панели НАД сеткой вместе с остальным
   * управлением ею: пометка — это два движения подряд, выбрать кисть и
   * щёлкнуть по числу, и держать их по разные стороны двенадцати месяцев
   * значило прокручивать между каждой парой.
   */
  brush: DayType;
}

export function YearCalendarEditor({
  profile,
  onChange,
  gridClassName,
  brush,
}: YearCalendarEditorProps) {
  const [range, setRange] = useState<{ from: IsoDate | null; to: IsoDate | null }>({
    from: null,
    to: null,
  });

  const year = profile.accountingYear;
  const overrides = profile.calendarOverrides;

  const days = useMemo(
    () =>
      calendarWithOverrides(
        year,
        new Map(Object.entries(overrides) as [IsoDate, DayType][]),
      ),
    [year, overrides],
  );

  const overrideCount = Object.keys(overrides).length;
  const pending = pendingTransfers(year).filter((day) => overrides[day] === undefined);

  function paint(from: IsoDate, to: IsoDate, dayType: DayType) {
    const [start, end] = from <= to ? [from, to] : [to, from];
    onChange((previous) => {
      const next = { ...previous.calendarOverrides };
      for (const item of days) {
        if (item.day >= start && item.day <= end) next[item.day] = dayType;
      }
      return { ...previous, calendarOverrides: next };
    });
  }

  const byMonth = new Map<number, CalendarDay[]>();
  for (const item of days) {
    const month = monthIndex(item.day);
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(item);
    else byMonth.set(month, [item]);
  }

  return (
    <section aria-labelledby="calendar" className="space-y-4">
      {/* Сетка идёт ПЕРВОЙ и ничего над собой не имеет — в этом весь
          смысл. Календарь показывается на месте графика по нажатию
          кнопки, и всё, что стояло бы выше сетки, сдвигало бы её вниз:
          человек, смотревший на мартовскую клетку, после переключения
          искал бы её заново. Пояснение ушло под знак вопроса у заголовка,
          инструменты правки — под сетку. */}
      <div
        className={
          gridClassName ??
          "grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {MONTH_NAMES.map((name, month) => {
          const items = byMonth.get(month) ?? [];
          const edited = items.filter((item) => item.source === "override").length;
          const byDay = new Map(items.map((item) => [item.day, item]));
          return (
            <MonthGrid
              key={name}
              title={name}
              meta={edited > 0 ? <span className="text-ink">правок: {edited}</span> : null}
              days={items.map((item) => item.day)}
              joined
              renderDay={(day, corners) => {
                const item = byDay.get(day);
                return item ? (
                  <DayButton
                    item={item}
                    corners={corners}
                    onPaint={() => paint(day, day, brush)}
                  />
                ) : null;
              }}
            />
          );
        })}
      </div>

      {pending.length > 0 ? <PendingNotice pending={pending} /> : null}

      {/* Под сеткой остался только диапазон. Кисть переехала в панель над
          сеткой, к остальному управлению ею; здесь же — то, что нужно
          редко и не при каждом щелчке: разметить сразу неделю каникул. */}
      <div className="space-y-4 rounded-sm border border-rule bg-paper-raised p-4">
        <form
          className="flex flex-wrap items-start gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (range.from && range.to) paint(range.from, range.to, brush);
          }}
        >
          <DateField
            label="С даты"
            name="from"
            required
            min={`${year}-01-01`}
            max={`${year}-12-31`}
            onChange={(value) => setRange((previous) => ({ ...previous, from: value }))}
          />
          <DateField
            label="По дату включительно"
            name="to"
            required
            min={`${year}-01-01`}
            max={`${year}-12-31`}
            onChange={(value) => setRange((previous) => ({ ...previous, to: value }))}
          />
          <Button
            type="submit"
            variant="outline"
            className="mt-[1.375rem]"
            disabled={!range.from || !range.to}
          >
            Назначить диапазон
          </Button>
          {/* Кисть выбирается наверху, а красит здесь — значит, здесь она
              должна быть названа. Иначе человек нажимает «Назначить
              диапазон», не видя, чем именно. */}
          <p className="mt-[1.375rem] max-w-xs text-xs text-ink-muted">
            Отметит все дни диапазона как «{DAY_TYPE_LABELS[brush].toLowerCase()}» —
            вид выбирается над календарём. Отдельный день быстрее отметить щелчком.
          </p>
        </form>
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
        {DAY_TYPES.map((type) => (
          <div key={type} className="flex items-center gap-2">
            <dt
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-xs border font-mono text-[10px]",
                DAY_TYPE_TONE[type],
              )}
            >
              {DAY_TYPE_MARK[type]}
            </dt>
            <dd>
              <span className="font-medium">{DAY_TYPE_LABELS[type]}</span>
              <span className="text-ink-muted"> — {DAY_TYPE_EFFECT[type]}</span>
            </dd>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <dt className="relative flex size-6 shrink-0 items-center justify-center rounded-xs border border-rule">
            <span aria-hidden className="absolute -right-px -top-px size-1.5 rounded-full bg-ink" />
          </dt>
          <dd className="text-ink-muted">Изменено вами</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-4 border-t border-rule pt-4">
        <p className="text-sm text-ink-muted" aria-live="polite">
          Ваших правок: {overrideCount}. Расчёт выше уже их учитывает.
        </p>
        {overrideCount > 0 ? (
          <button
            type="button"
            className="text-xs text-ink-muted underline underline-offset-2 hover:text-signal"
            onClick={() =>
              onChange((previous) => ({ ...previous, calendarOverrides: {} }))
            }
          >
            Вернуть календарь по закону
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Пояснение к календарю — то, что раньше стояло абзацем над сеткой.
 *
 * Живёт здесь, а не там, где показывается: текст говорит о том, что и
 * откуда в этой сетке размечено, и разойтись с самой сеткой ему нельзя.
 * Показывается он знаком вопроса у заголовка раздела — над сеткой места
 * нет, там она сама.
 */
export function CalendarNote({ profile }: { profile: StoredProfile }) {
  const year = profile.accountingYear;
  const pending = pendingTransfers(year).filter(
    (day) => profile.calendarOverrides[day] === undefined,
  );

  return (
    <>
      Праздники по ст. 112 ТК РФ и предпраздничные дни по ст. 95 размечены
      автоматически.{" "}
      {pending.length > 0 ? (
        <>
          Переносы выходных устанавливает Правительство отдельным постановлением
          на каждый год, и на {year} год приложение его ещё не знает.
        </>
      ) : (
        <>
          Перенос выходных дней на {year} год внесён по постановлению
          Правительства — календарь должен совпасть с выданным вам.
        </>
      )}{" "}
      Если ваш производственный календарь всё-таки отличается, поправьте здесь:
      ошибка в одном дне — это 8 часов нормы. Инструменты правки — под сеткой.
    </>
  );
}

function DayButton({
  item,
  corners,
  onPaint,
}: {
  item: CalendarDay;
  /** Скругления углов: их знает сетка, а не клетка. */
  corners: string;
  onPaint: () => void;
}) {
  const date = dayOfMonth(item.day);
  const month = (MONTH_NAMES[monthIndex(item.day)] ?? "").toLowerCase();
  const weekdayName = WEEKDAY_LABELS[weekday(item.day)] ?? "";

  const label =
    `${date} ${month}, ${weekdayName} — ${DAY_TYPE_LABELS[item.dayType].toLowerCase()}` +
    (item.source === "override" ? ", изменено вами" : "");

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onPaint}
      className={cn(
        "relative flex aspect-square w-full min-w-0 cursor-pointer flex-col",
        "items-center justify-center leading-tight",
        // Обводкой внутрь, а не рамкой: клетки стоят вплотную, и рамка
        // сдвинула бы соседей.
        "hover:outline-2 hover:-outline-offset-2 hover:outline-ink/40",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",
        corners,
        // Рамки нет ни у одного дня: тип дня различается подложкой и
        // буквой. Триста шестьдесят пять контуров на год — это решётка,
        // за которой не видно ни праздников, ни правок.
        DAY_TYPE_TONE[item.dayType],
      )}
    >
      {/* Кегль в `em`: клетка следует за масштабом сетки, и число вместе
          с ней. То же решение, что в клетке графика, — иначе при
          переключении между сетками менялся бы размер цифр. */}
      <span aria-hidden className="font-mono text-[1em]">
        {date}
      </span>
      <span aria-hidden className="font-mono text-[0.75em]">
        {DAY_TYPE_MARK[item.dayType]}
      </span>
      {item.source === "override" ? (
        // Точка, а не цвет: цвет уже занят типом дня, и второй смысл на том
        // же канале означал бы, что ни один не читается.
        <span
          aria-hidden
          className="absolute -right-px -top-px size-1.5 rounded-full bg-ink"
        />
      ) : null}
    </button>
  );
}

/**
 * Названная цена непроставленного переноса.
 *
 * Молчать здесь нельзя: приложение считает эти дни рабочими, и норма выше
 * официальной ровно на восемь часов за каждый. Человек, не знающий об
 * этом, понесёт начальнику завышенную норму и окажется неправ в споре, где
 * он прав по существу.
 */
function PendingNotice({ pending }: { pending: readonly IsoDate[] }) {
  return (
    <p className="max-w-prose rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
      В новогодние каникулы попали выходные ({pending.map(formatDateRu).join(", ")}),
      которые постановление Правительства переносит на другие даты. Какие это
      даты, приложение не знает — из закона они не выводятся. Пока перенос не
      проставлен, норма завышена на{" "}
      <span className="font-mono">{pending.length * 8}</span> часов: найдите эти
      дни в своём производственном календаре и отметьте их здесь выходными.
    </p>
  );
}
