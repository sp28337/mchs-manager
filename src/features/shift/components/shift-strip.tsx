"use client";

import { useCallback, type ReactNode } from "react";

import { BoneText } from "@/components/ui/bone";
import { CountedNumber } from "@/components/ui/counted-number";
import { cn } from "@/lib/utils/cn";

import type { DayRecord, PeriodCalculation } from "../domain/calculation";
import {
  ZERO,
  formatHours as hours,
  formatHoursTrim as hoursTrim,
  type Decimal,
} from "../domain/decimal";
import {
  datesInRange,
  dayOfMonth,
  monthIndex,
  todayIso,
  weekday,
  year as yearOf,
  type IsoDate,
} from "../domain/plain-date";
import { formatDayMonthRu } from "../domain/format";
import { ABSENCE_LABELS, CALLOUT_LABELS } from "../schemas";
import {
  ABSENCE_MARK,
  ABSENCE_TONE,
  CALLOUT_MARK,
  CALLOUT_TONE,
  DAY_OFF_MARK,
  DAY_OFF_TONE,
  SHIFT_TAIL_TONE,
  SHIFT_TONE,
} from "./day-marks";
import type { AbsenceKind, CalloutKind } from "../domain/value-objects";

/**
 * Тот же вид, но вполголоса: сутки отпуска, свободные по графику.
 *
 * --- Зачем они вообще помечаются -----------------------------------------
 *
 * Отпуск с 1 по 5 показывался ОДНОЙ клеткой — той, где по графику стояла
 * смена. Человек видел «смена попала в отпуск» и не видел ни начала
 * отпуска, ни его конца, хотя спор идёт ровно о границах: с какого числа
 * отпустили и по какое.
 *
 * --- Почему тише, а не так же --------------------------------------------
 *
 * Потому что стоят они разного. Смена в отпуске — это не отработанные
 * сутки, из-за которых и меняются числа наверху; свободные сутки внутри
 * отпуска на расчёт не влияют никак, они показывают только его
 * протяжённость.
 *
 * Ослабление ровно то же, каким в графике различаются заступление и
 * продолжение смены: цвет тот же, плотность меньше. Другого способа
 * показать «то же, но слабее» в этом словаре нет, а заводить второй
 * значило бы объяснять человеку два правила вместо одного.
 */
const ABSENCE_TONE_QUIET: Record<AbsenceKind, string> = {
  annual_leave: "border-dashed border-signal/20 bg-signal-soft/40 text-signal/70 rounded-md",
  extra_leave: "border-dashed border-trip/20 bg-trip-soft/40 text-trip/70 rounded-md",
  sick_leave: "border-dashed border-sick/20 bg-sick-soft/40 text-sick/70 rounded-md",
  time_off_in_lieu: "border-dashed border-rest/20 bg-rest-soft/40 text-rest/70 rounded-md",
  study_leave: "border-dashed border-study/20 bg-study-soft/40 text-study/70 rounded-md",
};
import { MONTH_NAMES } from "./month-names";
import { MonthGrid, TODAY_MARK, WEEKDAY_LABELS } from "./month-grid";
import { useShiftDrag, type ShiftDrag } from "./use-shift-drag";

/**
 * График смен: месяц — блок, неделя — строка.
 *
 * --- Почему счёт идёт по СУТКАМ, а не по сменам --------------------------
 *
 * Смена длится сутки с развода, поэтому лежит в двух календарных днях. При
 * начале в 08:30 смена, начавшаяся 31 марта, отдаёт марту 15,5 часа, а
 * 8,5 — апрелю, и ночных в марте у неё два часа, а не шесть.
 *
 * Раньше блок брал часы смены целиком и приписывал их месяцу ЗАСТУПЛЕНИЯ.
 * На периоде в полгода это давало марту все 24 часа: месячная сумма
 * оказывалась завышена, апрельская — занижена, и обе расходились с
 * табелем. Поэтому итог месяца — сумма его СУТОК, и она в точности равна
 * сумме чисел, видимых в клетках.
 *
 * --- Почему ровно семь дней в строке ------------------------------------
 *
 * Дни выровнены по дням недели, как в настенном календаре. При графике
 * «сутки через трое» цикл четырёхдневный, а неделя семидневная, поэтому
 * смены идут по столбцам наискось — и сбой в графике виден как разрыв
 * этой диагонали, без пересчёта дат.
 *
 * --- Почему месяцы в колонках -------------------------------------------
 *
 * Учётный период — квартал, полугодие или год (ст. 104 ТК РФ), то есть
 * от трёх до двенадцати блоков. В одну колонку они дают полосу в
 * несколько экранов, где соседние месяцы невозможно сравнить глазом.
 */

