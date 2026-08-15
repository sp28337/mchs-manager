"use client";

import { CalendarCog, CalendarDays, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

import type { PeriodCalculation } from "../domain/calculation";
import type { StoredProfile } from "../storage/profile";
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
 * Переключатель ставит их в одно место экрана. Число оказывается ровно там
 * же, где было, — раскладка у сеток общая (`MonthGrid`), — и глазу не
 * нужно заново искать, куда смотреть.
 *
 * --- Почему периоды у них разные и это правильно -------------------------
 *
 * График показывает выбранный учётный период, календарь — весь год.
 * Уравнивать их было бы неверно: правки календаря относятся к году
 * целиком, и показать человеку только квартал значило бы спрятать от него
 * половину переносов, которые он собирался проверить.
 *
 * --- Зачем масштаб --------------------------------------------------------
 *
 * Двенадцать месяцев по три в ряд — это компромисс, который никому не
 * подходит целиком. Тому, кто ищет одну спорную смену, нужны крупные
 * клетки с читаемым кодом вызова; тому, кто смотрит, «как лёг год», нужны
 * все двенадцать месяцевразом, без прокрутки. Это разные задачи, и
 * выбирать между ними должен человек, а не вёрстка.
 *
 * Масштаб общий у обеих сеток: они читаются вперемежку, и разный масштаб
 * означал бы скачок размера при каждом переключении.
 *
 * Ниже `lg` управление скрыто: там колонок всё равно одна-две, и кнопки
 * меняли бы только то, чего на экране нет.
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
 *
 * Одного месяца в ряду здесь нет намеренно: на широком экране это клетки
 * по двести пикселей, где не появляется ни одного нового сведения — то же
 * число и тот же код вызова, только в пустоте.
 */
const SCALES = [
  { columns: 2, grid: "grid-cols-1 sm:grid-cols-2", text: "text-sm" },
  { columns: 3, grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", text: "text-xs" },
  { columns: 4, grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4", text: "text-xs" },
  { columns: 6, grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-6", text: "text-[11px]" },
] as const;

/** Три месяца в ряд — то, как блок выглядел до появления масштаба. */
const DEFAULT_SCALE = 1;

export type YearViewKind = "shifts" | "calendar";

export function YearView({
  profile,
  calculation,
  view,
  onViewChange,
  onChange,
}: {
  profile: StoredProfile;
  calculation: PeriodCalculation;
  view: YearViewKind;
  onViewChange: (view: YearViewKind) => void;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
}) {
  const [scale, setScale] = useState(DEFAULT_SCALE);

  const step = SCALES[scale] ?? SCALES[DEFAULT_SCALE];
  const grid = cn("grid gap-x-6 gap-y-5", step.grid, step.text);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Две кнопки, а не выпадающий список: положений всего два, и оба
            должны быть видны — человек переключается сюда-обратно, а не
            выбирает однажды. */}
        <div
          role="group"
          aria-label="Что показывать на сетке"
          className="flex flex-wrap gap-1"
        >
          <Button
            type="button"
            size="sm"
            variant={view === "shifts" ? "default" : "outline"}
            aria-pressed={view === "shifts"}
            onClick={() => onViewChange("shifts")}
          >
            <CalendarDays aria-hidden />
            График смен
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "calendar" ? "default" : "outline"}
            aria-pressed={view === "calendar"}
            onClick={() => onViewChange("calendar")}
          >
            <CalendarCog aria-hidden />
            Производственный календарь
          </Button>
        </div>

        <div className="hidden items-center gap-1 lg:flex">
          <span className="mr-1 font-display text-[11px] font-bold uppercase tracking-wide text-ink-muted">
            Масштаб
          </span>
          <Button
            type="button"
            size="icon"
            variant="outline"
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
            aria-label="Мельче: больше месяцев в ряду"
            disabled={scale === SCALES.length - 1}
            onClick={() =>
              setScale((previous) => Math.min(SCALES.length - 1, previous + 1))
            }
          >
            <ZoomOut aria-hidden />
          </Button>
          {/* Что именно изменилось, названо числом, а не «средний
              масштаб»: на экране это ровно число месяцев в ряду, и по нему
              человек сразу видит, докуда ещё можно тянуть. */}
          <span
            aria-live="polite"
            className="ml-1 w-20 font-mono text-[11px] text-ink-muted"
          >
            по {step.columns} в ряд
          </span>
        </div>
      </div>

      {view === "shifts" ? (
        <ShiftStrip calculation={calculation} gridClassName={grid} />
      ) : (
        <YearCalendarEditor profile={profile} onChange={onChange} gridClassName={grid} />
      )}
    </div>
  );
}
