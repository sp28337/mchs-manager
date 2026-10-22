/**
 * Перечень внесённого, разложенный по времени: месяцы, «сегодня», фазы.
 *
 * --- Зачем отдельным файлом ------------------------------------------------
 *
 * В `changes-list.tsx` всё, что рисует, и всё, что решает, жило вперемешку, а
 * решений здесь набралось достаточно, чтобы их проверять отдельно: как
 * называется отрезок дат, в какой месяц попадает строка, где встаёт линия
 * «сегодня». Ни одно из них не требует разметки, и тест на них не должен
 * поднимать React.
 *
 * --- Что показывается вместо «01.07.2026 — 14.07.2026» ---------------------
 *
 * Год и ноль перед числом были в каждой строке и не говорили ничего нового:
 * строки стоят под заголовком месяца, а в нём год уже есть. Остаётся то,
 * что человек ищет глазами, — число и месяц: «6–26 июля», «28 июня — 3 июля».
 * Год возвращается в одном случае: отрезок перешагнул через Новый год, и
 * без года «28 декабря — 3 января» читалось бы как почти целый год.
 *
 * У одних суток вместо дня недели в заголовке строки стоит он же в её
 * подписи: «10 февраля, вт». Человек, спорящий с табелем, называет не
 * только число, но и «это был вторник».
 *
 * --- Что значит «сегодня» ---------------------------------------------------
 *
 * Линия «сегодня» делит перечень по ДАТЕ НАЧАЛА: выше всё, что началось
 * раньше, ниже — то, что начинается сегодня или позже. Отпуск, начатый на
 * прошлой неделе и идущий сейчас, остаётся выше линии и помечен «идёт»:
 * порядок в перечне хронологический по началу, и линия не должна ему
 * противоречить — иначе строка, вставшая ниже линии, оказалась бы раньше
 * строк, которые выше.
 *
 * Линия есть, только если у неё есть что разделять: когда всё позади или всё
 * впереди, она стояла бы в самом начале или в самом конце списка и ничего не
 * говорила.
 */

import { formatDayMonthRu } from "../domain/format";
import { daysBetween, dayOfMonth, weekday, year, type IsoDate } from "../domain/plain-date";
import { WEEKDAY_LABELS } from "./month-grid";
import { MONTH_NAMES } from "./month-names";

/** Чем событие стоит относительно сегодняшнего дня. */
export type Phase = "past" | "now" | "ahead";

/**
 * Прошло, идёт или впереди — по обоим краям отрезка.
 *
 * Отрезок, который кончился вчера, — прошлое; который начнётся завтра —
 * будущее; всё, что накрывает сегодняшние сутки, — «идёт». Одни сутки
 * сегодня — тоже «идёт», как и многодневное.
 */
export function phaseOf(start: IsoDate, end: IsoDate, today: IsoDate): Phase {
  if (end < today) return "past";
  if (start > today) return "ahead";
  return "now";
}

/** Сколько суток накрывает отрезок, считая оба края. Одни сутки — один. */
export function spanDays(start: IsoDate, end: IsoDate): number {
  return Math.max(1, daysBetween(start, end) + 1);
}

/**
 * Отрезок с длительностью: «6–26 июля · 21 дн.». У одних суток длительности
 * нет — её говорит сама дата: «10 февраля, вт».
 *
 * Один на перечень «События» и на окно срока: человек правит ту же строку,
 * что читал, и слова в них должны совпадать.
 */
export function spanRu(start: IsoDate, end: IsoDate): string {
  const days = spanDays(start, end);
  return days > 1 ? `${periodRu(start, end)} · ${days} дн.` : periodRu(start, end);
}

/** `2026-02-10` → «10 февраля, вт». */
export function dayRu(day: IsoDate): string {
  return `${formatDayMonthRu(day)}, ${WEEKDAY_LABELS[weekday(day)] ?? ""}`;
}

/**
 * Отрезок дат словами: «6–26 июля», «28 июня — 3 июля».
 *
 * Одни сутки называются одной датой с днём недели, а не дважды. Тире без
 * пробелов — между числами одного месяца, где оно значит «с … по»; с
 * пробелами — между датами, в которых слова, как и принято набирать.
 */
