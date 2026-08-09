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
 */

const DAY_TYPES: DayType[] = ["working", "pre_holiday", "holiday", "weekend"];

export interface YearCalendarEditorProps {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
}

export function YearCalendarEditor({ profile, onChange }: YearCalendarEditorProps) {
  const [brush, setBrush] = useState<DayType>("weekend");
  const [open, setOpen] = useState(false);
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

  if (!open) {
    return (
      <section aria-labelledby="calendar" className="space-y-2">
        <h2 id="calendar" className="text-xl">
          Производственный календарь {year} года
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">
          Праздники по ст. 112 ТК РФ и предпраздничные дни по ст. 95 размечены
          автоматически. Переносы выходных устанавливает Правительство
          отдельным постановлением на каждый год, и приложение их не знает —
          если ваш производственный календарь отличается, поправьте здесь.
          Ошибка в одном дне — это 8 часов нормы.
        </p>
        {pending.length > 0 ? <PendingNotice pending={pending} /> : null}
        <Button type="button" variant="outline" onClick={() => setOpen(true)} className="rounded-xl">
          Открыть календарь
        </Button>
      </section>
    );
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
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="calendar" className="text-xl">
          Производственный календарь {year} года
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Свернуть
        </Button>
      </div>

      {pending.length > 0 ? <PendingNotice pending={pending} /> : null}

      <div className="space-y-4 rounded-sm border border-rule bg-paper-raised p-4">
        <fieldset className="space-y-2">
          <legend className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
            Чем помечать
          </legend>
          <div className="flex flex-wrap gap-2">
            {DAY_TYPES.map((type) => (
              <Button
                key={type}
                type="button"
                size="sm"
                variant={brush === type ? "default" : "outline"}
                aria-pressed={brush === type}
                onClick={() => setBrush(type)}
              >
                {DAY_TYPE_LABELS[type]}
              </Button>
            ))}
          </div>
          <p className="max-w-prose text-xs text-ink-muted" aria-live="polite">
            {DAY_TYPE_EFFECT[brush]}. Щёлкните по числу в календаре ниже.
          </p>
        </fieldset>

        <form
          className="flex flex-wrap items-start gap-3 border-t border-rule pt-4"
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
          <p className="mt-[1.375rem] max-w-xs text-xs text-ink-muted">
            Диапазон удобнее для длительного перерыва; отдельный день быстрее отметить
            щелчком.
          </p>
        </form>
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
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
              renderDay={(day) => {
                const item = byDay.get(day);
                return item ? (
                  <DayButton item={item} onPaint={() => paint(day, day, brush)} />
                ) : null;
              }}
            />
          );
        })}
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

function DayButton({ item, onPaint }: { item: CalendarDay; onPaint: () => void }) {
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
        "relative flex w-full min-w-0 cursor-pointer flex-col items-center justify-center rounded-xs border py-0.5 leading-tight",
        "lg:aspect-square lg:py-0",
        "hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-trace",
        DAY_TYPE_TONE[item.dayType],
      )}
    >
      <span aria-hidden className="font-mono text-xs">
        {date}
      </span>
      <span aria-hidden className="font-mono text-[9px]">
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
