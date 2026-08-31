"use client";

import { CalendarCog, Clock, Pencil, StickyNote, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { formatDateRu } from "../domain/format";
import type { IsoDate } from "../domain/plain-date";
import type { DayType } from "../domain/production-calendar";
import {
  ABSENCE_LABELS,
  CALLOUT_LABELS,
  DAY_TYPE_LABELS,
} from "../schemas";
import type { StoredProfile } from "../storage/profile";
import {
  ABSENCE_MARK,
  ABSENCE_TONE,
  CALLOUT_MARK,
  CALLOUT_TONE,
  DAY_OFF_MARK,
  DAY_OFF_TONE,
  SHIFT_TONE,
} from "./day-marks";

/**
 * Всё, что человек внёс в график, — одним списком.
 *
 * --- Зачем ----------------------------------------------------------------
 *
 * Внесённое лежит по всему году: отпуск в июле, больничный в феврале,
 * перенесённая смена в ноябре. Пока их немного, они помнятся; к декабрю их
 * два десятка, и вопрос «что я вообще наотмечал» отвечается только
 * пролистыванием двенадцати месяцев по клетке.
 *
 * Здесь тот же год, но собранный в перечень: что, когда и с какого по
 * какое. Отсюда же его можно убрать — а если нужно переставить или
 * поправить часы, открыть те самые сутки на сетке.
 *
 * --- Почему одним списком, а не по видам ----------------------------------
 *
 * Разложить по видам напрашивается — и было бы хуже. Человек ищет здесь не
 * «все больничные», а «что стоит в конце марта»: спор с табелем идёт по
 * датам, а не по видам. Поэтому порядок один и он хронологический, а вид
 * говорит значок — тот же самый, что стоит в клетке на сетке и в легенде.
 *
 * --- Почему у каждой строки свой значок -----------------------------------
 *
 * Не для красоты. Значок в строке и значок в клетке — один и тот же
 * рисунок, и это единственное, что связывает перечень с сеткой: человек,
 * увидев «Б» в списке, узнает его на графике, не читая подписи.
 */

/** Одна внесённая правка, приведённая к общему виду. */
type Change = {
  /** Ключ для React и для удаления. */
  id: string;
  /** По этой дате правка попадает в хронологию и открывается на сетке. */
  day: IsoDate;
  /** Значок — тот же, что в клетке. */
  mark: ReactNode;
  what: string;
  when: string;
  /** Какой сеткой открывать сутки: правки календаря живут на своей. */
  grid: "shifts" | "calendar";
  remove: (previous: StoredProfile) => StoredProfile;
};

/** Клетка со значком — ровно такая же, как на сетке и в легенде. */
function Mark({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md border text-xs font-bold",
        tone,
      )}
    >
      {children}
    </span>
  );
}

/** Значок для правок, у которых своей клетки на сетке нет. */
function ToolMark({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-md border border-rule bg-paper-raised text-ink-muted [&_svg]:size-3.5"
    >
      {children}
    </span>
  );
}

/** Запись без одного ключа. Отдельной функцией — иначе на каждое удаление
    приходится развязка с переменной, которую тут же выбрасывают. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const rest: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) if (k !== key) rest[k] = v;
  return rest;
}

/** Отрезок дат словами: одни сутки называются одной датой, а не дважды. */
function period(from: IsoDate, to: IsoDate): string {
  return from === to ? formatDateRu(from) : `${formatDateRu(from)} — ${formatDateRu(to)}`;
}

/**
 * Собрать перечень из профиля.
 *
 * Порядок — по дате, а внутри одной даты — в том порядке, в каком виды
 * перечислены здесь: отсутствие раньше вызова, вызов раньше правки
 * графика. Это не важно для расчёта и важно для чтения: два события в
 * одних сутках должны стоять в одном и том же порядке каждый раз, иначе
 * список «дрожит» при каждой правке.
 */
