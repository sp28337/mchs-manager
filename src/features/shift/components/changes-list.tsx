"use client";

import {
  CalendarCog,
  CalendarRange,
  Clock,
  Flag,
  Pencil,
  RotateCcw,
  StickyNote,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { formatDayMonthRu } from "../domain/format";
import { todayIso, type IsoDate } from "../domain/plain-date";
import type { DayType } from "../domain/production-calendar";
import {
  ABSENCE_LABELS,
  CALLOUT_LABELS,
  DAY_TYPE_LABELS,
} from "../schemas";
import { withAbsenceEnd, withCalloutEnd, withNoteAt } from "../model/derive";
import type { StoredProfile } from "../storage/profile";
import {
  dayRu,
  eventsRu,
  GROUP_LABELS,
  groupsOf,
  periodRu,
  spanDays,
  timeline,
  type ChangeGroup,
  type Phase,
} from "./changes-timeline";
import { NoteModal, SpanModal } from "./day-event-modal";
import { DangerActions } from "./settings-panel";
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
 * Всё, что человек внёс в график, — лентой по времени.
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
 * Для вопроса «покажи только вызовы» над лентой есть фильтр, но он только
 * сужает ту же ленту, а не заводит другую: порядок, месяцы и линия
 * «сегодня» остаются.
 *
 * --- Почему лента с рельсой -----------------------------------------------
 *
 * Плоский перечень одинаковых плашек отвечал на «что внесено» и молчал о
 * главном для этой страницы: КОГДА. Год повторялся в каждой дате, прошедшее
 * ничем не отличалось от предстоящего, а где в списке сегодняшний день,
 * приходилось высчитывать глазами.
 *
 * Теперь значки стоят на общей рельсе — тонкой линии вдоль левого края, — и
 * это не украшение, а то, что лента говорит правду: порядок сверху вниз —
 * порядок во времени. Над строками стоят заголовки месяцев, а между
 * прошлым и будущим — зелёная линия «сегодня». Прошедшее тише, идущее
 * помечено словом «идёт»: взгляд сразу находит то, что происходит сейчас.
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
  /** Последние сутки; у одних суток тот же, что `day`. */
  endDay: IsoDate;
  /** Под какую кнопку фильтра над лентой она подпадает. */
  group: ChangeGroup;
  /** Значок — тот же, что в клетке. */
  mark: ReactNode;
  what: string;
  /** Подпись под названием: даты, длительность, подробности. */
  when: string;
  /**
   * Что открывает нажатие по строке. Нет его — строка не нажимается.
   *
   * --- Почему правка здесь, а не на сетке ---------------------------------
   *
   * Было так: нажатие уводило на график, к тем суткам, и правку человек
   * делал там. Дорога выходила длинная и с потерями — перечень
   * закрывался, страница уезжала к нужному месяцу, вокруг клетки
   * раскрывалось кольцо, — а спрашивали в конце пути ровно то же, что
   * спрашивали, когда событие ставили: по какое число и сколько часов.
   *
   * Теперь это окно открывается прямо отсюда. Оно то же самое
   * (`day-event-modal.tsx`), не «второе такое же»: разойтись им негде,
   * деталь одна на оба места.
   *
   * --- Почему не у всех строк ----------------------------------------------
   *
   * У переноса смены, вида дня и своих часов правки нет: у первых двух
   * менять нечего (они и есть одно нажатие), последние остались от
   * прежнего окна суток. Таким строкам карандаш не рисуется вовсе —
   * обещать правку, которой нет, хуже, чем её не предлагать. Убрать их
   * по-прежнему можно крестиком.
   */
  edit?: Edit;
  remove: (previous: StoredProfile) => StoredProfile;
  /**
   * Вернуть убранное: обратное к `remove`.
   *
   * Каждый вид знает, как лежал в профиле, и кладёт себя назад тем же
   * способом. Если запись с таким номером уже на месте, ничего не
   * происходит: возврат не должен удваивать то, что вернули другим путём.
   */
  restore: (previous: StoredProfile) => StoredProfile;
};

