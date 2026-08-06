"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ErrorPanel } from "@/components/shared/error-panel";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client/client";
import { cn } from "@/lib/utils/cn";

import { addPlannedShift } from "../api";
import {
  DUTY_TYPE_LABELS,
  DUTY_TYPE_TONE,
  type DutySchedule,
  type DutyType,
  type PlannedShift,
} from "../schemas";

/**
 * FE025 — сетка графика дежурств.
 *
 * DoD: «перетаскивание вызывает `AddPlannedShift`, конфликт показывает
 * баннер».
 *
 * --- Перетаскивание не может быть ЕДИНСТВЕННЫМ способом ----------------
 *
 * WCAG 2.2, критерий 2.5.7 (Dragging Movements): всё, что делается
 * перетаскиванием, обязано делаться и без него — одним указателем. Для
 * клавиатуры это тем более так: перетащить с клавиатуры нельзя вовсе.
 *
 * Поэтому у каждой клетки два пути к одному действию. Перетащить
 * сотрудника из списка на день — быстрый способ для мыши. Выбрать
 * сотрудника кнопкой, затем нажать «+» в клетке — тот же вызов
 * `AddPlannedShift`, доступный с клавиатуры и одним касанием на планшете.
 *
 * Это не «версия для доступности» рядом с настоящей: оба пути ведут в ту
 * же функцию, и второй остаётся быстрее там, где смену ставят одному
 * человеку на десять дней подряд.
 *
 * --- Конфликт показывается баннером, а не тостом ------------------------
 *
 * Сервер отвергает пересечение смен (409) и нарушение межсменного отдыха
 * (422, ФЗ-141 ст. 55: не менее 42 часов). Оба отказа означают, что
 * планировщику надо ПЕРЕСМОТРЕТЬ расстановку, а не «повторить действие»;
 * всплывающее уведомление исчезнет раньше, чем он поймёт, какую смену
 * двигать. Баннер остаётся на экране, пока конфликт не разрешён.
 *
 * --- Утверждённый график сетку не открывает ----------------------------
 *
 * Инвариант 5.1.3: утверждённый график неизменяем, сервер ответит 423.
 * Клетки перестают быть целями, а список сотрудников не показывается —
 * приглашать к действию, которое отклонят, значит тратить чужое время.
 */

export interface RosterEntry {
  id: string;
  fullName: string;
}

export interface ShiftCalendarGridProps {
  schedule: DutySchedule;
  /** Сотрудники подразделения, которых можно ставить в наряд. */
  roster: RosterEntry[];
  token?: string | null;
  onChanged?: () => void;
}

/** Смены начинаются в 08:00 — типовое время развода караула. */
const SHIFT_START_HOUR = 8;

const DUTY_DURATIONS: Record<DutyType, number> = {
  twenty_four_hour_duty: 24,
  day_shift: 12,
  night_shift: 12,
  standby: 8,
};