interface MonthGroup {
  year: number;
  month: number;
  days: IsoDate[];
  /** Заступлений в этом месяце. */
  starts: number;
  /** Отработанные часы, пришедшиеся на СУТКИ этого месяца. */
  workedHours: Decimal;
  nightHours: Decimal;
  /** Часы вызовов помимо графика — они уже входят в `workedHours`. */
  calloutHours: Decimal;
  /** Пропущенных по уважительной причине смен. */
  absentStarts: number;
  /** Сутки месяца, которые уже наступили. Ноль — месяц целиком впереди. */
  counted: number;
}

export function ShiftStrip({
  calculation,
  upcoming,
  gridClassName,
  dayNotes,
  onPickDay,
  onMoveShift,
}: {
  calculation: PeriodCalculation;
  /**
   * Первые сутки, которые ещё не наступили («Онлайн»), или `null`.
   *
   * Сетка их ПОКАЗЫВАЕТ — гашёными и в штриховку, — но в свои итоги не
   * берёт: числа месяца обязаны совпадать с полосой итога наверху, а та
   * считает по сегодняшний день.
   */
  upcoming?: IsoDate | null;
  /** Раскладка месяцев: её задаёт масштаб, общий с календарём года. */
  gridClassName?: string;
  /** Заметки к суткам: их наличие видно прямо в клетке. */
  dayNotes: Readonly<Record<string, string>>;
  /** Нажатие по клетке: открыть правку этих суток. */
  onPickDay: (day: IsoDate) => void;
  /**
   * Перенос смены на другие сутки.
   *
   * Без него сетка остаётся такой, какой была: смены не тянутся. Так она
   * и стоит в заглушке экрана, где переносить нечего.
   */
  onMoveShift?: (from: IsoDate, to: IsoDate) => void;
}) {
  // На одни сутки может прийтись и смена, и вызов: человека вызвали на
  // соревнования в свой выходной или сняли со смены на выборы. Карта
  // «день → одна запись» такой день теряла бы молча.
  const byDay = new Map<IsoDate, DayRecord[]>();
  for (const record of calculation.days) {
    const bucket = byDay.get(record.day);
    if (bucket) bucket.push(record);
    else byDay.set(record.day, [record]);
  }

  const groups: MonthGroup[] = [];
  for (const day of datesInRange(calculation.periodStart, calculation.periodEnd)) {
    const year = yearOf(day);
    const month = monthIndex(day);
    let group = groups.at(-1);
    if (!group || group.year !== year || group.month !== month) {
      group = {
        year,
        month,
        days: [],
        starts: 0,
        workedHours: ZERO,
        nightHours: ZERO,
        calloutHours: ZERO,
        absentStarts: 0,
        counted: 0,
      };
      groups.push(group);
    }

    group.days.push(day);

    // Ещё не наступившие сутки в итог месяца не идут. Показать их и тут же
    // сложить в «отработано» значило бы объявить отработанным то, что
    // только предстоит.
    if (upcoming != null && day >= upcoming) continue;
    group.counted += 1;

    for (const record of byDay.get(day) ?? []) {
      if (record.isShiftStart) {
        group.starts += 1;
        if (record.absenceKind) group.absentStarts += 1;
      }
      if (record.calloutKind) group.calloutHours = group.calloutHours.plus(record.hours);
      if (!record.absenceKind) {
        group.workedHours = group.workedHours.plus(record.hours);
        group.nightHours = group.nightHours.plus(record.nightHours);
      }
    }
  }

  // Где стоят заступления: тянуть можно только их, и класть можно только
  // туда, где смены ещё нет. Набор строится по тому же расчёту, из
  // которого нарисована сетка, — второй источник разошёлся бы с видимым.
  const starts = new Set<IsoDate>();
  for (const record of calculation.days) {
    if (record.isShiftStart) starts.add(record.day);
  }
  const shown = new Set<IsoDate>();
  for (const group of groups) for (const day of group.days) shown.add(day);

  // Сегодняшний день берётся один раз за отрисовку: страницу открывают и
  // закрывают в тот же день, и переживать полночь ей не приходится. Тот же
  // довод, по которому так поступает и режим «Онлайн».
  const today = todayIso();

  const drag = useShiftDrag({
    // Класть смену можно в любые ПОКАЗАННЫЕ сутки без смены. Ограничение
    // показанным — не придирка: сутки за краем сетки человек не видит, и
    // «перенёс неизвестно куда» хуже, чем «не перенёс».
    canDrop: useCallback(
      (day: IsoDate) => onMoveShift !== undefined && shown.has(day) && !starts.has(day),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [onMoveShift, calculation],
    ),
    onMove: useCallback(
      (from: IsoDate, to: IsoDate) => onMoveShift?.(from, to),
      [onMoveShift],
    ),
    renderGhost: (day) => (
      <div
        className={cn(
          "flex size-11 flex-col items-center justify-center rounded-md leading-tight",
          "border border-verify/25 bg-verify/30 text-verify",
        )}
      >
        <span className="font-mono text-sm">{dayOfMonth(day)}</span>
        <span className="font-mono text-[10px]">смена</span>
      </div>
    ),
  });

  return (
    <div className="space-y-6 xl:flex xl:gap-4 xl:flex-row-reverse">
      <div
        className={
          gridClassName ??
          "grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {groups.map((group) => (
          <MonthGrid
            key={`${group.year}-${group.month}`}
            title={MONTH_NAMES[group.month]}
            meta={
              // Месяц, который весь ещё впереди, не показывает «0 см /
              // 0,0 ч» над сеткой, полной смен: ноль здесь означал бы «не
              // отработано», а верно — «не наступило». Месяц наполовину
              // прошедший показывает числа как есть: это итог на сегодня,
              // тот же, что в полосе наверху.
              group.counted === 0 ? (
                <span className="text-ink-faint">ещё не наступил</span>
              ) : (
              <>
                {/* Числа месяца доходят до нового значения, как и числа
                    полосы итога: человек отмечает отпуск в апреле и видит
                    движение там, где апрель, — а не только наверху. */}
                <CountedNumber value={String(group.starts)} /> см /{" "}
                <CountedNumber value={hours(group.workedHours)} /> ч
                {/* Раньше здесь стояло «· −8», и человек справедливо
                    прочитал это как «минус 8 часов». Число пропущенных
                    смен обязано быть подписано словом: приложение
                    существует ровно для того, чтобы часы не отнимались
                    молча, и двусмысленность в его собственном итоге —
                    последнее, что тут допустимо. */}
                {group.absentStarts > 0 ? (
                  <span className="text-signal">
                    {" / пропущено "}
                    <CountedNumber value={String(group.absentStarts)} />
                  </span>
                ) : null}
                {group.calloutHours.greaterThan(0) ? (
                  <span className="text-trace">
                    {" / вызовы "}
                    <CountedNumber value={hours(group.calloutHours)} />
                  </span>
                ) : null}
                {group.nightHours.greaterThan(0) ? (
                  <span className="text-ink-faint">
                    {" / ноч. "}
                    <CountedNumber value={hours(group.nightHours)} />
                  </span>
                ) : null}
              </>
              )
            }
            days={group.days}
            joined
            assemble
            renderDay={(day, corners) => (
              <DayCell
                day={day}
                records={byDay.get(day) ?? []}
                covered={calculation.absentDays.get(day) ?? null}
                note={dayNotes[day]}
                corners={corners}
                upcoming={upcoming != null && day >= upcoming}
                today={day === today}
                drag={drag}
                draggable={onMoveShift !== undefined && starts.has(day)}
                onPick={() => onPickDay(day)}
              />
            )}
          />
        ))}
      </div>
      <ShiftLegend />
      {drag.ghost}
    </div>
  );
}