/** Строка на ленте: настоящая либо убранная, оставленная ради «Вернуть». */
type Shown = Change & { ghost?: boolean };

/** Чем правится строка перечня. */
type Edit =
  | {
      modal: "span";
      /** Заголовок окна — название события. */
      title: string;
      startsOn: IsoDate;
      endsOn: IsoDate;
      /** Часы в сутки или `null` у того, у чего их нет. */
      hours: string | null;
      apply: (
        endsOn: IsoDate,
        hours: string | null,
      ) => (previous: StoredProfile) => StoredProfile;
    }
  | { modal: "note"; day: IsoDate; text: string }
  /** Начало отсчёта живёт в анкете: туда и ведёт. */
  | { modal: "profile" };

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

/** «21 дн.» у отрезка длиннее суток; у одних суток длительность — пустая. */
function lasting(start: IsoDate, end: IsoDate): string {
  const days = spanDays(start, end);
  return days > 1 ? ` · ${days} дн.` : "";
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
    const start = absence.startsOn as IsoDate;
    const end = absence.endsOn as IsoDate;
    rows.push({
      id: `absence:${absence.id}`,
      day: start,
      endDay: end,
      group: "absence",
      mark: (
        <Mark tone={ABSENCE_TONE[absence.kind]}>{ABSENCE_MARK[absence.kind]}</Mark>
      ),
      what: ABSENCE_LABELS[absence.kind],
      when: `${periodRu(start, end)}${lasting(start, end)}`,
      edit: {
        modal: "span",
        title: ABSENCE_LABELS[absence.kind],
        startsOn: start,
        endsOn: end,
        hours: null,
        apply: (endsOn) => (previous) => withAbsenceEnd(previous, absence.id, endsOn),
      },
      remove: (previous) => ({
        ...previous,
        absences: previous.absences.filter((x) => x.id !== absence.id),
      }),
      restore: (previous) =>
        previous.absences.some((x) => x.id === absence.id)
          ? previous
          : { ...previous, absences: [...previous.absences, absence] },
    });
  }

  for (const callout of profile.callouts) {
    const start = callout.startsOn as IsoDate;
    const end = callout.endsOn as IsoDate;
    rows.push({
      id: `callout:${callout.id}`,
      day: start,
      endDay: end,
      group: "callout",
      mark: <Mark tone={CALLOUT_TONE}>{CALLOUT_MARK}</Mark>,
      what: CALLOUT_LABELS[callout.kind],
      when: `${periodRu(start, end)}${lasting(start, end)} · ${callout.hoursPerDay} ч в сутки`,
      edit: {
        modal: "span",
        title: CALLOUT_LABELS[callout.kind],
        startsOn: start,
        endsOn: end,
        hours: callout.hoursPerDay,
        apply: (endsOn, hours) => (previous) =>
          withCalloutEnd(previous, callout.id, endsOn, hours ?? callout.hoursPerDay),
      },
      remove: (previous) => ({
        ...previous,
        callouts: previous.callouts.filter((x) => x.id !== callout.id),
      }),
      restore: (previous) =>
        previous.callouts.some((x) => x.id === callout.id)
          ? previous
          : { ...previous, callouts: [...previous.callouts, callout] },
    });
  }

  for (const [key, kind] of Object.entries(profile.shiftOverrides)) {
    const day = key as IsoDate;
    rows.push({
      id: `shift:${day}`,
      day,
      endDay: day,
      group: "edit",
      mark:
        kind === "shift" ? (
          <Mark tone={SHIFT_TONE}>С</Mark>
        ) : (
          <Mark tone={DAY_OFF_TONE}>{DAY_OFF_MARK}</Mark>
        ),
      what: kind === "shift" ? "Смена вне графика" : "Смена отменена",
      when: dayRu(day),
      remove: (previous) => ({
        ...previous,
        shiftOverrides: without(previous.shiftOverrides, day),
      }),
      restore: (previous) =>
        day in previous.shiftOverrides
          ? previous
          : { ...previous, shiftOverrides: { ...previous.shiftOverrides, [day]: kind } },
    });
  }

  for (const [key, span] of Object.entries(profile.shiftTimes)) {
    const day = key as IsoDate;
    rows.push({
      id: `time:${day}`,
      day,
      endDay: day,
      group: "edit",
      mark: (
        <ToolMark>
          <Clock aria-hidden />
        </ToolMark>
      ),
      what: "Свои часы смены",
      when: `${dayRu(day)} · с ${span.startsAt} до ${span.endsAt}`,
      remove: (previous) => ({
        ...previous,
        shiftTimes: without(previous.shiftTimes, day),
      }),
      restore: (previous) =>
        day in previous.shiftTimes
          ? previous
          : { ...previous, shiftTimes: { ...previous.shiftTimes, [day]: span } },
    });
  }

  for (const [key, type] of Object.entries(profile.calendarOverrides)) {
    const day = key as IsoDate;
    rows.push({
      id: `calendar:${day}`,
      day,
      endDay: day,
      group: "edit",
      mark: (
        <ToolMark>
          <CalendarCog aria-hidden />
        </ToolMark>
      ),
      what: `Вид дня: ${DAY_TYPE_LABELS[type as DayType].toLowerCase()}`,
      when: dayRu(day),
      remove: (previous) => ({
        ...previous,
        calendarOverrides: without(previous.calendarOverrides, day),
      }),
      restore: (previous) =>
        day in previous.calendarOverrides
          ? previous
          : { ...previous, calendarOverrides: { ...previous.calendarOverrides, [day]: type } },
    });
  }

  /**
   * Начало отсчёта — такая же внесённая правка, как остальные.
   *
   * Оно обрезает период слева: до этой даты график не человека, и норма за
   * те дни тоже не его. Стояло оно только полем в анкете, и человек,
   * увидевший, что январь и февраль пропали с сетки, шёл искать причину по
   * всем настройкам — при том, что перечень внесённого заведён ровно для
   * ответа на вопрос «что я наотмечал».
   *
   * Пустое значение сюда не попадает: «с начала периода» — это не правка, а
   * умолчание, и строки в перечне у него быть не должно.
   */
  if (profile.countFrom !== null) {
    const from = profile.countFrom as IsoDate;
    rows.push({
      id: "count-from",
      day: from,
      endDay: from,
      group: "edit",
      mark: (
        <ToolMark>
          <Flag aria-hidden />
        </ToolMark>
      ),
      what: "Начало отсчёта",
      // «С такого-то», а не голая дата: остальные строки называют сутки или
      // отрезок, а это — граница, от которой идёт счёт.
      when: `с ${formatDayMonthRu(from)}`,
      edit: { modal: "profile" },
      remove: (previous) => ({ ...previous, countFrom: null }),
      restore: (previous) =>
        previous.countFrom === null ? { ...previous, countFrom: from } : previous,
    });
  }

  for (const [key, note] of Object.entries(profile.dayNotes)) {
    const day = key as IsoDate;
    rows.push({
      id: `note:${day}`,
      day,
      endDay: day,
      group: "note",
      mark: (
        <ToolMark>
          <StickyNote aria-hidden />
        </ToolMark>
      ),
      what: note,
      when: `Заметка · ${dayRu(day)}`,
      edit: { modal: "note", day, text: note },
      remove: (previous) => ({
        ...previous,
        dayNotes: without(previous.dayNotes, day),
      }),
      restore: (previous) =>
        day in previous.dayNotes
          ? previous
          : { ...previous, dayNotes: { ...previous.dayNotes, [day]: note } },
    });
  }

  return byDay(rows);
}

