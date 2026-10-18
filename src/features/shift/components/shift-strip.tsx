"use client";

import { useCallback, type ReactNode } from "react";

import { BoneText } from "@/components/ui/bone";
import { CountedNumber } from "@/components/ui/counted-number";
import { cn } from "@/lib/utils/cn";

import type { DayRecord, PeriodCalculation } from "../domain/calculation";
import type { MonthTotal } from "../model/derive";
import { ZERO, formatHoursTrim as hoursTrim } from "../domain/decimal";
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
  ABSENCE_TONE_QUIET,
  CALLOUT_MARK,
  CALLOUT_TONE,
  DAY_OFF_MARK,
  DAY_OFF_TONE,
  SHIFT_TAIL_TONE,
  SHIFT_TONE,
} from "./day-marks";
import type { AbsenceKind, CalloutKind } from "../domain/value-objects";

import { MONTH_NAMES } from "./month-names";
import { HolidayIcon, type HolidayMark } from "./holiday-marks";
import {
  META_FIGURE,
  META_UNIT,
  MetaSep,
  MonthGrid,
  TODAY_MARK,
  WEEKDAY_LABELS,
  YEAR_BOX,
  YEAR_GRID,
} from "./month-grid";
import { useShiftDrag, type ShiftDrag } from "./use-shift-drag";

/**
 * График смен: месяц — блок, неделя — строка.
 *
 * --- Почему счёт идёт по СУТКАМ, а не по сменам --------------------------
 *
 * Смена длится сутки с заступления, поэтому лежит в двух календарных днях. При
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
}

/** Первые сутки месяца в сетке — по ним ищется его итог. */
const day0 = (group: MonthGroup): IsoDate => group.days[0]!;

/**
 * Итог месяца над его сеткой: норма, факт и разница.
 *
 * --- Почему эти три, а не смены и ночные -----------------------------------
 *
 * Здесь стояло «8 см | 192 ч | ноч. 64» — сколько смен, сколько часов и
 * сколько из них ночных. Всё это правда, но на вопрос, ради которого
 * человек смотрит на месяц, оно не отвечало: «я в этом месяце переработал
 * или нет?» — для этого рядом с фактом нужна норма, а её на экране не было.
 * Теперь над месяцем то же, что в полосе итога наверху, — норма, факт и
 * разница, — только за месяц, и полоса служит ему расшифровкой: порядок
 * тот же.
 *
 * Разница — часами, всегда, даже если в полосе переработка показана
 * сменами: в подписи месяца место считано, а «1 смена 8 ч» вдвое длиннее
 * «+32 ч». Цвет у неё тот же, что в полосе: переработка зелёная,
 * недоработка красная, ноль без цвета — попадание в норму не требует ни
 * радости, ни тревоги.
 *
 * Знака «+» или «−» перед разницей нет. Что это переработка или недоработка,
 * говорит цвет, а программе чтения — слово (`sr-only`): ей разница названа
 * так же, как норма с фактом. Знак рядом с цветом говорил бы то же второй
 * раз, а в подписи, где место считано, лишний знак перед каждым из двенадцати
 * итогов — это ещё и лишняя ширина.
 *
 * --- Почему месяц впереди не показывает нулей ------------------------------
 *
 * Месяц, который весь ещё впереди («Онлайн»), не показывает «норма 160,
 * факт 0, недоработка 160» над сеткой, полной смен: ноль здесь означал бы
 * «не отработано», а верно — «не наступило». Месяц наполовину прошедший
 * показывает итог на сегодня — тот же, что в полосе наверху.
 */
