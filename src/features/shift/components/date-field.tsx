"use client";

import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAnchoredPosition } from "@/lib/hooks/use-anchored-position";
import { cn } from "@/lib/utils/cn";

import { formatDateRu, maskDateRu, parseDateRu } from "../domain/format";
import {
  datesOfMonth,
  dayOfMonth,
  monthIndex,
  todayIso,
  year as yearOf,
  type IsoDate,
} from "../domain/plain-date";
import { MONTH_NAMES } from "./month-names";
import { MonthGrid } from "./month-grid";

/**
 * Ввод даты: и с клавиатуры, и календарём.
 *
 * --- Почему не `<input type="date">` -------------------------------------
 *
 * Нативное поле показывает дату по настройкам БРАУЗЕРА, а не по языку
 * страницы: `lang="ru"` на него не влияет. У большинства оно выглядит как
 * `mm/dd/yyyy` — американский порядок посреди русского интерфейса.
 * Перепутать в нём 03.01 и 01.03 не просто легко, а естественно, и цена
 * ошибки здесь — две недели чужого отпуска, ушедшие в расчёт.
 *
 * --- Почему оба способа, а не один --------------------------------------
 *
 * Даты отпуска человек переписывает из приказа, где они уже написаны
 * цифрами: набрать восемь цифр быстрее, чем щёлкать по календарю. А вот
 * границу больничного или «ту субботу, которую сделали рабочей» он ищет
 * глазами по неделям, и тут нужен именно календарь. Отобрать любой из двух
 * способов — значит сделать половину случаев неудобными.
 *
 * Поле и календарь показывают одно значение: набранное с клавиатуры
 * подсвечивается в сетке, выбранное в сетке попадает в поле.
 *
 * --- Почему ошибка показывается, а не исправляется -----------------------
 *
 * `31.02.2026` не превращается в 3 марта. `Date` поступил бы именно так, и
 * в расчёт попал бы день, которого человек не вводил, — молча.
 */

export interface DateFieldProps {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: IsoDate;
  /** Границы допустимого — включительно. */
  min?: IsoDate;
  max?: IsoDate;
  hint?: string;
  className?: string;
  onChange?: (value: IsoDate | null) => void;
}

