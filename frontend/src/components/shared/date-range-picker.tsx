"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";
import { inclusiveEnd } from "@/lib/utils/format";

/**
 * FE011 — выбор учётного периода.
 *
 * DoD: «выбор диапазона обновляет `periodStart`/`periodEnd` в URL search
 * params».
 *
 * --- Почему два поля даты, а не календарь-попап -------------------------
 *
 * Периоды в этой системе — учётные: месяц, квартал, полугодие, год
 * (ФЗ-141 ст. 55, суммированный учёт). Их выбирают не «мышкой по числам»,
 * а называют: «март», «второй квартал». Поэтому основной способ —
 * пресеты, а поля даты остаются для нестандартного отрезка.
 *
 * Нативный `<input type="date">` вместо календаря-компонента: он
 * локализован браузером, работает с клавиатуры без нашего участия и
 * понятен программам чтения с экрана. Собственный календарь пришлось бы
 * доводить до этого уровня руками, и обычно не доводят.
 *
 * --- Граница периода ----------------------------------------------------
 *
 * `periodEnd` — ИСКЛЮЧАЮЩАЯ во всём API (`[start, end)`), поэтому март
 * это `2026-03-01`…`2026-04-01`. Человеку показывается «по 31 марта»:
 * подпись переводит границу на человеческий язык, а в URL уходит то, что
 * ждёт сервер. Показывать «по 1 апреля» значило бы заставить каждого
 * пользователя держать в голове соглашение о полуинтервалах.
 */

interface Preset {
  label: string;
  compute: (today: Date) => { start: string; end: string };
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const PRESETS: Preset[] = [
  {
    label: "Текущий месяц",
    compute: (today) => ({
      start: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
      end: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))),
    }),
  },
  {
    label: "Прошлый месяц",
    compute: (today) => ({
      start: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))),
      end: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
    }),
  },
  {
    label: "Текущий квартал",
    compute: (today) => {
      const quarterStart = Math.floor(today.getUTCMonth() / 3) * 3;
      return {
        start: iso(new Date(Date.UTC(today.getUTCFullYear(), quarterStart, 1))),
        end: iso(new Date(Date.UTC(today.getUTCFullYear(), quarterStart + 3, 1))),
      };
    },
  },
  {
    label: "Текущий год",
    compute: (today) => ({
      start: iso(new Date(Date.UTC(today.getUTCFullYear(), 0, 1))),
      end: iso(new Date(Date.UTC(today.getUTCFullYear() + 1, 0, 1))),
    }),
  },
];

export interface DateRangePickerProps {
  className?: string;
}

export function DateRangePicker({ className }: DateRangePickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const startId = useId();
  const endId = useId();

  const currentStart = searchParams.get("periodStart") ?? "";
  const currentEnd = searchParams.get("periodEnd") ?? "";

  const [start, setStart] = useState(currentStart);
  const [end, setEnd] = useState(currentEnd);

  const apply = useCallback(
    (nextStart: string, nextEnd: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("periodStart", nextStart);
      next.set("periodEnd", nextEnd);
      // Смена периода возвращает на первую страницу: номер страницы
      // прежнего периода к новому отношения не имеет.
      next.set("page", "1");
      router.push(`?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const invalid = Boolean(start && end && end <= start);

  return (
    <form
      className={cn("flex flex-wrap items-start gap-3", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid && start && end) apply(start, end);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={startId}>Период с</Label>
        <Input
          id={startId}
          type="date"
          value={start}
          onChange={(event) => setStart(event.target.value)}
          className="w-40"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={endId}>по (включительно)</Label>
        <Input
          id={endId}
          type="date"
          value={end}
          onChange={(event) => setEnd(event.target.value)}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${endId}-error` : undefined}
          className="w-40"
        />
        {end && !invalid ? (
          <p className="font-mono text-[11px] text-ink-faint">
            по {inclusiveEnd(end).toLocaleDateString("ru-RU", { timeZone: "UTC" })}
          </p>
        ) : null}
        {invalid ? (
          <p id={`${endId}-error`} role="alert" className="text-xs text-signal">
            Конец периода должен быть позже начала.
          </p>
        ) : null}
      </div>

      {/* Кнопка и пресеты выравниваются по полю, а не по подписи: отступ
          повторяет высоту `Label` со строкой ниже. */}
      <Button
        type="submit"
        variant="outline"
        className="mt-[1.375rem]"
        disabled={invalid || !start || !end}
      >
        Показать
      </Button>

      <div className="mt-[1.375rem] flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const range = preset.compute(new Date());
              setStart(range.start);
              setEnd(range.end);
              apply(range.start, range.end);
            }}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </form>
  );
}