/**
 * Легенда графика.
 *
 * --- Почему она вынесена отдельно ----------------------------------------
 *
 * Её показывает не только график, но и ЗАГЛУШКА рабочего экрана — та, что
 * стоит на месте расчёта, пока читается профиль. Заглушка обязана занимать
 * ровно то же место, что займёт содержимое, иначе страница дёрнется в
 * момент подстановки. Повторить разметку второй раз значило бы обречь эти
 * две копии разойтись, а вместе с ними — и раскладку.
 *
 * Поэтому разметка одна, а `skeleton` меняет только НАПОЛНЕНИЕ: подписи
 * набраны тем же кеглем и теми же словами, но прозрачны и лежат на
 * плашке. Размеры от этого не меняются ни на точку.
 *
 * Легенда разложена на три группы с заголовками, а не в одну полосу из
 * восемнадцати значков. Группа отвечает на вопрос «что вообще бывает в
 * клетке»: смена, пропуск, вызов, — и внутри группы человек уже ищет свой
 * случай. Прежняя сплошная строка заставляла перебирать всё подряд.
 *
 * На широком экране легенда стоит колонкой слева и держится на месте, как
 * числа над ней: `sticky` под самой полосой итога. Иначе, доведя календарь
 * до сентября, человек читает клетку «СБ» и уже не помнит, что она значит,
 * — легенда уехала за верхний край. `self-start` обязателен: в строке
 * `flex` элемент по умолчанию растянут на всю высоту сетки, и прилипать
 * ему просто некуда.
 */