export function DateField({
  label,
  name,
  required = false,
  defaultValue,
  min,
  max,
  hint,
  className,
  onChange,
}: DateFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  const [text, setText] = useState(defaultValue ? formatDateRu(defaultValue) : "");
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);

  const parsed = parseDateRu(text);
  const empty = text.trim() === "";

  let problem: string | null = null;
  if (touched && !empty && parsed === null) {
    problem = "Не похоже на дату. Формат: ДД.ММ.ГГГГ";
  } else if (parsed !== null && min !== undefined && parsed < min) {
    problem = `Не раньше ${formatDateRu(min)}`;
  } else if (parsed !== null && max !== undefined && parsed > max) {
    problem = `Не позже ${formatDateRu(max)}`;
  } else if (touched && empty && required) {
    problem = "Укажите дату";
  }

  const valid = parsed !== null && problem === null;

  function commit(next: string) {
    setText(next);
    onChange?.(parseDateRu(next));
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={inputId}>{label}</Label>

      <div className="relative flex items-start gap-1">
        <Input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="ДД.ММ.ГГГГ"
          value={text}
          aria-describedby={cn(hint ? hintId : undefined, problem ? errorId : undefined)}
          aria-invalid={problem !== null}
          className={cn("w-36 font-mono", problem && "border-signal")}
          onChange={(event) => commit(maskDateRu(event.target.value))}
          onBlur={() => setTouched(true)}
        />

        <CalendarPopover
          open={open}
          onOpenChange={setOpen}
          selected={valid ? parsed : null}
          min={min}
          max={max}
          onPick={(day) => {
            commit(formatDateRu(day));
            setTouched(true);
            setOpen(false);
          }}
        />
      </div>

      {/* Разобранное значение — единственное, что уходит в форму. Пустая
          строка при неверном вводе намеренна: пусть форма откажет, чем
          примет наполовину набранную дату. */}
      <input type="hidden" name={name} value={valid ? parsed : ""} />

      {hint ? (
        <p id={hintId} className="max-w-44 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {problem ? (
        <p id={errorId} role="alert" className="max-w-44 text-xs text-signal">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** Ширина всплывающего календаря; она же нужна для расчёта его места. */
const POPOVER_WIDTH = 288;

/**
 * Всплывающий календарь.
 *
 * Своими руками, а не библиотекой: нужна ровно одна месячная сетка — та
 * же, что показывает график смен, — и тянуть ради неё пакет с порталами и
 * позиционированием значило бы добавить сотню килобайт к приложению,
 * которое целиком весит меньше.
 *
 * Место считается хуком `useAnchoredPosition` — там же объяснено, почему
 * слой `fixed`, а не `absolute`.
 */
function CalendarPopover({
  open,
  onOpenChange,
  selected,
  min,
  max,
  onPick,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  selected: IsoDate | null;
  min?: IsoDate;
  max?: IsoDate;
  onPick: (day: IsoDate) => void;
}) {
  const dialogId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const anchor = selected ?? clamp(todayIso(), min, max);
  const [view, setView] = useState({ year: yearOf(anchor), month: monthIndex(anchor) + 1 });

  // Правым краем к кнопке: поле даты стоит слева в своей колонке, и
  // календарь, разложенный вправо, вылез бы за неё.
  const place = useAnchoredPosition(open, trigger, {
    width: POPOVER_WIDTH,
    align: "right",
  });

  // Закрытие по щелчку мимо и по Escape. Без первого календарь остаётся
  // висеть над формой и перекрывает соседнее поле; без второго с
  // клавиатуры из него не выйти.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) onOpenChange(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
        trigger.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  const days = datesOfMonth(view.year, view.month);
  const today = todayIso();

  function step(delta: number) {
    setView((previous) => {
      const next = previous.month + delta;
      if (next < 1) return { year: previous.year - 1, month: 12 };
      if (next > 12) return { year: previous.year + 1, month: 1 };
      return { ...previous, month: next };
    });
  }

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={open ? "Закрыть календарь" : "Выбрать дату в календаре"}
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => {
          // Открытие всегда показывает месяц выбранной даты. Иначе человек,
          // закрывший календарь на декабре и вернувшийся к мартовской
          // дате, увидел бы декабрь и решил бы, что выбор потерялся.
          //
          // Сброс здесь, а не в эффекте: эффект, синхронно меняющий
          // состояние, вызывает лишний прогон отрисовки, и React
          // справедливо на это ругается.
          if (!open) setView({ year: yearOf(anchor), month: monthIndex(anchor) + 1 });
          onOpenChange(!open);
        }}
        className={cn(
          "flex size-9 items-center justify-center rounded-xs border border-rule-strong bg-paper",
          "hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-trace",
          open && "border-ink",
        )}
      >
        <CalendarDays aria-hidden className="size-4" />
      </button>

      {open ? (
        <div
          id={dialogId}
          role="dialog"
          aria-label="Выбор даты"
          style={{
            top: place?.top ?? 0,
            left: place?.left ?? 0,
            width: POPOVER_WIDTH,
            // До первого замера календарь не показывается: иначе он мигнул
            // бы в левом верхнем углу окна и прыгнул на место.
            visibility: place ? "visible" : "hidden",
          }}
          className="fixed z-50 space-y-2 rounded-sm border border-rule-strong bg-paper-raised p-3 shadow-lg"
        >
          <div className="flex items-center justify-between gap-2">
            <Arrow label="Предыдущий месяц" onClick={() => step(-1)}>
              <ChevronLeft aria-hidden className="size-4" />
            </Arrow>
            <p aria-live="polite" className="font-display text-sm font-bold uppercase tracking-wide">
              {MONTH_NAMES[view.month - 1]} {view.year}
            </p>
            <Arrow label="Следующий месяц" onClick={() => step(1)}>
              <ChevronRight aria-hidden className="size-4" />
            </Arrow>
          </div>

          <MonthGrid
            days={days}
            renderDay={(day) => {
              const blocked =
                (min !== undefined && day < min) || (max !== undefined && day > max);
              return (
                <button
                  type="button"
                  disabled={blocked}
                  aria-current={day === selected ? "date" : undefined}
                  aria-label={formatDateRu(day)}
                  onClick={() => onPick(day)}
                  className={cn(
                    "flex aspect-square w-full items-center justify-center rounded-xs border font-mono text-xs",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-trace",
                    blocked && "cursor-not-allowed border-transparent text-ink-faint opacity-40",
                    !blocked && "border-transparent hover:border-ink",
                    day === today && !blocked && "border-rule-strong",
                    day === selected && "border-ink bg-ink text-paper",
                  )}
                >
                  {dayOfMonth(day)}
                </button>
              );
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function Arrow({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-xl text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-trace"
    >
      {children}
    </button>
  );
}

function clamp(day: IsoDate, min?: IsoDate, max?: IsoDate): IsoDate {
  if (min !== undefined && day < min) return min;
  if (max !== undefined && day > max) return max;
  return day;
}