function MonthBalance({ total }: { total: MonthTotal | undefined }) {
  if (total === undefined) return <span className="text-ink-faint">ещё не наступил</span>;

  const over = total.overtimeHours.greaterThan(0);
  const under = total.undertimeHours.greaterThan(0);
  const balance = under ? total.undertimeHours : total.overtimeHours;
  const name = over ? "переработка" : under ? "недоработка" : "разница";

  return (
    <span
      title={`Норма ${hoursTrim(total.normHours)} ч, отработано ${hoursTrim(total.actualHours)} ч, ${name} ${hoursTrim(balance)} ч`}
    >
      {/* Числа доходят до нового значения, как и числа полосы итога:
          человек отмечает отпуск в апреле и видит движение там, где
          апрель, — а не только наверху. Без нулевого хвоста: «160 ч», а
          не «160,0 ч» (`formatHoursTrim`). */}
      <span className="sr-only">норма </span>
      <span className={META_FIGURE}>
        <CountedNumber value={hoursTrim(total.normHours)} />
      </span>
      <span className={META_UNIT}>ч</span>
      <MetaSep />
      <span className="sr-only">отработано </span>
      <span className={META_FIGURE}>
        <CountedNumber value={hoursTrim(total.actualHours)} />
      </span>
      <span className={META_UNIT}>ч</span>
      <MetaSep />
      <span className="sr-only">{name} </span>
      {/* Цвет разницы — единственный признак, что это переработка или
          недоработка: знака «+» и «−» нет. Ноль — чернилами, как норма и факт. */}
      <span className={cn(META_FIGURE, over && "text-verify", under && "text-signal")}>
        <CountedNumber value={hoursTrim(balance)} />
      </span>
      <span className={META_UNIT}>ч</span>
    </span>
  );
}

