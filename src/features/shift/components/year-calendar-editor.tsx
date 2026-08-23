"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils/cn";

import { formatDateRu } from "../domain/format";
import {
  datesInRange,
  dayOfMonth,
  monthIndex,
  weekday,
  year as yearOf,
  type IsoDate,
} from "../domain/plain-date";
import {
  calendarWithOverrides,
  pendingTransfers,
  type CalendarDay,
} from "../domain/production-calendar";
import type { StoredProfile } from "../storage/profile";
import {
  DAY_TYPES,
  DAY_TYPE_LABELS,
  DAY_TYPE_MARK,
  DAY_TYPE_TONE,
  type DayType,
} from "../schemas";
import { MONTH_NAMES } from "./month-names";
import { MonthGrid, WEEKDAY_LABELS } from "./month-grid";

/**
 * Календарь учётного года: какие дни нерабочие.
 *
 * --- Зачем он человеку --------------------------------------------------
 *
 * Норма периода считается по числу рабочих дней (ст. 104 ТК РФ), и ошибка
 * в одном дне — это 8 часов нормы. Праздники по ст. 112 ТК РФ размечены
 * заранее, но переносы выходных Правительство устанавливает отдельным
 * постановлением на каждый год, и приложение их не знает. Зато их знает
 * человек: производственный календарь у него перед глазами.
 *
 * --- Почему той же формы, что и график ----------------------------------
 *
 * Здесь была таблица 12×31 с горизонтальным ползунком: месяцы строками,
 * числа столбцами. Она не совпадала ни с одним календарём, который человек
 * видел, — ни с настенным, ни с графиком смен на этой же странице, — и
 * сверять по ней «выходной ли 9 марта» приходилось счётом по строке.
 *
 * Теперь месяц выглядит ровно как в графике: строка — неделя, столбец —
 * день недели. Одно и то же число оказывается на одном и том же месте в
 * обоих блоках, и глазу не нужно перестраиваться. Ползунка нет вовсе:
 * сетка переносится по ширине окна.
 *
 * --- Почему видно, откуда взят день -------------------------------------
 *
 * Правка помечается точкой. Человек должен различать, что он утверждает
 * сам, а что взято из закона: при разборе с начальником это разные по весу
 * утверждения, и стирать между ними границу нельзя.
 *
 * --- Как правится день --------------------------------------------------
 *
 * Так же, как в графике смен: нажатие по числу открывает окно этих суток,
 * и вид дня выбирается там — вместе с заметкой и отметками об отпуске.
 *
 * Раньше здесь была кисть («чем помечать») и форма диапазона под сеткой.
 * Кисть — скрытое состояние: щёлкнув по дню, человек получал то, что
 * выбрал когда-то раньше, и не всегда помнил, что именно. Форма диапазона
 * требовала набирать две даты рядом с календарём, в котором эти даты уже
 * видны. Обе дороги вели туда же, куда ведёт нажатие по дню, — и остались
 * только третья.
 *
 * Правка сохраняется сразу, кнопки «Сохранить» здесь нет: запись идёт в
 * браузер, а не по сети, и отдельный шаг означал бы только возможность
 * потерять правку, закрыв вкладку.
 *
 * --- Почему он больше не сворачивается сам ------------------------------
 *
 * Здесь была своя кнопка «Открыть календарь»: блок стоял отдельным
 * разделом, и двенадцать сеток сразу отодвинули бы всё остальное вниз.
 * Теперь календарь показывается по переключателю в `YearView` — то есть
 * его уже выбрали и хотят видеть. Вторая крышка внутри означала бы, что
 * на нажатие «Производственный календарь» человек получает кнопку
 * «Открыть календарь».
 */

export interface YearCalendarEditorProps {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  /**
   * Показанный отрезок — тот же, что у графика смен. Правая граница
   * исключающая, как во всём домене.
   *
   * Календарь показывал год целиком независимо от выбранного периода:
   * человек смотрел квартал на графике, переключался на календарь и
   * получал двенадцать месяцев вместо трёх. Сверять при этом было нечего
   * — та клетка, из-за которой он переключился, оказывалась в другом
   * месте экрана.
   */
  periodStart: IsoDate;
  periodEnd: IsoDate;
  /** Первые сутки, которые ещё не наступили («Онлайн»), или `null`. */
  upcoming?: IsoDate | null;
  /** Раскладка месяцев: её задаёт масштаб, общий с графиком смен. */
  gridClassName?: string;
  /** Заметки к суткам: их наличие видно прямо в клетке, как в графике. */
  dayNotes: Readonly<Record<string, string>>;
  /** Нажатие по клетке: открыть правку этих суток. */
  onPickDay: (day: IsoDate) => void;
}