export function periodRu(start: IsoDate, end: IsoDate): string {
  if (start === end) return dayRu(start);
  if (year(start) !== year(end)) {
    return `${formatDayMonthRu(start)} ${year(start)} — ${formatDayMonthRu(end)} ${year(end)}`;
  }
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${dayOfMonth(start)}–${formatDayMonthRu(end)}`;
  }
  return `${formatDayMonthRu(start)} — ${formatDayMonthRu(end)}`;
}

/** «1 событие», «2 события», «5 событий» — со склонением, как говорят. */
export function eventsRu(count: number): string {
  const tail100 = count % 100;
  const tail10 = count % 10;
  const word =
    tail100 >= 11 && tail100 <= 14
      ? "событий"
      : tail10 === 1
        ? "событие"
        : tail10 >= 2 && tail10 <= 4
          ? "события"
          : "событий";
  return `${count} ${word}`;
}

/** Месяц, в котором строка стоит: `2026-07`. По началу отрезка. */
export function monthKey(day: IsoDate): string {
  return day.slice(0, 7);
}

/** `2026-07` → «Июль 2026». */
export function monthTitleRu(key: string): string {
  const name = MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? "";
  return `${name} ${key.slice(0, 4)}`;
}

/** Что нужно строке перечня, чтобы встать на ленту. */
export interface TimelineRow {
  id: string;
  /** Начало. По нему строка попадает в месяц и под линию «сегодня». */
  day: IsoDate;
  /** Конец; у одних суток тот же, что начало. */
  endDay: IsoDate;
  /** Убранная строка, оставленная на месте ради «Вернуть»: в счёт не идёт. */
  ghost?: boolean;
}

/** Элемент ленты: заголовок месяца, строка или линия «сегодня». */
export type TimelineEntry<T extends TimelineRow> =
  | { type: "month"; key: string; title: string; count: number }
  | { type: "row"; row: T; phase: Phase }
  | { type: "today" };

/**
 * Развернуть строки в ленту: заголовки месяцев, сами строки и линию «сегодня».
 *
 * Строки приходят уже упорядоченными по началу — порядок задаёт перечень, и
 * здесь он только читается. Линия встаёт перед первой строкой, что начинается
 * сегодня или позже, но лишь когда над ней есть хотя бы одна строка; если эта
 * строка открывает новый месяц, линия стоит ПЕРЕД его заголовком — она
 * разделяет месяцы, а не подпись и первую строку под ней.
 *
 * Число в заголовке месяца не считает убранных строк: они держатся на месте
 * несколько секунд, а счёт должен говорить, сколько событий там осталось.
 */
export function timeline<T extends TimelineRow>(
  rows: readonly T[],
  today: IsoDate,
): TimelineEntry<T>[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.ghost === true) continue;
    const key = monthKey(row.day);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const entries: TimelineEntry<T>[] = [];
  let month = "";
  let seenBefore = false;
  let placed = false;

  for (const row of rows) {
    if (!placed && row.day >= today && seenBefore) {
      entries.push({ type: "today" });
      placed = true;
    }

    const key = monthKey(row.day);
    if (key !== month) {
      month = key;
      entries.push({ type: "month", key, title: monthTitleRu(key), count: counts.get(key) ?? 0 });
    }

    entries.push({ type: "row", row, phase: phaseOf(row.day, row.endDay, today) });
    if (row.day < today) seenBefore = true;
  }

  return entries;
}

/**
 * Группа для фильтра над лентой.
 *
 * Четыре, а не по числу видов: человек, которому нужны «все больничные»,
 * помнит их по значку и найдёт по дате, а вот «только вызовы» или «только
 * заметки» — вопрос, ради которого перечень приходится листать. Деление
 * грубое намеренно: больше кнопок над перечнем, чем строк в нём, — не фильтр.
 */
export type ChangeGroup = "absence" | "callout" | "edit" | "note";

export const GROUP_LABELS: Record<ChangeGroup, string> = {
  absence: "Отсутствия",
  callout: "Вызовы",
  edit: "Правки графика",
  note: "Заметки",
};

const GROUP_ORDER: readonly ChangeGroup[] = ["absence", "callout", "edit", "note"];

/** Группы, в которых есть строки, и сколько — в порядке кнопок над лентой. */
export function groupsOf(
  rows: readonly { group: ChangeGroup; ghost?: boolean }[],
): { group: ChangeGroup; count: number }[] {
  const counts = new Map<ChangeGroup, number>();
  for (const row of rows) {
    if (row.ghost === true) continue;
    counts.set(row.group, (counts.get(row.group) ?? 0) + 1);
  }
  return GROUP_ORDER.flatMap((group) => {
    const count = counts.get(group) ?? 0;
    return count > 0 ? [{ group, count }] : [];
  });
}