export function ShiftLegend({ skeleton }: { skeleton?: boolean }) {
  return (
    <div className="lit space-y-4 border-t border-rule xl:border-none translate-y-1 xl:translate-y-3
                      xl:max-w-70 xl:w-full xl:flex xl:flex-col xl:gap-6 xl:sticky
                      xl:top-[calc(8rem+var(--safe-top))] xl:self-start bg-paper-raised/70 p-4 rounded-xl lg:min-w-92.5">
        <LegendGroup title="Смены по графику" skeleton={skeleton}>
          <Legend
            skeleton={skeleton}
            className={SHIFT_TONE}
            label="Начало смены"
          />
          <Legend
            skeleton={skeleton}
            className={SHIFT_TAIL_TONE}
            label="Продолжение смены"
          />
          <Legend
            skeleton={skeleton}
            className={DAY_OFF_TONE}
            mark={DAY_OFF_MARK}
            label="Выходной день"
          />
          {/* Перетаскивание ничем себя не выдаёт: клетка выглядит так же,
              как и любая другая. Сказать об этом словом — единственный
              способ, а место у слова одно — там, где объяснено остальное
              в этой сетке. */}
          <p className="text-xs text-ink-muted">
            <BoneText skeleton={skeleton}>
              Смену можно перенести: потяните её мышью или задержите палец и
              ведите. Или нажмите по дню и выберите «Выходной».
            </BoneText>
          </p>
        </LegendGroup>

        <LegendGroup title="Отсутствие по уважительной причине" skeleton={skeleton}>
          {(Object.keys(ABSENCE_MARK) as AbsenceKind[]).map((kind) => (
            <Legend
              key={kind}
              skeleton={skeleton}
              className={ABSENCE_TONE[kind]}
              mark={ABSENCE_MARK[kind]}
              label={ABSENCE_LABELS[kind]}
            />
          ))}
        </LegendGroup>

        <LegendGroup title="Работа помимо графика" skeleton={skeleton}>
          {(Object.keys(CALLOUT_MARK) as CalloutKind[]).map((kind) => (
            <Legend
              key={kind}
              skeleton={skeleton}
              className={CALLOUT_TONE}
              mark={CALLOUT_MARK[kind]}
              label={CALLOUT_LABELS[kind]}
            />
          ))}
          <Legend
            skeleton={skeleton}
            className={cn("border-2", CALLOUT_TONE)}
            mark={`${CALLOUT_MARK.competition} ${CALLOUT_MARK.reserve}`}
            label="Несколько выходов в сутки"
          />
        </LegendGroup>
      </div>
  );
}

/**
 * Коды вызовов, ужатые до ширины клетки.
 *
 * Один вызов — свой код целиком. Два — оба, потому что «СР РЗ» человек
 * прочитает и в сорока пикселях. Три и больше в клетку не влезут, и вместо
 * каши там стоит «СОР+2»: счётчик честно говорит, что вызовов больше, а
 * какие именно — скажет подпись при наведении.
 */
function calloutMarks(kinds: readonly CalloutKind[]): string {
  const marks = kinds.map((kind) => CALLOUT_MARK[kind]);
  if (marks.length <= 2) return marks.join(" ");
  return `${marks[0]}+${marks.length - 1}`;
}