export function YearCalendarEditor({
  profile,
  onChange,
  periodStart,
  periodEnd,
  upcoming,
  gridClassName,
  dayNotes,
  onPickDay,
}: YearCalendarEditorProps) {
  const year = profile.accountingYear;
  const overrides = profile.calendarOverrides;

  /**
   * Размеченные сутки показанного отрезка.
   *
   * Календарь берётся по годам, а не по одному: отрезок в принципе может
   * пересечь границу года, и тогда одного года мало. Правки при этом
   * общие — они лежат в профиле датами.
   */
  const byDay = useMemo(() => {
    const map = new Map<IsoDate, CalendarDay>();
    const edits = new Map(Object.entries(overrides) as [IsoDate, DayType][]);
    const first = Number(periodStart.slice(0, 4));
    const last = Number(periodEnd.slice(0, 4));
    for (let each = first; each <= last; each += 1) {
      for (const item of calendarWithOverrides(each, edits)) map.set(item.day, item);
    }
    return map;
  }, [periodStart, periodEnd, overrides]);

  const overrideCount = Object.keys(overrides).length;
  const pending = pendingTransfers(year).filter((day) => overrides[day] === undefined);

  // Месяцы отрезка — по тем же правилам, что в графике смен: подряд
  // идущие сутки, разбитые по месяцам. Неполный месяц на краю периода
  // так и показывается неполным, со своим уступом.
  const groups: { year: number; month: number; days: CalendarDay[] }[] = [];
  for (const day of datesInRange(periodStart, periodEnd)) {
    const item = byDay.get(day);
    if (!item) continue;
    const itemYear = yearOf(day);
    const month = monthIndex(day);
    let group = groups.at(-1);
    if (!group || group.year !== itemYear || group.month !== month) {
      group = { year: itemYear, month, days: [] };
      groups.push(group);
    }
    group.days.push(item);
  }

  return (
    <section aria-labelledby="calendar" className="space-y-4 xl:flex xl:flex-row-reverse xl:gap-4">
      {/* Сетка идёт ПЕРВОЙ и ничего над собой не имеет — в этом весь
          смысл. Календарь показывается на месте графика по нажатию
          кнопки, и всё, что стояло бы выше сетки, сдвигало бы её вниз:
          человек, смотревший на мартовскую клетку, после переключения
          искал бы её заново. Пояснение ушло под знак вопроса у заголовка,
          инструменты правки — под сетку. */}
      <div
        className={
          gridClassName ??
          "grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {groups.map((group) => {
          const edited = group.days.filter((item) => item.source === "override").length;
          return (
            <MonthGrid
              key={`${group.year}-${group.month}`}
              title={MONTH_NAMES[group.month]}
              meta={edited > 0 ? <span className="text-ink">правок: {edited}</span> : null}
              days={group.days.map((item) => item.day)}
              joined
              assemble
              renderDay={(day, corners) => {
                const item = byDay.get(day);
                return item ? (
                  <DayButton
                    item={item}
                    corners={corners}
                    note={dayNotes[day]}
                    upcoming={upcoming != null && day >= upcoming}
                    onPick={() => onPickDay(day)}
                  />
                ) : null;
              }}
            />
          );
        })}
      </div>

      {pending.length > 0 ? <PendingNotice pending={pending} /> : null}

      {/* Легенда держится на месте вместе с числами: тот же приём, что в
          графике смен, — `sticky` под полосой итога и `self-start`, иначе
          растянутому элементу прилипать некуда. */}
      <div className="xl:max-w-70 xl:w-full xl:sticky xl:top-32 xl:self-start translate-y-1 
                      bg-paper-raised/70 p-4 rounded-xl lg:min-w-92.5">
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs xl:flex-col">
          {DAY_TYPES.map((type) => (
            <div key={type} className="flex items-center gap-2">
              <dt
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-sm border font-mono text-[10px]",
                  DAY_TYPE_TONE[type],
                )}
              >
                {DAY_TYPE_MARK[type]}
              </dt>
              <dd>
                <span className="font-medium">{DAY_TYPE_LABELS[type]}</span>
              </dd>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <dt className="relative flex size-6 shrink-0 items-center justify-center rounded-sm border border-rule">
              <span aria-hidden className="absolute -left-px -top-px size-1.5 rounded-full bg-ink" />
            </dt>
            <dd className="text-ink-muted">Изменено вами</dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-4 border-t border-rule pt-4 mt-4">
          <p className="text-sm text-ink-muted" aria-live="polite">
            Ваших правок: {overrideCount}
          </p>
          {overrideCount > 0 ? (
            <button
              type="button"
              className="text-xs text-ink-muted underline underline-offset-2 hover:text-signal"
              onClick={() =>
                onChange((previous) => ({ ...previous, calendarOverrides: {} }))
              }
            >
              Вернуть календарь по закону
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * Пояснение к календарю — то, что раньше стояло абзацем над сеткой.
 *
 * Живёт здесь, а не там, где показывается: текст говорит о том, что и
 * откуда в этой сетке размечено, и разойтись с самой сеткой ему нельзя.
 * Показывается он знаком вопроса у заголовка раздела — над сеткой места
 * нет, там она сама.
 */
export function CalendarNote({ profile }: { profile: StoredProfile }) {
  const year = profile.accountingYear;
  const pending = pendingTransfers(year).filter(
    (day) => profile.calendarOverrides[day] === undefined,
  );

  return (
    <>
      Праздники по ст. 112 ТК РФ и предпраздничные дни по ст. 95 размечены
      автоматически.{" "}
      {pending.length > 0 ? (
        <>
          Переносы выходных устанавливает Правительство отдельным постановлением
          на каждый год, и на {year} год приложение его ещё не знает.
        </>
      ) : (
        <>
          Перенос выходных дней на {year} год внесён по постановлению
          Правительства — календарь должен совпасть с выданным вам.
        </>
      )}{" "}
      Если ваш производственный календарь всё-таки отличается, поправьте здесь:
      ошибка в одном дне — это 8 часов нормы. Нажмите по числу — в окне этих
      суток выбирается вид дня.
    </>
  );
}

function DayButton({
  item,
  corners,
  note,
  upcoming,
  onPick,
}: {
  item: CalendarDay;
  /** Скругления углов: их знает сетка, а не клетка. */
  corners: string;
  note?: string;
  /** Сутки ещё не наступили: показаны, но в расчёт не входят. */
  upcoming?: boolean;
  onPick: () => void;
}) {
  const date = dayOfMonth(item.day);
  const month = (MONTH_NAMES[monthIndex(item.day)] ?? "").toLowerCase();
  const weekdayName = WEEKDAY_LABELS[weekday(item.day)] ?? "";

  const label =
    `${date} ${month}, ${weekdayName} — ${DAY_TYPE_LABELS[item.dayType].toLowerCase()}` +
    (item.source === "override" ? ", изменено вами" : "") +
    (note ? `. Заметка: ${note}` : "") +
    (upcoming ? ". Ещё не наступило, в расчёт не входит" : "");

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onPick}
      className={cn(
        "relative flex aspect-square w-full min-w-0 cursor-pointer flex-col bg-paper-raised",
        // Та же подложка от волосяной щели, что и в графике смен: сетка
        // одна и та же, и шов у неё тот же.
        "cell-seam",
        corners,
      )}
    >
      <div className={
        cn(
          "relative flex aspect-square w-full min-w-0 cursor-pointer flex-col",
          "items-center justify-center leading-tight",
          // Обводкой внутрь, а не рамкой: клетки стоят вплотную, и рамка
          // сдвинула бы соседей.
          "hover:outline-2 hover:-outline-offset-2 hover:outline-ink/40 rounded-md",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",

          // Рамки нет ни у одного дня: тип дня различается подложкой и
          // буквой. Триста шестьдесят пять контуров на год — это решётка,
          // за которой не видно ни праздников, ни правок.
          DAY_TYPE_TONE[item.dayType],
          "flex flex-col",
          // Гашение — последним: поверх любого вида дня. Та же штриховка,
          // что в графике смен, потому что означает то же самое.
          upcoming && "cell-upcoming",
        )}
      >
        {/* Кегль в `em`: клетка следует за масштабом сетки, и число вместе
            с ней. То же решение, что в клетке графика, — иначе при
            переключении между сетками менялся бы размер цифр. */}
        <span aria-hidden className="font-mono text-[1em]">
          {date}
        </span>
        <span aria-hidden className="font-mono text-[0.75em]">
          {DAY_TYPE_MARK[item.dayType]}
        </span>
        {item.source === "override" ? (
          // Точка, а не цвет: цвет уже занят типом дня, и второй смысл на том
          // же канале означал бы, что ни один не читается.
          <span
            aria-hidden
            className="absolute -left-px -top-px size-1.5 rounded-full bg-ink"
          />
        ) : null}
        {/* Заметка помечается тем же углом, что в графике: одна пометка на
            обе сетки, иначе её пришлось бы искать по-разному. */}
        {note ? (
          <span
            aria-hidden
            className="absolute right-0 top-0 size-0 border-l-4 border-t-4 border-l-transparent border-t-trace"
          />
        ) : null}
      </div>
    </button>
  );
}

/**
 * Названная цена непроставленного переноса.
 *
 * Молчать здесь нельзя: приложение считает эти дни рабочими, и норма выше
 * официальной ровно на восемь часов за каждый. Человек, не знающий об
 * этом, понесёт начальнику завышенную норму и окажется неправ в споре, где
 * он прав по существу.
 */
function PendingNotice({ pending }: { pending: readonly IsoDate[] }) {
  return (
    <p className="max-w-prose rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
      В новогодние каникулы попали выходные ({pending.map(formatDateRu).join(", ")}),
      которые постановление Правительства переносит на другие даты. Какие это
      даты, приложение не знает — из закона они не выводятся. Пока перенос не
      проставлен, норма завышена на{" "}
      <span className="font-mono">{pending.length * 8}</span> часов: найдите эти
      дни в своём производственном календаре и отметьте их здесь выходными.
    </p>
  );
}
