"use client";

import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

import { calendarWithOverrides, pendingTransfers } from "../domain/production-calendar";
import type { IsoDate } from "../domain/plain-date";
import type { StoredProfile } from "../storage/profile";
import {
  DAY_TYPE_EFFECT,
  DAY_TYPE_LABELS,
  DAY_TYPE_MARK,
  DAY_TYPE_TONE,
  type DayType,
} from "../schemas";

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
 * --- Что размечено заранее ----------------------------------------------
 *
 * Все четырнадцать нерабочих праздничных дней ст. 112 ТК РФ, выходные по
 * дням недели, автоматический перенос по ст. 112 ч. 2 и предпраздничные
 * дни по ст. 95. Пустой сетки человек бы не осилил — 365 дней вручную
 * никто размечать не станет, а неразмеченный день молча считался бы
 * рабочим.
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

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

const DAY_TYPES: DayType[] = ["working", "pre_holiday", "holiday", "weekend"];

export interface YearCalendarEditorProps {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
}

export function YearCalendarEditor({ profile, onChange }: YearCalendarEditorProps) {
  const brushId = useId();
  const fromId = useId();
  const toId = useId();

  const [brush, setBrush] = useState<DayType>("weekend");
  const [open, setOpen] = useState(false);

  const year = profile.accountingYear;
  const overrides = profile.calendarOverrides;

  const days = useMemo(
    () => calendarWithOverrides(year, new Map(Object.entries(overrides) as [IsoDate, DayType][])),
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

  function resetAll() {
    onChange((previous) => ({ ...previous, calendarOverrides: {} }));
  }

  if (!open) {
    return (
      <section aria-labelledby="calendar" className="space-y-2">
        <h2 id="calendar" className="text-xl">
          Календарь {year} года
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">
          Праздники по ст. 112 ТК РФ и предпраздничные дни по ст. 95 размечены
          автоматически. Переносы выходных устанавливает Правительство
          отдельным постановлением на каждый год, и приложение их не знает —
          если ваш производственный календарь отличается, поправьте здесь.
          Ошибка в одном дне — это 8 часов нормы.
        </p>
        {pending.length > 0 ? <PendingNotice pending={pending} /> : null}
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Открыть календарь года
        </Button>
      </section>
    );
  }

  const byMonth = new Map<number, typeof days>();
  for (const item of days) {
    const month = Number(item.day.slice(5, 7)) - 1;
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(item);
    else byMonth.set(month, [item]);
  }

  return (
    <section aria-labelledby="calendar" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="calendar" className="text-xl">
          Календарь {year} года
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Свернуть
        </Button>
      </div>

      {pending.length > 0 ? <PendingNotice pending={pending} /> : null}

      <div className="space-y-4 rounded-sm border border-rule bg-paper-raised p-4">
        <fieldset className="space-y-2">
          <legend className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
            Тип дня
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
            {DAY_TYPE_EFFECT[brush]}
          </p>
        </fieldset>

        <form
          className="flex flex-wrap items-start gap-3 border-t border-rule pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const from = String(form.get("from") ?? "");
            const to = String(form.get("to") ?? "");
            if (from && to) paint(from, to, brush);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={fromId}>С даты</Label>
            <Input
              id={fromId}
              name="from"
              type="date"
              required
              min={`${year}-01-01`}
              max={`${year}-12-31`}
              className="w-44"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={toId}>По дату включительно</Label>
            <Input
              id={toId}
              name="to"
              type="date"
              required
              min={`${year}-01-01`}
              max={`${year}-12-31`}
              className="w-44"
            />
          </div>
          <Button type="submit" variant="outline" className="mt-[1.375rem]">
            Назначить диапазону
          </Button>
          <p className="mt-[1.375rem] max-w-xs text-xs text-ink-muted" id={brushId}>
            Отдельный день меняется щелчком по клетке. Диапазон удобнее для
            каникул и переносов.
          </p>
        </form>
      </div>

      <div className="overflow-x-auto" role="region" aria-label="Календарь года" tabIndex={0}>
        <table className="border-collapse">
          <caption className="sr-only">
            Производственный календарь {year}: строки — месяцы, столбцы — числа
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="px-2 py-1 text-left font-display text-xs font-bold uppercase tracking-wide text-ink-muted"
              >
                Месяц
              </th>
              {Array.from({ length: 31 }, (_, index) => (
                <th
                  key={index}
                  scope="col"
                  className="w-7 py-1 text-center font-mono text-[10px] font-normal text-ink-faint"
                >
                  {index + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((name, month) => {
              const items = byMonth.get(month) ?? [];
              return (
                <tr key={name}>
                  <th
                    scope="row"
                    className="whitespace-nowrap py-0.5 pr-3 text-left text-sm font-normal"
                  >
                    {name}
                  </th>
                  {Array.from({ length: 31 }, (_, index) => {
                    const item = items[index];
                    if (!item) return <td key={index} className="p-px" aria-hidden />;
                    return (
                      <td key={index} className="p-px">
                        <button
                          type="button"
                          aria-label={`${index + 1} ${name} — ${DAY_TYPE_LABELS[item.dayType]}${
                            item.source === "override" ? ", изменено вами" : ""
                          }`}
                          onClick={() => paint(item.day, item.day, brush)}
                          className={cn(
                            "relative flex size-6 items-center justify-center rounded-xs border font-mono text-[10px]",
                            "hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-trace",
                            DAY_TYPE_TONE[item.dayType],
                          )}
                        >
                          {DAY_TYPE_MARK[item.dayType]}
                          {item.source === "override" ? (
                            // Точка, а не цвет: цвет уже занят типом дня, и
                            // второй смысл на том же канале означал бы, что
                            // ни один не читается.
                            <span
                              aria-hidden
                              className="absolute -right-px -top-px size-1.5 rounded-full bg-ink"
                            />
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
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
            onClick={resetAll}
          >
            Вернуть календарь по закону
          </button>
        ) : null}
      </div>
    </section>
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
      В новогодние каникулы попали выходные ({pending.join(", ")}), которые
      постановление Правительства переносит на другие даты. Какие это даты,
      приложение не знает — из закона они не выводятся. Пока перенос не
      проставлен, норма завышена на{" "}
      <span className="font-mono">{pending.length * 8}</span> часов: найдите эти
      дни в своём производственном календаре и отметьте их здесь выходными.
    </p>
  );
}