/** По дате начала; внутри одной даты порядок вставки сохраняется (сортировка устойчива). */
function byDay<T extends { day: IsoDate }>(rows: T[]): T[] {
  return rows.sort((a, b) => (a.day === b.day ? 0 : a.day < b.day ? -1 : 1));
}

/** Сколько секунд убранная строка ждёт на месте, пока её можно вернуть. */
const GONE_MS = 8000;

/** Дорожка ленты: рельса со значком слева и содержимое справа. */
const TRACK = "grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3";

/**
 * Значок на рельсе: с подложкой цвета бумаги.
 *
 * Клетки полупрозрачны (`bg-*-soft`), а рельса идёт позади них сплошной
 * линией — без подложки она просвечивала бы сквозь значок.
 */
function OnRail({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return (
    <span className={cn("relative z-[1] grid rounded-md bg-paper", quiet && "opacity-60")}>
      {children}
    </span>
  );
}

export function ChangesList({
  profile,
  onChange,
  onOpenProfile,
  onOpenCalendar,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  /**
   * Открыть настройки — анкету профиля.
   *
   * Нужно одной строке — началу отсчёта: оно задаётся там, а не в сутках.
   * Всё остальное правится здесь же, своим окном, и со страницы никуда не
   * уводит.
   */
  onOpenProfile: () => void;
  /**
   * Вернуться к календарю.
   *
   * Нужно пустому разделу: события ставят на сетке, и «пока ничего нет»
   * без дороги туда — тупик. Сама кнопка стоит только в пустом состоянии.
   */
  onOpenCalendar: () => void;
}) {
  const live = changesOf(profile);
  /**
   * Строка, которую сейчас правят.
   *
   * Строка, а не её номер: окно показывает то, что в ней было на миг
   * нажатия, и пересчитывать её из профиля заново незачем — правка эта
   * короткая и кончается закрытием окна.
   */
  const [editing, setEditing] = useState<Change | null>(null);
  const span = editing?.edit?.modal === "span" ? editing.edit : null;
  const noting = editing?.edit?.modal === "note" ? editing.edit : null;

  /**
   * Убранное, ещё доступное к возврату.
   *
   * Крестик стирает сразу — числа наверху пересчитываются в тот же миг, — а
   * промах пальцем рядом с карандашом на телефоне — вещь обычная. Поэтому
   * строка не исчезает, а остаётся на месте полоской «Убрано · Вернуть» на
   * несколько секунд: возврат под рукой там, где только что была строка, а
   * не в отдельном всплывающем окне, которое надо найти глазами.
   */
  const [gone, setGone] = useState<{ row: Change; focus: boolean }[]>([]);
  /** Строка, которой вернули место, — на неё переносится фокус. */
  const [refocus, setRefocus] = useState<string | null>(null);
  const [filter, setFilter] = useState<ChangeGroup | "all">("all");

  const expire = useCallback(
    (id: string) => setGone((list) => list.filter((it) => it.row.id !== id)),
    [],
  );
  // Свой стабильный колбэк, а не стрелка на месте: эффект строки зависит от
  // него, и с новой стрелкой на каждую отрисовку он запускался бы заново.
  const clearRefocus = useCallback(() => setRefocus(null), []);

  // Пустой перечень — и сбрасывать нечего: кнопка сброса не показывается
  // вовсе, чтобы не предлагать убрать то, чего нет. Но убранное только что
  // ещё на месте: пустым раздел становится, когда исчезла и полоска.
  if (live.length === 0 && gone.length === 0) {
    return <Empty onOpenCalendar={onOpenCalendar} />;
  }

  const liveIds = new Set(live.map((row) => row.id));
  const shown: Shown[] = byDay([
    ...live,
    ...gone
      .filter((it) => !liveIds.has(it.row.id))
      .map((it) => ({ ...it.row, ghost: true })),
  ]);

  const groups = groupsOf(shown);
  // Выбранная группа могла опустеть, пока перечень открыт (последнюю заметку
  // убрали): тогда показывается всё, а не пустая лента под нажатой кнопкой.
  const active = groups.some((it) => it.group === filter) ? filter : "all";
  const visible = active === "all" ? shown : shown.filter((row) => row.group === active);

  const today = todayIso();
  const entries = timeline(visible, today);

  return (
    <div className="space-y-5">
      {/* Фильтр — только когда выбирать есть из чего: при одной группе кнопка
          «Все» и кнопка этой группы показывали бы одно и то же. */}
      {groups.length > 1 ? (
        <div role="group" aria-label="Показать события" className="flex flex-wrap gap-1.5">
          <FilterChip active={active === "all"} onClick={() => setFilter("all")} count={live.length}>
            Все
          </FilterChip>
          {groups.map(({ group, count }) => (
            <FilterChip
              key={group}
              active={active === group}
              onClick={() => setFilter(group)}
              count={count}
            >
              {GROUP_LABELS[group]}
            </FilterChip>
          ))}
        </div>
      ) : null}

      {/* Рельса — линия позади значков, от первого до последнего. Она тоньше
          всего, что на ней стоит, и тише любой рамки: ей положено вести глаз
          сверху вниз, а не спорить со строками. Центр линии — на середине
          значка (14 точек от края при значке в 28). */}
      <ul className="relative space-y-2 before:absolute before:inset-y-3 before:left-[13px] before:w-0.5 before:rounded-full before:bg-rule">
        {entries.map((entry) => {
          if (entry.type === "month") {
            return (
              <li key={`month:${entry.key}`} className={cn(TRACK, "pt-4 first:pt-0")}>
                <span
                  aria-hidden
                  className="relative z-[1] mx-auto size-2.5 rounded-full border-2 border-ink-faint bg-paper"
                />
                <h3 className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-sm font-bold tracking-wide uppercase">
                    {entry.title}
                  </span>
                  {entry.count > 0 ? (
                    <span className="text-[11px] tracking-wide text-ink-faint uppercase tabular-nums">
                      {eventsRu(entry.count)}
                    </span>
                  ) : null}
                </h3>
              </li>
            );
          }

          if (entry.type === "today") {
            return (
              <li key="today" aria-label={`Сегодня, ${dayRu(today)}`} className={cn(TRACK, "py-1")}>
                <span
                  aria-hidden
                  className="relative z-[1] mx-auto size-3 rounded-full bg-verify ring-4 ring-paper"
                />
                <span
                  aria-hidden
                  className="flex items-center gap-3 font-display text-xs font-bold tracking-wide text-verify uppercase"
                >
                  <span className="shrink-0">Сегодня · {dayRu(today)}</span>
                  <span className="h-px grow bg-verify/30" />
                </span>
              </li>
            );
          }

          const { row, phase } = entry;
          return row.ghost === true ? (
            <Gone
              key={row.id}
              row={row}
              focus={gone.find((it) => it.row.id === row.id)?.focus ?? false}
              onExpire={expire}
              onRestore={() => {
                onChange(row.restore);
                expire(row.id);
                setRefocus(row.id);
              }}
            />
          ) : (
            <Row
              key={row.id}
              row={row}
              phase={phase}
              today={today}
              focus={refocus === row.id}
              onFocused={clearRefocus}
              onEdit={() => (row.edit?.modal === "profile" ? onOpenProfile() : setEditing(row))}
              onRemove={(fromKeyboard) => {
                onChange(row.remove);
                setGone((list) => [
                  ...list.filter((it) => it.row.id !== row.id),
                  { row, focus: fromKeyboard },
                ]);
              }}
            />
          );
        })}
      </ul>

      {/* Сброс стирает ровно то, что перечислено выше, и место ему под
          перечнем — там, где видно, что именно исчезнет. Раньше он стоял в
          анкете, среди вопросов о человеке, то есть там, где стирать
          нечего.

          Удаления профиля здесь нет: оно стирает не отметки, а саму
          анкету, и живёт в настройках — рядом с тем, что стирает. */}
      {/* Те же два окна, что открываются, когда событие ставят: срок у
          длящегося и строка у заметки. Не «такие же» — те же самые
          (`day-event-modal.tsx`). */}
      <SpanModal
        key={span === null ? "none" : editing?.id}
        open={span !== null}
        title={span?.title ?? ""}
        startsOn={span?.startsOn ?? ("2000-01-01" as IsoDate)}
        endsOn={span?.endsOn ?? ("2000-01-01" as IsoDate)}
        hours={span?.hours ?? null}
        onCommit={(endsOn, hours) => {
          if (span !== null) onChange(span.apply(endsOn, hours));
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />

      <NoteModal
        key={noting === null ? "none-note" : `note:${editing?.id}`}
        open={noting !== null}
        day={noting?.day ?? ("2000-01-01" as IsoDate)}
        text={noting?.text ?? ""}
        onCommit={(text) => {
          if (noting !== null) {
            onChange((previous) => withNoteAt(previous, noting.day, text));
          }
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />

      <DangerActions onChange={onChange} />
    </div>
  );
}

/** Кнопка фильтра: слово и сколько за ним. Нажатая — плашкой с лампой. */
function FilterChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3",
        "font-display text-xs font-bold tracking-wide uppercase transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        active
          ? "lit bg-paper-raised text-ink"
          : "bg-paper-sunken text-ink-muted hover:text-ink",
      )}
    >
      {children}
      <span className={cn("tabular-nums", active ? "text-ink-muted" : "text-ink-faint")}>
        {count}
      </span>
    </button>
  );
}

/** Строка ленты: значок на рельсе и плашка с названием, датами и кнопками. */
function Row({
  row,
  phase,
  today,
  focus,
  onFocused,
  onEdit,
  onRemove,
}: {
  row: Change;
  phase: Phase;
  today: IsoDate;
  /** Поставить фокус на главную кнопку строки: сюда вернули убранное. */
  focus: boolean;
  onFocused: () => void;
  onEdit: () => void;
  /** `true`, если нажато с клавиатуры: тогда фокус переходит на «Вернуть». */
  onRemove: (fromKeyboard: boolean) => void;
}) {
  const main = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focus) return;
    main.current?.focus();
    onFocused();
  }, [focus, onFocused]);

  const note = row.group === "note";
  const past = phase === "past";

  const text = (
    <span className="min-w-0 grow">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "min-w-0 text-sm font-medium",
            // Заметка — это фраза, а не название: две строки вместо
            // обрубка на втором слове.
            note ? "line-clamp-2 break-words" : "truncate",
            past && "text-ink-muted",
          )}
        >
          {row.what}
        </span>
        {phase === "now" ? <Live today={row.day === today && row.endDay === today} /> : null}
      </span>
      <span className="block truncate text-xs text-ink-muted tabular-nums">{row.when}</span>
    </span>
  );

  return (
    <li className={TRACK}>
      <OnRail quiet={past}>{row.mark}</OnRail>

      <div className="lit flex items-center gap-2 rounded-xl bg-paper-raised py-1.5 pr-1.5 pl-3">
        {/* Кнопкой — вся строка целиком, а не отдельный значок правки:
            попасть пальцем в строку легко, в значок нет. Карандаш стоит
            внутри неё и правее текста — он подпись к нажатию, а не вторая
            кнопка.

            Строке, которую нечем править, кнопка не полагается: она просто
            текст, и нажимать в ней не на что. */}
        {row.edit === undefined ? (
          <div className="min-w-0 grow py-1">{text}</div>
        ) : (
          <button
            ref={main}
            type="button"
            aria-label={`Изменить: ${row.what}, ${row.when}`}
            onClick={onEdit}
            className={cn(
              "group/edit flex min-w-0 grow cursor-pointer items-center gap-2 rounded-lg py-1 text-left",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
            )}
          >
            {text}
            <Pencil
              aria-hidden
              className="size-4 shrink-0 text-ink-faint transition-colors group-hover/edit:text-ink"
            />
          </button>
        )}

        {/* Своя кнопка, а не общая `Button`: та растянута во всю ширину
            строки по замыслу — она стоит в окнах, где кнопка и есть строка.
            Здесь кнопок в строке две, и общая съела бы всё место у текста
            (замерено: 466 точек из 672). */}
        <button
          type="button"
          aria-label={`Убрать: ${row.what}, ${row.when}`}
          onClick={(event) => onRemove(event.detail === 0)}
          className={cn(
            "grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-faint transition-colors",
            "hover:text-ink",
            "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
          )}
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </li>
  );
}