function DayCell({
  day,
  records,
  covered,
  note,
  corners,
  upcoming,
  today,
  drag,
  draggable,
  onPick,
}: {
  day: IsoDate;
  records: readonly DayRecord[];
  /**
   * Освобождение, накрывающее эти сутки, — независимо от того, была ли в
   * них смена. Свободные по графику сутки внутри отпуска показываются
   * вполголоса: часов у них нет, а протяжённость отпуска они держат.
   */
  covered: AbsenceKind | null;
  note?: string;
  /** Скругления углов: их знает сетка, а не клетка. */
  corners: string;
  /** Сутки ещё не наступили: показаны, но в расчёт не входят. */
  upcoming?: boolean;
  /** Это сегодня — единственная клетка года с отметкой. */
  today?: boolean;
  /** Общее состояние переноса: что несут и куда сейчас положат. */
  drag: ShiftDrag;
  /** Есть ли в этих сутках смена, которую можно унести. */
  draggable: boolean;
  onPick: () => void;
}) {
  const date = dayOfMonth(day);
  const weekdayName = WEEKDAY_LABELS[weekday(day)] ?? "";
  // Родительный падеж, а не «2 март»: подпись читают вслух экранные
  // дикторы, и там оговорка слышна.
  const where = `${formatDayMonthRu(day)}, ${weekdayName}`;

  // Своих записей в сутках бывает ДВЕ: хвост вчерашней смены и начало
  // сегодняшней. Так выходит, когда человек ставит смену в те сутки, где
  // сдаёт предыдущую, — законный случай подмены, а не поломка.
  //
  // Клетку в таких сутках задаёт ЗАСТУПЛЕНИЕ, а не хвост. Раньше здесь
  // стоял `find`, и он брал первую запись по порядку — то есть хвост:
  // записи разложены по дате начала смены, и вчерашняя идёт раньше.
  // Человек включал «Смена в этот день», клетка оставалась бледной, как у
  // продолжения, и правка выглядела не сработавшей. Заступление — событие
  // этих суток, а хвост принадлежит вчерашним; оно и решает.
  const own = records.filter((record) => record.calloutKind == null);
  const shift = own.find((record) => record.isShiftStart) ?? own[0];
  // Вызовов в одни сутки может быть несколько: после смены соревнования, а
  // следом резерв. Раньше здесь стоял `find`, и второй вызов пропадал из
  // клетки и из подписи — при том, что в отработанные часы он входил.
  // Человек видел один код и заключал, что остальное не посчитано.
  const callouts = records.filter((record) => record.calloutKind != null);
  const workedHours = records
    .filter((record) => record.absenceKind === null)
    .reduce((sum, record) => sum.plus(record.hours), ZERO);

  // День недели ушёл из клетки в шапку столбца, и без подписи незрячий
  // читатель получил бы голое число: календарная сетка передаёт день
  // недели положением, а положение он не видит.
  //
  // Подпись называет и то, чего в клетке не видно: ночные часы и куда
  // именно вызывали. Именно эти две вещи чаще всего расходятся с табелем.
  // Числа в подписи — те же, что в клетке: целые часы без нулевого
  // хвоста. Иначе диктор произносит «шестнадцать целых ноль десятых» там,
  // где на экране написано «16».
  // Названы ОБЕ свои записи, а не только та, что задала цвет: в сутках,
  // где человек сдаёт одну смену и заступает на другую, «начало смены,
  // 16 ч» умалчивало бы о восьми часах, которые в итог всё равно вошли, —
  // и незрячий читатель видел бы сумму, не сходящуюся со слагаемыми.
  const parts: string[] = [];
  for (const record of own) {
    parts.push(
      record.absenceKind
        ? `${record.isShiftStart ? "смена по графику" : "продолжение смены"}, ${ABSENCE_LABELS[record.absenceKind]}`
        : `${record.isShiftStart ? "начало смены" : "продолжение смены"}, ${hoursTrim(record.hours)} ч` +
            (record.nightHours.greaterThan(0)
              ? `, из них ночных ${hoursTrim(record.nightHours)}`
              : ""),
    );
  }
  for (const callout of callouts) {
    if (callout.calloutKind) {
      parts.push(`${CALLOUT_LABELS[callout.calloutKind]}, ${hoursTrim(callout.hours)} ч`);
    }
  }
  // Итог суток называется, когда слагаемых больше одного: спор идёт именно
  // о том, всё ли посчитано, и сумма отвечает на это прямо.
  if (parts.length > 1 && workedHours.greaterThan(0)) {
    parts.push(`всего за сутки ${hoursTrim(workedHours)} ч`);
  }
  // Вполголоса помечаются только те сутки, у которых своей записи нет.
  // Смена — хоть отработанная, хоть пропущенная, — и вызов говорят о
  // сутках больше, чем протяжённость отпуска, и место в клетке отдаётся
  // им. Отработанный хвост смены, зашедший в первый день отпуска, так и
  // остаётся отработанным: часы за него посчитаны.
  const quiet = records.length === 0 ? covered : null;

  const label =
    `${where} — ` +
    (parts.length > 0
      ? parts.join("; ")
      : quiet
        ? `${ABSENCE_LABELS[quiet].toLowerCase()}, выходной по графику`
        : "свободные сутки");

  const worked = shift !== undefined && shift.absenceKind === null;
  const calloutKinds = callouts.flatMap((record) =>
    record.calloutKind ? [record.calloutKind] : [],
  );

  // Заметка названа в подписи, а не только помечена углом: угла незрячий
  // читатель не увидит, а знать о записи ему нужно так же.
  //
  // То же и с гашёными сутками: штриховку он не увидит, а «в расчёт не
  // входит» — единственное, что эти сутки отличает.
  // Красный контур сегодняшних суток незрячий читатель не увидит, а
  // ориентируется по нему так же — поэтому «сегодня» сказано и словом.
  // Стоит оно раньше заметки: это про то, ГДЕ человек находится, а не про
  // содержимое клетки.
  const full =
    label +
    (today ? ". Сегодня" : "") +
    (note ? `. Заметка: ${note}` : "") +
    (upcoming ? ". Ещё не наступило, в расчёт не входит" : "");

  const carried = drag.from === day;
  const target = drag.over === day;

  return (
    <button
      type="button"
      title={full}
      // Родная разметка «текущего» — та же, которой помечен сегодняшний
      // день во всплывающем календаре выбора даты. Программа чтения
      // объявляет её сама, независимо от того, как день выглядит.
      aria-current={today ? "date" : undefined}
      onClick={onPick}
      {...drag.cellProps(day, draggable)}
      className={cn(
        "relative flex aspect-square w-full min-w-0 cursor-pointer flex-col",
        "items-center justify-center leading-tight bg-paper-raised",
        // Клетка — маленькая панель: блик по кромке, обращённой к лампе, и
        // мягкая тень вниз. Свет на обёртке, а не на внутреннем квадрате:
        // у того тенью нарисован красный контур сегодняшних суток.
        "lit-tile",
        // Выделение текста мышью посреди переноса — первое, что портит
        // жест: курсор тащит смену, а браузер тащит выделение.
        "select-none",
        corners,
      )}
    >
      <div className={
        cn(
          "flex flex-col",
          "relative flex aspect-square w-full min-w-0 cursor-pointer flex-col",
          "items-center justify-center leading-tight rounded-md",
          "hover:outline-2 hover:-outline-offset-2 hover:outline-ink/40",
          "focus-visible:outline-2 focus-visible:-outline-offset-2",
          "focus-visible:outline-trace",
          records.length === 0 && !quiet && "bg-paper-raised text-ink-faint rounded-md",
          quiet && cn("border", ABSENCE_TONE_QUIET[quiet]),
          worked && shift.isShiftStart && "bg-verify/30 text-verify rounded-md border border-verify/25",
          worked && !shift.isShiftStart && "bg-verify/5 text-verify rounded-md border border-verify/15",
          shift?.absenceKind && cn("border", ABSENCE_TONE[shift.absenceKind]),
          calloutKinds.length > 0 && "border border-trace bg-trace-soft text-trace",
          calloutKinds.length > 1 && "border-2 rounded-xl",
          // Гашение — последним: оно поверх любого вида суток, каким бы
          // тот ни был. Сами цвета остаются, чтобы будущую смену было
          // видно сменой, а не пустой клеткой.
          upcoming && "cell-upcoming",
          // Отметка сегодняшних суток — после гашения и после всех видов
          // дня: она ничего не заменяет, а лежит поверх. Что бы в клетке
          // ни стояло, найти в году себя человек должен всегда.
          today && TODAY_MARK,
          // Смену несут: на своём месте от неё остаётся след, а не дырка.
          // Пустое место читалось бы как «уже перенёс», хотя палец ещё не
          // отпущен и бросок можно отменить.
          carried && "opacity-30",
          // Сюда положат. Обводка внутрь, как у наведения: клетки стоят
          // вплотную, и рамка сдвинула бы соседей.
          target && "outline-2 -outline-offset-2 outline-verify bg-verify/10",
        )}
      >
        <span className="sr-only">{full}</span>
        {/* Угол вместо цвета: цвет клетки уже занят видом суток, и второй
            смысл на том же канале означал бы, что ни один не читается. */}
        {note ? (
          <span
            aria-hidden
            className="absolute right-0 top-0 size-0 border-l-4 border-t-4 border-l-transparent border-t-trace"
          />
        ) : null}
        {/* Кегль задан в `em`, а не в пикселях: клетка растёт и уменьшается
            вместе с масштабом сетки, и число обязано расти вместе с ней —
            иначе на крупном масштабе получается пустой квадрат с мелкой
            цифрой посередине. Размер в `em` берётся от сетки, которая его и
            назначает. */}
        <span aria-hidden className="font-mono text-[1em]">
          {date}
        </span>
        <span
          aria-hidden
          className={cn(
            "font-mono",
            // Два кода вместо одного набираются мельче и теснее: иначе
            // «СОР РЕЗ» распирает клетку и ломает сетку месяца.
            calloutKinds.length > 1 ? "text-[0.67em] tracking-tighter" : "text-[0.75em]",
          )}
        >
          {calloutKinds.length > 0
            ? calloutMarks(calloutKinds)
            : quiet
              ? ABSENCE_MARK[quiet]
              : records.length === 0
                ? "В"
                : shift?.absenceKind
                  ? ABSENCE_MARK[shift.absenceKind]
                  : hoursTrim(workedHours)}
        </span>
      </div>
    </button>
  );
}