export function changesOf(profile: StoredProfile): Change[] {
  const rows: Change[] = [];

  for (const absence of profile.absences) {
    rows.push({
      id: `absence:${absence.id}`,
      day: absence.startsOn as IsoDate,
      mark: (
        <Mark tone={ABSENCE_TONE[absence.kind]}>{ABSENCE_MARK[absence.kind]}</Mark>
      ),
      what: ABSENCE_LABELS[absence.kind],
      when: period(absence.startsOn as IsoDate, absence.endsOn as IsoDate),
      grid: "shifts",
      remove: (previous) => ({
        ...previous,
        absences: previous.absences.filter((x) => x.id !== absence.id),
      }),
    });
  }

  for (const callout of profile.callouts) {
    rows.push({
      id: `callout:${callout.id}`,
      day: callout.startsOn as IsoDate,
      mark: <Mark tone={CALLOUT_TONE}>{CALLOUT_MARK[callout.kind]}</Mark>,
      what: CALLOUT_LABELS[callout.kind],
      when: `${period(callout.startsOn as IsoDate, callout.endsOn as IsoDate)} · ${callout.hoursPerDay} ч в сутки`,
      grid: "shifts",
      remove: (previous) => ({
        ...previous,
        callouts: previous.callouts.filter((x) => x.id !== callout.id),
      }),
    });
  }

  for (const [day, kind] of Object.entries(profile.shiftOverrides)) {
    rows.push({
      id: `shift:${day}`,
      day: day as IsoDate,
      mark:
        kind === "shift" ? (
          <Mark tone={SHIFT_TONE}>С</Mark>
        ) : (
          <Mark tone={DAY_OFF_TONE}>{DAY_OFF_MARK}</Mark>
        ),
      what: kind === "shift" ? "Смена вне графика" : "Смена отменена",
      when: formatDateRu(day as IsoDate),
      grid: "shifts",
      remove: (previous) => ({
        ...previous,
        shiftOverrides: without(previous.shiftOverrides, day),
      }),
    });
  }

  for (const [day, span] of Object.entries(profile.shiftTimes)) {
    rows.push({
      id: `time:${day}`,
      day: day as IsoDate,
      mark: (
        <ToolMark>
          <Clock aria-hidden />
        </ToolMark>
      ),
      what: "Свои часы смены",
      when: `${formatDateRu(day as IsoDate)} · с ${span.startsAt} до ${span.endsAt}`,
      grid: "shifts",
      remove: (previous) => ({
        ...previous,
        shiftTimes: without(previous.shiftTimes, day),
      }),
    });
  }

  for (const [day, type] of Object.entries(profile.calendarOverrides)) {
    rows.push({
      id: `calendar:${day}`,
      day: day as IsoDate,
      mark: (
        <ToolMark>
          <CalendarCog aria-hidden />
        </ToolMark>
      ),
      what: `Вид дня: ${DAY_TYPE_LABELS[type as DayType].toLowerCase()}`,
      when: formatDateRu(day as IsoDate),
      grid: "calendar",
      remove: (previous) => ({
        ...previous,
        calendarOverrides: without(previous.calendarOverrides, day),
      }),
    });
  }

  for (const [day, note] of Object.entries(profile.dayNotes)) {
    rows.push({
      id: `note:${day}`,
      day: day as IsoDate,
      mark: (
        <ToolMark>
          <StickyNote aria-hidden />
        </ToolMark>
      ),
      what: note,
      when: formatDateRu(day as IsoDate),
      grid: "shifts",
      remove: (previous) => ({
        ...previous,
        dayNotes: without(previous.dayNotes, day),
      }),
    });
  }

  return rows.sort((a, b) => (a.day === b.day ? 0 : a.day < b.day ? -1 : 1));
}

export function ChangesList({
  profile,
  onChange,
  onOpenDay,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  /**
   * Открыть сутки на сетке.
   *
   * «Перенастроить» здесь не делается на месте, и это решение, а не
   * недоделка. Правка отпуска — это выбор периода, правка часов — два
   * времени, правка вида дня — четыре кнопки: собрать всё это второй раз
   * в перечне значило бы завести второе окно дня, которое обязано
   * повторять первое и разойдётся с ним при первой же правке.
   *
   * Поэтому перечень отвечает на «что у меня внесено» и «убрать это», а
   * «поменять» отдаёт туда, где это уже умеют, — в те самые сутки.
   */
  onOpenDay: (day: IsoDate, grid: "shifts" | "calendar") => void;
}) {
  const rows = changesOf(profile);

  if (rows.length === 0) {
    return (
      <p className="rounded-xl bg-paper-sunken px-4 py-6 text-center text-sm text-ink-muted">
        В графике пока ничего не отмечено. Отпуска, больничные, вызовы и
        переносы смен появятся здесь, как только вы их внесёте.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* Число в заголовке — не украшение: оно отвечает на вопрос «много ли
          я наотмечал» раньше, чем человек начнёт считать строки. */}
      <p className="text-sm text-ink-muted">
        Внесено {rows.length} {plural(rows.length, "правка", "правки", "правок")}.
        Нажмите на строку, чтобы открыть эти сутки и поправить.
      </p>

      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="lit flex items-center gap-2 rounded-xl bg-paper-raised py-1.5 pr-1.5 pl-2.5">
              {row.mark}

              {/* Кнопкой — вся строка целиком, а не отдельный значок
                  правки: попасть пальцем в строку легко, в значок нет.
                  Карандаш стоит внутри неё и правее текста — он подпись к
                  нажатию, а не вторая кнопка. */}
              <button
                type="button"
                onClick={() => onOpenDay(row.day, row.grid)}
                className={cn(
                  "flex min-w-0 grow cursor-pointer items-center gap-2 rounded-lg py-1 text-left",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
                )}
              >
                <span className="min-w-0 grow">
                  <span className="block truncate text-sm font-medium">{row.what}</span>
                  <span className="block truncate text-xs text-ink-muted">{row.when}</span>
                </span>
                <Pencil aria-hidden className="size-4 shrink-0 text-ink-faint" />
              </button>

              {/* Своя кнопка, а не общая `Button`: та растянута во всю
                  ширину строки по замыслу — она стоит в окнах, где кнопка
                  и есть строка. Здесь кнопок в строке две, и общая съела
                  бы всё место у текста (замерено: 466 точек из 672). */}
              <button
                type="button"
                aria-label={`Убрать: ${row.what}, ${row.when}`}
                onClick={() => onChange(row.remove)}
                className={cn(
                  "grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-faint",
                  "hover:bg-paper-sunken hover:text-signal",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",
                )}
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Русское число при существительном: одна правка, две правки, пять правок. */
function plural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return many;
  const ones = n % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}