/** Метка идущего события: точка и слово, тем же зелёным, что линия «сегодня». */
function Live({ today }: { today: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-display text-[11px] font-bold tracking-wide text-verify uppercase">
      <span aria-hidden className="size-1.5 rounded-full bg-verify" />
      {today ? "Сегодня" : "Идёт"}
    </span>
  );
}

/**
 * Убранная строка: остаётся на месте, пока её можно вернуть.
 *
 * Таймер стоит, пока на полоске курсор или фокус: пропавшая из-под руки
 * кнопка «Вернуть» — как раз то, что человек успел нажать наполовину.
 */
function Gone({
  row,
  focus,
  onExpire,
  onRestore,
}: {
  row: Change;
  focus: boolean;
  onExpire: (id: string) => void;
  onRestore: () => void;
}) {
  const [held, setHeld] = useState(false);
  const restore = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focus) restore.current?.focus();
  }, [focus]);

  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => onExpire(row.id), GONE_MS);
    return () => window.clearTimeout(timer);
  }, [held, onExpire, row.id]);

  return (
    <li className={TRACK}>
      <OnRail quiet>{row.mark}</OnRail>
      <div
        role="status"
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
        className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-rule py-1 pr-1.5 pl-3 text-sm text-ink-muted"
      >
        <span className="min-w-0 grow truncate">Убрано: {row.what}</span>
        <button
          ref={restore}
          type="button"
          onClick={onRestore}
          className={cn(
            "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5",
            "font-display text-xs font-bold tracking-wide text-ink uppercase transition-colors hover:text-verify",
            "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
          )}
        >
          <RotateCcw aria-hidden className="size-3.5" />
          Вернуть
        </button>
      </div>
    </li>
  );
}

/**
 * Пустой раздел: что здесь будет и как до этого дойти.
 *
 * Пустой экран — приглашение, а не итог. События ставят на календаре, и
 * человеку, открывшему раздел первым, нужно не «ничего нет», а дорога туда,
 * где они появляются.
 */
function Empty({ onOpenCalendar }: { onOpenCalendar: () => void }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-5 rounded-2xl bg-paper-sunken px-6 py-10 text-center">
      <span
        aria-hidden
        className="grid size-12 place-items-center rounded-xl border border-rule bg-paper-raised text-ink-muted [&_svg]:size-6"
      >
        <CalendarRange />
      </span>
      <div className="space-y-1.5">
        <p className="font-display text-base font-bold tracking-wide uppercase">
          Событий пока нет
        </p>
        <p className="text-sm text-pretty text-ink-muted">
          Отпуска, больничные, вызовы и переносы смен появятся здесь, как только вы отметите их
          в календаре: нажмите на нужный день.
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenCalendar}
        className={cn(
          "lit inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-paper-raised px-4",
          "font-display text-sm font-bold tracking-wide uppercase",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        )}
      >
        К календарю
      </button>
    </div>
  );
}