/**
 * Заголовок группы и её значки.
 *
 * Заголовок вынесен над рядом, а не повторён в каждой строке: раньше
 * «Смена по графику, пропущенная по уважительной причине» стояло
 * подписью к одному значку и занимало полстроки, хотя относится ко всем
 * семи сразу.
 */
function LegendGroup({
  title,
  children,
  skeleton,
}: {
  title: string;
  children: ReactNode;
  skeleton?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="font-display text-[11px] font-bold uppercase tracking-wide text-ink-muted">
        <BoneText skeleton={skeleton}>{title}</BoneText>
      </p>
      {/* Сеткой, а не переносом строк.
          --------------------------------------------------------------
          При переносе каждая строка встаёт по своей ширине: подписи в
          группе разной длины, и вторые столбцы у соседних строк не
          совпадают ни в одной. На телефоне и на среднем экране это
          читалось как рассыпанный текст, а не как список.

          Столбцов два до среднего экрана и три на нём. Один — на самом
          широком, где легенда стоит колонкой слева: там ширины на два
          уже нет, да и колонка сама себе столбец.

          `[&>p]:col-span-full` — оговорки вроде «смену можно перенести»:
          это не образец, а строка текста, и в столбец ей вставать
          незачем. */}
      <dl className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-1
                     gap-x-4 gap-y-1.5 text-xs [&>p]:col-span-full">
        {children}
      </dl>
    </div>
  );
}