export function ShiftStrip({
  calculation,
  monthTotals,
  upcoming,
  gridClassName,
  dayNotes,
  holidays,
  onPickDay,
  onMoveShift,
}: {
  calculation: PeriodCalculation;
  /**
   * Итоги месяцев — норма, факт и разница над каждым месяцем
   * (`monthTotalsFor`). Месяца, который ещё не наступил, в них нет.
   */
  monthTotals: ReadonlyMap<string, MonthTotal>;
  /**
   * Первые сутки, которые ещё не наступили («Онлайн»), или `null`.
   *
   * Сетка их ПОКАЗЫВАЕТ — гашёными и в штриховку, — но в итоги месяцев не
   * берёт: те считаются по сегодняшний день, как полоса наверху
   * (`monthTotals`).
   */
  upcoming?: IsoDate | null;
  /** Раскладка месяцев: её задаёт масштаб, общий с календарём года. */
  gridClassName?: string;
  /** Заметки к суткам: их наличие видно прямо в клетке. */
  dayNotes: Readonly<Record<string, string>>;
  /**
   * Праздничные сутки по производственному календарю: значок в углу клетки
   * (`holiday-marks.tsx`). Без него клетки остаются без значков — так сетка и
   * стоит в заглушке, где календаря ещё нет.
   */
  holidays?: ReadonlyMap<IsoDate, HolidayMark>;
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
      group = { year, month, days: [] };
      groups.push(group);
    }
    group.days.push(day);
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
    // Одна колонка: легенда уехала в окошко у кнопки в левом нижнем углу
    // (`legend-button.tsx`), и делить ширину года больше не с кем.
    <div className="space-y-6">
      {/* Мерная коробка вокруг сетки: из её ширины таблица стилей считает
          ширину месяца, а из той — кегль в клетке. Подробности у самих
          классов (`month-grid.tsx`) и правил (`globals.css`). */}
      <div className={YEAR_BOX}>
      <div className={gridClassName ?? YEAR_GRID}>
        {groups.map((group) => (
          <MonthGrid
            key={`${group.year}-${group.month}`}
            title={MONTH_NAMES[group.month]}
            meta={
              <MonthBalance total={monthTotals.get(day0(group).slice(0, 7))} />
            }
            days={group.days}
            joined
            renderDay={(day, corners) => (
              <DayCell
                day={day}
                records={byDay.get(day) ?? []}
                covered={calculation.absentDays.get(day) ?? null}
                note={dayNotes[day]}
                holiday={holidays?.get(day) ?? null}
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
      </div>
      {drag.ghost}
    </div>
  );
}

/**
 * Легенда графика.
 *
 * --- Где она живёт ---------------------------------------------------------
 *
 * В окошке у кнопки в левом нижнем углу рабочего экрана
 * (`legend-button.tsx`), а не колонкой рядом с сетками, как было.
 *
 * Колонка честно работала на широком экране и была бесполезна на узком:
 * там легенда стояла ПОД двенадцатью сетками, то есть за тремя экранами
 * прокрутки от клетки, значение которой человек и хотел узнать. А на
 * широком она отнимала у года семнадцать рем ширины — самое дорогое, что
 * у этого экрана есть.
 *
 * Кнопка решает оба случая разом: легенда на расстоянии одного нажатия с
 * любого места года и не занимает места, пока её не спросили.
 *
 * --- Почему разметка одна --------------------------------------------------
 *
 * `skeleton` оставлен: по этой же разметке рисовалась заглушка, и если
 * легенда когда-нибудь вернётся в поток страницы, кости должны взяться
 * отсюда же, а не быть переписаны рядом.
 *
 * Легенда разложена на три группы с заголовками, а не в одну полосу из
 * восемнадцати значков. Группа отвечает на вопрос «что вообще бывает в
 * клетке»: смена, пропуск, вызов, — и внутри группы человек уже ищет свой
 * случай. Прежняя сплошная строка заставляла перебирать всё подряд.
 */
export function ShiftLegend({ skeleton }: { skeleton?: boolean }) {
  return (
    // Ни плашки, ни света: их даёт окошко, в котором легенда стоит
    // (`legend-button.tsx`). Здесь только порядок групп и просвет между
    // ними.
    <div className="space-y-4">
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
        </LegendGroup>

        <LegendGroup title="Периоды отсутствия" skeleton={skeleton}>
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
          {/* Одна строка на все выходы сверх графика.
              -----------------------------------------------------------------
              Их было шесть: вызов, соревнования, сбор, резерв, праздник,
              выборы — с шестью кодами в клетках и шестью строками здесь.
              Половина легенды уходила на различия, которых нет: считаются
              все шесть одинаково, и человек, отмечая выход, выбирал из
              шести слов там, где ответ на вопрос «что это было» один —
              работа не по графику.

              Старые профили от этого не пострадали: записанный в них вид
              сохраняется как был, а называет его подпись клетки и перечень
              внесённых изменений, где для названия есть целая строка. */}
          <Legend
            skeleton={skeleton}
            className={CALLOUT_TONE}
            mark={CALLOUT_MARK}
            label={CALLOUT_LABELS.callout}
          />
        </LegendGroup>
      </div>
  );
}

/**
 * Код вызова в клетке, а при нескольких — со счётчиком.
 *
 * Код на все выходы сверх графика один (`CALLOUT_MARK`), и повторять его
 * дважды бессмысленно: «Р Р» — это не два вида работы, а два выхода.
 * Поэтому второй и следующие считаются числом: «Р+1». Сколько их было и
 * какие именно — скажет подпись клетки при наведении.
 */
function calloutMarks(kinds: readonly CalloutKind[]): string {
  if (kinds.length <= 1) return CALLOUT_MARK;
  return `${CALLOUT_MARK}+${kinds.length - 1}`;
}

function DayCell({
  day,
  records,
  covered,
  note,
  holiday,
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
  /** Праздник по производственному календарю: значок в правом верхнем углу. */
  holiday: HolidayMark | null;
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
  const worked = shift !== undefined && shift.absenceKind === null;
  const calloutKinds = callouts.flatMap((record) =>
    record.calloutKind ? [record.calloutKind] : [],
  );

  /**
   * Отпуск, накрывающий эти сутки, — вполголоса.
   *
   * Своей записи у таких суток нет: есть свободные сутки внутри отпуска и
   * есть ХВОСТ вчерашней смены, зашедший в первый день отпуска. И то и
   * другое отпуск накрывает целиком, и показать это обязан.
   *
   * Хвост раньше отменял отметку. Человек отмечал отпуск с 11-го, смена
   * начиналась 10-го и кончалась в 8 утра 11-го — и клетка 11-го не
   * менялась НИКАК: ни цветом, ни буквой. При этом норма падала на восемь
   * часов, а переработка на столько же росла — то есть расчёт отпуск
   * видел, а сетка о нём молчала, и человек читал это как «не сработало».
   *
   * Часы хвоста при этом остаются в клетке числом (ниже): они отработаны и
   * посчитаны. Отпуск говорит цветом и рамкой, часы — числом; спорить им
   * не о чем, это разные каналы.
   *
   * Свою запись суток отпуск не заменяет: заступление на смену, вызов и
   * пропущенная смена говорят о сутках больше, чем протяжённость отпуска,
   * и место в клетке отдаётся им.
   */
  const tailOnly =
    shift !== undefined && !shift.isShiftStart && shift.absenceKind === null;
  const quiet =
    (records.length === 0 || (tailOnly && calloutKinds.length === 0)) ? covered : null;

  const label =
    `${where} — ` +
    (parts.length > 0
      ? // Отпуск дописывается к своим записям, а не заменяет их: на хвосте
        // смены, зашедшем в отпуск, верно и то и другое, и незрячий
        // читатель должен услышать обе половины — как зрячий видит и часы,
        // и цвет.
        parts.join("; ") + (quiet ? `; ${ABSENCE_LABELS[quiet].toLowerCase()}` : "")
      : quiet
        ? `${ABSENCE_LABELS[quiet].toLowerCase()}, выходной по графику`
        : "свободные сутки");

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
    // Праздник назван словом: значок в углу мелкий и читается образом, а
    // незрячему читателю недоступен вовсе.
    (holiday ? `. ${holiday.title}` : "") +
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

          "focus-visible:outline-2 focus-visible:-outline-offset-2",
          "focus-visible:outline-ink",
          records.length === 0 && !quiet && "bg-paper-raised text-ink-faint rounded-md",
          worked && shift.isShiftStart && "bg-verify/30 text-verify rounded-md border border-verify/25",
          worked && !shift.isShiftStart && "bg-verify/5 text-verify rounded-md border border-verify/15",
          // Отпуск вполголоса — ПОСЛЕ отработанного, и порядок тут решает
          // всё: у хвоста, зашедшего в отпуск, обе строки правдивы, и
          // побеждать должна та, которую человек только что внёс. Стояла
          // она выше — и отметка отпуска не меняла в клетке ничего.
          quiet && cn("border", ABSENCE_TONE_QUIET[quiet]),
          // Пропущенная смена: в полный голос — только сутки заступления.
          // -----------------------------------------------------------------
          // Смена, переходящая через полночь, лежит в расчёте двумя частями,
          // и освобождение помечает обе (`calculation.ts`): пропущена она
          // целиком, и хвост её тоже не отработан. Но на сетке это ДВА
          // квадрата, и оба в полную силу читались как два отгула подряд —
          // человек, поставивший один, видел два.
          //
          // Различие здесь то же, каким различаются заступление и
          // продолжение отработанной смены: цвет тот же, плотность меньше.
          // Один раз выученное правило «слабее — значит продолжение»
          // работает и на отработанной смене, и на пропущенной, и на
          // свободных сутках внутри отпуска (`ABSENCE_TONE_QUIET`).
          shift?.absenceKind &&
            cn(
              "border",
              shift.isShiftStart
                ? ABSENCE_TONE[shift.absenceKind]
                : ABSENCE_TONE_QUIET[shift.absenceKind],
            ),
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
        {/* Значок праздника — в правом верхнем углу, поверх клетки и не двигая
            ничего: на мелком масштабе он сам сходит на нет по ширине месяца
            (`.holiday-mark`). От угла заметки он отступает на пять точек. */}
        {holiday ? <HolidayIcon /> : null}
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
          {/* Порядок здесь и есть правило, что показывать в клетке.
              ------------------------------------------------------------
              Своя запись суток идёт раньше накрывшего их отпуска: буква
              пропущенной смены остаётся буквой и тогда, когда в тех же
              сутках отработан хвост вчерашней (законный случай при графике
              «два через два»).

              А вот часы стоят раньше буквы НАКРЫВШЕГО отпуска: у хвоста,
              зашедшего в первый день отпуска, они отработаны и посчитаны,
              и подменить их буквой значило бы стереть с сетки восемь
              часов, которые в итоге есть. Отпуск на таких сутках говорит
              цветом и рамкой — канал у него свой. */}
          {calloutKinds.length > 0
            ? calloutMarks(calloutKinds)
            : shift?.absenceKind
              ? ABSENCE_MARK[shift.absenceKind]
              : workedHours.greaterThan(0)
                ? hoursTrim(workedHours)
                : quiet
                  ? ABSENCE_MARK[quiet]
                  : records.length === 0
                    ? "В"
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
