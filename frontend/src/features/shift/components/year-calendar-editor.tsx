"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { ErrorPanel } from "@/components/shared/error-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client/client";
import { cn } from "@/lib/utils/cn";

import { getCalendar, setCalendar } from "../api";
import {
  DAY_TYPE_EFFECT,
  DAY_TYPE_LABELS,
  DAY_TYPE_MARK,
  DAY_TYPE_TONE,
  type CalendarDay,
  type DayType,
  type Profile,
} from "../schemas";

/**
 * Календарь учётного года: какие дни нерабочие.
 *
 * --- Зачем он человеку --------------------------------------------------
 *
 * Норма периода считается по числу рабочих дней (ст. 104 ТК РФ), и
 * ошибка в одном дне — это 8 часов нормы. Праздники по ст. 112 ТК РФ
 * размечены заранее, но переносы выходных Правительство устанавливает
 * отдельным постановлением на каждый год, и приложение их не знает. Зато
 * их знает человек: производственный календарь у него перед глазами.
 *
 * --- Что размечено заранее ----------------------------------------------
 *
 * Все четырнадцать нерабочих праздничных дней ст. 112 ТК РФ, выходные по
 * дням недели и предпраздничные дни. Пустой сетки человек бы не осилил —
 * 365 дней вручную никто размечать не станет, а неразмеченный день молча
 * считался бы рабочим.
 *
 * --- Почему видно, откуда взят день -------------------------------------
 *
 * Правка помечается точкой. Человек должен различать, что он утверждает
 * сам, а что взято из календаря: при разборе с начальником это разные по
 * весу утверждения, и стирать между ними границу нельзя.
 */

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

const DAY_TYPES: DayType[] = ["working", "pre_holiday", "holiday", "weekend"];

export interface YearCalendarEditorProps {
  profile: Profile;
  /**
   * Пересчитать период после сохранения.
   *
   * Без этого правка календаря молча расходилась бы с числами выше:
   * человек убирает рабочий день, видит «сохранено», а норма на экране
   * остаётся прежней. Показывать устаревший расчёт рядом с подтверждением
   * — худший исход, потому что выглядит он как успех.
   */
  onSaved?: () => void | Promise<void>;
}

export function YearCalendarEditor({ profile, onSaved }: YearCalendarEditorProps) {
  const brushId = useId();
  const fromId = useId();
  const toId = useId();

  const [days, setDays] = useState<CalendarDay[]>([]);
  const [brush, setBrush] = useState<DayType>("weekend");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [open, setOpen] = useState(false);

  const fail = useCallback((cause: unknown) => {
    setError(
      cause instanceof ApiError
        ? cause
        : new ApiError({
            type: "about:blank",
            title: "Сервер недоступен",
            status: 0,
            detail: "Не удалось получить календарь.",
          }),
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getCalendar(profile.id)
      .then((next) => {
        if (!cancelled) {
          setDays(next);
          setDirty(false);
        }
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [open, profile.id, fail]);

  const paint = useCallback((from: string, to: string, dayType: DayType) => {
    const [start, end] = from <= to ? [from, to] : [to, from];
    setDays((previous) =>
      previous.map((item) =>
        item.day >= start && item.day <= end
          ? { ...item, dayType, source: "override" }
          : item,
      ),
    );
    setDirty(true);
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // На сервер уходят ТОЛЬКО правки. Отправлять весь год значило бы
      // заморозить у человека снимок общего календаря: исправление в нём
      // до такого профиля уже не дошло бы никогда.
      const overrides = days
        .filter((item) => item.source === "override")
        .map((item) => ({ day: item.day, dayType: item.dayType }));
      const saved = await setCalendar(profile.id, overrides);
      setDays(saved);
      setDirty(false);
      await onSaved?.();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <section aria-labelledby="calendar" className="space-y-2">
        <h2 id="calendar" className="text-xl">
          Календарь {profile.accountingYear} года
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">
          Праздники по ст. 112 ТК РФ уже отмечены. Переносы выходных
          устанавливает Правительство отдельным постановлением на каждый год, и
          приложение их не знает — если ваш производственный календарь
          отличается, поправьте здесь. Ошибка в одном дне — это 8 часов нормы.
        </p>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Открыть календарь года
        </Button>
      </section>
    );
  }

  const byMonth = new Map<number, CalendarDay[]>();
  for (const item of days) {
    const month = Number(item.day.slice(5, 7)) - 1;
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(item);
    else byMonth.set(month, [item]);
  }

  const overrideCount = days.filter((item) => item.source === "override").length;

  return (
    <section aria-labelledby="calendar" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="calendar" className="text-xl">
          Календарь {profile.accountingYear} года
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Свернуть
        </Button>
      </div>

      {error ? <ErrorPanel error={error} /> : null}

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
              min={`${profile.accountingYear}-01-01`}
              max={`${profile.accountingYear}-12-31`}
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
              min={`${profile.accountingYear}-01-01`}
              max={`${profile.accountingYear}-12-31`}
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
            Производственный календарь {profile.accountingYear}: строки —
            месяцы, столбцы — числа
          </caption>
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
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
                  <th scope="row" className="whitespace-nowrap py-0.5 pr-3 text-left text-sm font-normal">
                    {name}
                  </th>
                  {Array.from({ length: 31 }, (_, index) => {
                    const item = items[index];
                    if (!item) return <td key={index} className="p-px" aria-hidden />;
                    return (
                      <td key={index} className="p-px">
                        <button
                          type="button"
                          aria-label={`${index + 1} ${name} — ${DAY_TYPE_LABELS[item.dayType]}${item.source === "override" ? ", изменено вами" : ""}`}
                          onClick={() => paint(item.day, item.day, brush)}
                          className={cn(
                            "relative flex size-6 items-center justify-center rounded-xs border font-mono text-[10px]",
                            "hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-trace",
                            DAY_TYPE_TONE[item.dayType],
                          )}
                        >
                          {DAY_TYPE_MARK[item.dayType]}
                          {item.source === "override" ? (
                            // Точка, а не цвет: цвет уже занят типом дня,
                            // и второй смысл на том же канале означал бы,
                            // что ни один не читается.
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
        <Button type="button" disabled={!dirty || busy} onClick={save}>
          {busy ? "Сохранение…" : "Сохранить календарь"}
        </Button>
        <p className="text-sm text-ink-muted" aria-live="polite">
          {dirty
            ? "Есть несохранённые изменения — расчёт их пока не учитывает."
            : `Ваших правок: ${overrideCount}.`}
        </p>
      </div>
    </section>
  );
}