/**
 * Значок легенды: та же клетка, что в сетке, с тем же знаком внутри.
 *
 * Знак внутри образца, а не рядом с ним, — чтобы образец совпадал с тем,
 * что человек видит в календаре, вплоть до буквы. Легенда, в которой
 * цвет отдельно, а буква отдельно, требует складывать их в уме.
 */
function Legend({
  className,
  label,
  mark,
  skeleton,
}: {
  className: string;
  label: string;
  mark?: string;
  skeleton?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <dt
        aria-hidden
        className={cn(
          // Ширина по содержимому, а не квадрат: «ДО» и «ОСВ» в
          // шестнадцати пикселях сминаются в кашу.
          // Ширина по содержимому, а не квадрат: «ДО» и «ОСВ» в
          // шестнадцати пикселях сминаются в кашу.
          "inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-xs border px-2",
          "font-mono text-[12px] leading-none",
          // В заглушке цвет вида суток заменён общим тоном плашки: он
          // ничего не значит, пока расчёта нет, а размеры образца — те же.
          skeleton ? "skeleton-bone border-transparent bg-paper-raised text-transparent" : className,
          "rounded-sm"
        )}
      >
        {mark}
      </dt>
      <dd className="text-ink-muted">
        <BoneText skeleton={skeleton}>{label}</BoneText>
      </dd>
    </div>
  );
}