function daysOf(periodStart: string, periodEnd: string): Date[] {
  const days: Date[] = [];
  const cursor = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  while (cursor < end) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function ShiftCalendarGrid({
  schedule,
  roster,
  token,
  onChanged,
}: ShiftCalendarGridProps) {
  const [error, setError] = useState<ApiError | null>(null);
  const [pendingCell, setPendingCell] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [dutyType, setDutyType] = useState<DutyType>("twenty_four_hour_duty");

  const editable = schedule.status === "draft";
  const days = useMemo(
    () => daysOf(schedule.periodStart, schedule.periodEnd),
    [schedule.periodStart, schedule.periodEnd],
  );

  // Смены по сотруднику и дню: без индекса отрисовка сетки 20×31 была бы
  // перебором всех смен в каждой клетке (`js-index-maps`).
  const byCell = useMemo(() => {
    const index = new Map<string, PlannedShift[]>();
    for (const shift of schedule.shifts ?? []) {
      const key = `${shift.employeeId}:${shift.startTime.slice(0, 10)}`;
      const bucket = index.get(key);
      if (bucket) bucket.push(shift);
      else index.set(key, [shift]);
    }
    return index;
  }, [schedule.shifts]);

  const place = useCallback(
    async (employeeId: string, day: Date) => {
      const cell = `${employeeId}:${dayKey(day)}`;
      setPendingCell(cell);
      setError(null);

      const start = new Date(day);
      start.setUTCHours(SHIFT_START_HOUR, 0, 0, 0);
      const end = new Date(start);
      end.setUTCHours(end.getUTCHours() + DUTY_DURATIONS[dutyType]);

      try {
        await addPlannedShift(
          schedule.id,
          {
            employeeId,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            dutyType,
          },
          { token, idempotencyKey: crypto.randomUUID() },
        );
        toast.success("Смена поставлена в график");
        onChanged?.();
      } catch (cause) {
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError({
                type: "about:blank",
                title: "Сервер недоступен",
                status: 0,
                detail: "Не удалось поставить смену. Проверьте соединение.",
              }),
        );
      } finally {
        setPendingCell(null);
      }
    },
    [dutyType, onChanged, schedule.id, token],
  );

  return (
    <div className="space-y-4">
      {error ? <ErrorPanel error={error} /> : null}

      {editable ? (
        <div className="flex flex-wrap items-end gap-4 rounded-sm border border-rule bg-paper-raised p-4">
          <fieldset className="space-y-1.5">
            <legend className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
              Вид дежурства
            </legend>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(DUTY_TYPE_LABELS) as DutyType[]).map((type) => (
                <Button
                  key={type}
                  type="button"
                  size="sm"
                  variant={dutyType === type ? "default" : "outline"}
                  aria-pressed={dutyType === type}
                  onClick={() => setDutyType(type)}
                >
                  {DUTY_TYPE_LABELS[type]}
                </Button>
              ))}
            </div>
          </fieldset>

          <fieldset className="min-w-0 flex-1 space-y-1.5">
            <legend className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
              Сотрудник
            </legend>
            <div className="flex flex-wrap gap-1">
              {roster.map((person) => (
                <Button
                  key={person.id}
                  type="button"
                  size="sm"
                  variant={selectedEmployee === person.id ? "default" : "outline"}
                  aria-pressed={selectedEmployee === person.id}
                  onClick={() =>
                    setSelectedEmployee(selectedEmployee === person.id ? null : person.id)
                  }
                  // Перетаскивание — второй путь к тому же действию,
                  // а не единственный (WCAG 2.2, 2.5.7).
                  draggable
                  onDragStart={(event) =>
                    event.dataTransfer.setData("text/plain", person.id)
                  }
                >
                  {person.fullName}
                </Button>
              ))}
            </div>
            <p className="text-xs text-ink-muted">
              Выберите сотрудника и нажмите «+» в нужном дне — либо перетащите его
              карточку на день.
            </p>
          </fieldset>
        </div>
      ) : (
        <p className="rounded-sm border-l-2 border-rule-strong bg-paper-sunken px-4 py-3 text-sm text-ink-muted">
          График утверждён и неизменяем (инвариант 5.1.3). Изменения оформляются
          пересмотром — он создаёт новую редакцию, а не правит приказ.
        </p>
      )}

      <div className="overflow-x-auto" role="region" aria-label="Сетка графика" tabIndex={0}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            График дежурств: строки — сотрудники, столбцы — дни периода
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-paper px-2 py-1 text-left font-display text-xs font-bold uppercase tracking-wide text-ink-muted"
              >
                Сотрудник
              </th>
              {days.map((day) => (
                <th
                  key={dayKey(day)}
                  scope="col"
                  className={cn(
                    "px-1 py-1 text-center font-mono text-[11px] font-normal",
                    day.getUTCDay() === 0 || day.getUTCDay() === 6
                      ? "text-signal"
                      : "text-ink-muted",
                  )}
                >
                  {day.getUTCDate()}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {roster.map((person) => (
              <tr key={person.id} className="border-t border-rule">
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-40 truncate bg-paper px-2 py-1 text-left font-normal"
                >
                  {person.fullName}
                </th>

                {days.map((day) => {
                  const key = `${person.id}:${dayKey(day)}`;
                  const shifts = byCell.get(key) ?? [];
                  const busy = pendingCell === key;

                  return (
                    <td
                      key={key}
                      className="p-0.5 align-top"
                      onDragOver={(event) => {
                        if (editable) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (!editable) return;
                        event.preventDefault();
                        const employeeId = event.dataTransfer.getData("text/plain");
                        if (employeeId) void place(employeeId, day);
                      }}
                    >
                      {shifts.length > 0 ? (
                        shifts.map((shift) => (
                          <span
                            key={shift.id}
                            title={DUTY_TYPE_LABELS[shift.dutyType]}
                            className={cn(
                              "block rounded-xs border px-1 text-center font-mono text-[10px]",
                              DUTY_TYPE_TONE[shift.dutyType],
                            )}
                          >
                            {DUTY_TYPE_LABELS[shift.dutyType].slice(0, 3)}
                          </span>
                        ))
                      ) : editable ? (
                        <button
                          type="button"
                          disabled={!selectedEmployee || busy}
                          onClick={() =>
                            selectedEmployee && void place(selectedEmployee, day)
                          }
                          aria-label={`Поставить смену: ${person.fullName}, ${day.getUTCDate()} число`}
                          className="block w-full rounded-xs border border-dashed border-rule px-1 text-center text-[10px] text-ink-faint hover:border-rule-strong hover:text-ink disabled:opacity-40"
                        >
                          {busy ? "…" : "+"}
                        </button>
                      ) : (
                        <span className="block px-1 text-center text-[10px] text-ink-faint">
                          ·
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {roster.length === 0 ? (
        <p className="text-sm text-ink-muted">
          В подразделении нет сотрудников, доступных для расстановки.
        </p>
      ) : null}
    </div>
  );
}
