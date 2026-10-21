"use client";

import { Pencil } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils/cn";

import {
  CUSTOM_PATTERN_ID,
  SCHEDULE_PATTERNS,
  type SchedulePattern,
  type SchedulePatternId,
} from "../domain/schedule-pattern";

/**
 * Выбор графика ритмом: у каждого варианта — его цикл, нарисованный клетками.
 *
 * --- Зачем не список ---------------------------------------------------------
 *
 * «1|3» и «2|2» — записи, которые человек этой работы понимает с одного взгляда,
 * но выбирать из выпадающего списка пятый пункт вслепую — всё равно угадывание.
 * Здесь цикл виден: заливкой отмечены рабочие сутки, пустотой — свободные, и
 * рисунок тот же, что у знака сайта, где одна заливка и три пустых клетки и есть
 * «сутки через трое». Выбрал — и справа в предпросмотре те же клетки встали
 * сменами по календарю.
 *
 * --- Как устроено -------------------------------------------------------------
 *
 * Обычные переключатели (`radio`), одна группа: стрелки, фокус и чтение
 * программой — от браузера, а не написаны заново. Внешний вид рисует соседний
 * элемент по состоянию (`peer-checked`, `peer-focus-visible`).
 *
 * Ширина рисунка у всех одинакова, а клетки в нём делят её поровну: четыре
 * клетки у «1|3» и семь у «5|2» занимают один и тот же прямоугольник, и ряд
 * вариантов не ходит от того, у какого цикл длиннее.
 *
 * «Свой цикл» — последний, как и в списке настроек: заготовки отвечают на частые
 * случаи, а вахта 15|15 в них не влезет никогда. Выбрав его, человек получает окно
 * с числами — как и в настройках; открывает его тот, кто рисует ряд.
 *
 * Пока своего цикла нет, вместо рисунка в нём карандаш: у «своего» нечего
 * рисовать, а клетки от прежних чисел выдали бы его за вторую «1|3».
 */

/** Цикл, как его рисуют: сколько клеток рабочих и сколько свободных. */
function cycleOf(pattern: Pick<SchedulePattern, "workDays" | "cycleDays">): boolean[] {
  return Array.from({ length: pattern.cycleDays }, (_, index) => index < pattern.workDays);
}

function Strip({ cells, active }: { cells: readonly boolean[] | null; active: boolean }) {
  if (cells === null) {
    return (
      <span aria-hidden className="flex h-3 w-12 items-center justify-center">
        <Pencil className="size-3" />
      </span>
    );
  }

  return (
    <span aria-hidden className="flex h-3 w-12 gap-px">
      {cells.map((work, index) => (
        <span
          key={index}
          className={cn(
            "min-w-0 flex-1 rounded-[3px] transition-colors duration-200",
            work ? (active ? "bg-verify" : "bg-verify/45") : "bg-ink/15",
          )}
        />
      ))}
    </span>
  );
}

export function RhythmPicker({
  value,
  custom,
  customLabel,
  onPick,
}: {
  value: SchedulePatternId;
  /** Цикл «своего» графика, когда он выбран и назван: рисуется в его варианте. `null` — карандаш. */
  custom: Pick<SchedulePattern, "workDays" | "cycleDays"> | null;
  /** Как «свой» называет себя: «Свой», пока цикла нет, и «3|1», когда он назван. */
  customLabel: string;
  onPick: (id: SchedulePatternId) => void;
}) {
  const group = useId();

  const options: {
    id: SchedulePatternId;
    label: string;
    title: string;
    /** Имя для программы чтения: надпись из клеток («2|2») в нём обязана остаться. */
    name: string;
    cells: boolean[] | null;
  }[] = [
    ...SCHEDULE_PATTERNS.map((pattern) => ({
      id: pattern.id,
      label: pattern.label,
      title: pattern.title,
      name: `${pattern.label}, ${pattern.title.toLowerCase()}`,
      cells: cycleOf(pattern),
    })),
    {
      id: CUSTOM_PATTERN_ID,
      label: customLabel,
      title: "Свой цикл",
      name: customLabel === "Свой" ? "Свой цикл" : `${customLabel}, свой цикл`,
      cells: custom === null ? null : cycleOf(custom),
    },
  ];

  return (
    <div role="radiogroup" aria-label="График" className="grid grid-cols-5 gap-1.5">
      {options.map((option) => {
        const active = option.id === value;

        return (
          <label key={option.id} title={option.title} className="relative block cursor-pointer">
            <input
              type="radio"
              name={group}
              value={option.id}
              checked={active}
              onChange={() => onPick(option.id)}
              aria-label={option.name}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border px-1 pt-2.5 pb-2",
                "transition-colors duration-200",
                // Выбранный — чернилами и на бумаге темнее окна: он «утоплен»,
                // как нажатая клавиша; остальные говорят вполголоса.
                active
                  ? "border-ink bg-paper-sunken text-ink"
                  : "border-rule text-ink-muted hover:border-ink-muted hover:text-ink",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink",
              )}
            >
              <Strip cells={option.cells} active={active} />
              <span className="font-mono text-sm leading-none">{option.label}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
