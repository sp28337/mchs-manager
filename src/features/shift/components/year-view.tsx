"use client";

import { CalendarCog, CalendarDays, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";

import type { PeriodCalculation } from "../domain/calculation";
import type { IsoDate } from "../domain/plain-date";
import type { AccountingPeriodKind } from "../domain/value-objects";
import type { StoredProfile } from "../storage/profile";
import { MONTH_NAMES } from "./month-names";
import { ShiftStrip } from "./shift-strip";
import { YearCalendarEditor } from "./year-calendar-editor";

/**
 * Год на сетке: график смен и производственный календарь на одном месте.
 *
 * --- Почему это один блок, а не два --------------------------------------
 *
 * Обе сетки показывают одно и то же — месяцы года клетками по дням недели,
 * — и человек смотрит их по очереди, сверяя одно с другим: «у меня тут
 * смена, а день-то рабочий или праздничный?». Двумя разделами подряд это
 * означало прокрутку между ними: пока долистаешь до календаря, клетка
 * графика, из-за которой пошёл, уже за экраном.
 *
 * --- Почему выбор периода тоже здесь -------------------------------------
 *
 * Он жил в боковой колонке и управлял тем, что нарисовано в этой сетке, —
 * то есть человек менял период в одном углу экрана, а смотрел на
 * последствия в другом. Теперь орган управления стоит вплотную к тому,
 * чем управляет: год, полугодие, квартал и месяц выбираются над самой
 * сеткой.
 *
 * --- Почему периоды сегментами, а месяц списком --------------------------
 *
 * Видов периода два-три, и они взаимоисключающие: сегменты показывают все
 * сразу и сразу говорят, какой занят. Месяцев тринадцать вместе с «весь
 * период» — сегментами это лента в пол-экрана, поэтому список.
 *
 * --- Зачем масштаб --------------------------------------------------------
 *
 * Двенадцать месяцев по три в ряд — компромисс, который никому не подходит
 * целиком. Тому, кто ищет одну спорную смену, нужны крупные клетки с
 * читаемым кодом вызова; тому, кто смотрит, «как лёг год», нужны все
 * двенадцать месяцев разом, без прокрутки. Это разные задачи, и выбирать
 * между ними должен человек, а не вёрстка.
 *
 * Масштаб общий у обеих сеток: они читаются вперемежку, и разный масштаб
 * означал бы скачок размера при каждом переключении.
 */

/**
 * Ступени масштаба — числом месяцев в ряду на широком экране.
 *
 * Классы записаны целиком, а не собраны из кусков: Tailwind ищет имена
 * классов в тексте программы, и `lg:grid-cols-${n}` он не найдёт.
 *
 * Вместе с числом колонок меняется и КЕГЛЬ в клетке: клетка квадратная и
 * растёт вместе с шириной месяца, а число внутри без этого осталось бы
 * прежним — получались бы пустые квадраты с мелкой цифрой в середине.
 * Размеры внутри клетки заданы в `em` и потому следуют за этим классом.
 */
const SCALES = [
  { columns: 2, grid: "grid-cols-1 sm:grid-cols-2", text: "text-sm" },
  { columns: 3, grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", text: "text-xs" },
  { columns: 4, grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4", text: "text-xs" },
  { columns: 6, grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-6", text: "text-[11px]" },
] as const;

/** Три месяца в ряд — то, как блок выглядел до появления масштаба. */
const DEFAULT_SCALE = 1;

/** Подпись вида периода — числом месяцев, как на настенном календаре. */
const KIND_LABELS: Record<AccountingPeriodKind, string> = {
  quarter: "3 месяца",
  half_year: "6 месяцев",
  year: "Год",
};

export type YearViewKind = "shifts" | "calendar";

/** Сколько месяцев в периоде такого вида. */
function monthsIn(kind: AccountingPeriodKind): number {
  return kind === "quarter" ? 3 : kind === "half_year" ? 6 : 12;
}

function partLabel(kind: AccountingPeriodKind, index: number, year: number): string {
  if (kind === "year") return `${year} год`;
  return `${index + 1}-${kind === "quarter" ? "й квартал" : "е полугодие"}`;
}

export interface StatutoryChoice {
  kind: AccountingPeriodKind;
  index: number;
}

export function YearView({
  profile,
  calculation,
  view,
  onViewChange,
  onChange,
  periods,
  statutory,
  onStatutory,
  month,
  onMonth,
  onPickDay,
}: {
  profile: StoredProfile;
  calculation: PeriodCalculation;
  view: YearViewKind;
  onViewChange: (view: YearViewKind) => void;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  periods: readonly AccountingPeriodKind[];
  statutory: StatutoryChoice;
  onStatutory: (choice: StatutoryChoice) => void;
  /** Месяц внутри периода или `null` — «весь период». */
  month: number | null;
  onMonth: (month: number | null) => void;
  onPickDay: (day: IsoDate) => void;
}) {
  const [scale, setScale] = useState(DEFAULT_SCALE);

  const step = SCALES[scale] ?? SCALES[DEFAULT_SCALE];
  const grid = cn("grid gap-x-6 gap-y-5", step.grid, step.text);

  const span = monthsIn(statutory.kind);
  const first = statutory.index * span;
  const monthsAvailable = Array.from({ length: span }, (_, offset) => first + offset);
  const parts = 12 / span;

  return (
    <div className="space-y-4">
      {/* Одна панель на всё управление сеткой: что показать, за какой
          период и каким размером. Разнеси это по углам — и человек будет
          искать, где переключается год. */}
      <div className="space-y-3 rounded-xl border border-rule bg-paper-raised p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented label="Что показывать на сетке">
            <SegmentedItem
              active={view === "shifts"}
              onClick={() => onViewChange("shifts")}
            >
              <CalendarDays aria-hidden />
              График смен
            </SegmentedItem>
            <SegmentedItem
              active={view === "calendar"}
              onClick={() => onViewChange("calendar")}
            >
              <CalendarCog aria-hidden />
              <span className="hidden sm:inline">Производственный календарь</span>
              <span className="sm:hidden">Календарь</span>
            </SegmentedItem>
          </Segmented>

          <div className="hidden items-center gap-1 lg:flex">
            <span className="mr-1 font-display text-[11px] font-bold uppercase tracking-wide text-ink-muted">
              Масштаб
            </span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="rounded-xl"
              aria-label="Крупнее: меньше месяцев в ряду"
              disabled={scale === 0}
              onClick={() => setScale((previous) => Math.max(0, previous - 1))}
            >
              <ZoomIn aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="rounded-xl"
              aria-label="Мельче: больше месяцев в ряду"
              disabled={scale === SCALES.length - 1}
              onClick={() =>
                setScale((previous) => Math.min(SCALES.length - 1, previous + 1))
              }
            >
              <ZoomOut aria-hidden />
            </Button>
            {/* Что именно изменилось, названо числом, а не «средний
                масштаб»: на экране это ровно число месяцев в ряду, и по
                нему человек сразу видит, докуда ещё можно тянуть. */}
            <span
              aria-live="polite"
              className="ml-1 w-20 font-mono text-[11px] text-ink-muted"
            >
              по {step.columns} в ряд
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          {/* Длина учётного периода. Виды берутся из приказа: сотруднику
              полугодие или год, работнику ещё и квартал. */}
          <Segmented label="Длина учётного периода">
            {periods.map((kind) => (
              <SegmentedItem
                key={kind}
                active={statutory.kind === kind}
                onClick={() => {
                  onStatutory({ kind, index: 0 });
                  onMonth(null);
                }}
              >
                {KIND_LABELS[kind]}
              </SegmentedItem>
            ))}
          </Segmented>

          {/* Который по счёту — только когда их несколько: у года выбирать
              не из чего, и список из одного пункта был бы обманом. */}
          {parts > 1 ? (
            <Select
              aria-label="Который период"
              className="h-9 w-auto rounded-xl"
              value={statutory.index}
              onChange={(event) => {
                onStatutory({ kind: statutory.kind, index: Number(event.target.value) });
                // Месяц сбрасывается вместе с периодом: он выбирался из
                // месяцев прежнего и в новый может не входить.
                onMonth(null);
              }}
            >
              {Array.from({ length: parts }, (_, index) => (
                <option key={index} value={index}>
                  {partLabel(statutory.kind, index, profile.accountingYear)}
                </option>
              ))}
            </Select>
          ) : null}

          <Select
            aria-label="Месяц внутри периода"
            className="h-9 w-auto rounded-xl"
            value={month === null ? "all" : String(month)}
            onChange={(event) => {
              const raw = event.target.value;
              onMonth(raw === "all" ? null : Number(raw));
            }}
          >
            <option value="all">Весь период</option>
            {monthsAvailable.map((index) => (
              <option key={index} value={index}>
                {MONTH_NAMES[index]}
              </option>
            ))}
          </Select>

          <span className="ml-auto font-mono text-[11px] text-ink-muted">
            {profile.accountingYear}
          </span>
        </div>
      </div>

      {/* Сетка стоит здесь, и над ней — только панель управления,
          одинаковая у обоих видов. Поэтому при переключении клетка
          остаётся ровно на своём месте: проверено замером, положение
          первой клетки и прокрутка страницы не меняются ни на пиксель. */}
      {view === "shifts" ? (
        <ShiftStrip
          calculation={calculation}
          gridClassName={grid}
          dayNotes={profile.dayNotes}
          onPickDay={onPickDay}
        />
      ) : (
        <YearCalendarEditor profile={profile} onChange={onChange} gridClassName={grid} />
      )}
    </div>
  );
}
