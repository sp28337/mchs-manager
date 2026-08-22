import type { ReactNode } from "react";

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
  weekday,
  year as yearOf,
  type IsoDate,
} from "../domain/plain-date";
import { formatDayMonthRu } from "../domain/format";
import { ABSENCE_LABELS, CALLOUT_LABELS } from "../schemas";
import type { AbsenceKind, CalloutKind } from "../domain/value-objects";

/**
 * Короткий код вызова в клетке.
 *
 * Три буквы, а не цвет: видов вызова шесть, и шесть оттенков одного
 * значения человек не различит — а «РЕЗ» и «ВЫБ» прочитает сразу.
 * Полное название стоит в подписи клетки и в легенде.
 */
const CALLOUT_MARK: Record<CalloutKind, string> = {
  competition: "СР",
  training_camp: "СБ",
  reserve: "РЗ",
  public_event: "МР",
  elections: "ВБ",
};

/**
 * Буква вместо прочерка в клетке пропущенной смены.
 *
 * Раньше все семь видов отсутствия выглядели одинаково: «—» на сигнальном
 * фоне. Но человек, глядя на год, ищет не «отсутствие вообще» — он ищет
 * конкретный случай, из-за которого спорит: где стоял больничный, где
 * отпуск, где отгул. Прочерк на этот вопрос не отвечал, и приходилось
 * наводить курсор на каждую клетку.
 *
 * Обозначения взяты из табеля Т-13, а не выдуманы: их узнает и тот, кто
 * заполняет табель по ту сторону спора.
 */
const ABSENCE_MARK: Record<AbsenceKind, string> = {
  annual_leave: "О",
  sick_leave: "Б",
  time_off_in_lieu: "В",
  study_leave: "У",
};

/**
 * Цвет клетки по виду отсутствия.
 *
 * Свой цвет у каждого вида, кроме отпуска: он остаётся сигнальным, каким
 * был. Тона разведены не на глаз — между насыщенными цветами интерфейса
 * не меньше 26° по кругу, значения и расчёт в `globals.css`.
 *
 * Пунктирная рамка общая у всех: она означает «смена по графику была, но
 * не состоялась», и это свойство у семи видов одно на всех. Цвет отвечает
 * на следующий вопрос — почему именно не состоялась.
 */
const ABSENCE_TONE: Record<AbsenceKind, string> = {
  annual_leave: "border-dashed border-signal/50 bg-signal-soft text-signal rounded-md",
  sick_leave: "border-dashed border-sick/50 bg-sick-soft text-sick rounded-md",
  time_off_in_lieu: "border-dashed border-rest/50 bg-rest-soft text-rest rounded-md",
  study_leave: "border-dashed border-study/50 bg-study-soft text-study rounded-md",
};
import { MONTH_NAMES } from "./month-names";
import { MonthGrid, WEEKDAY_LABELS } from "./month-grid";

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
            renderDay={(day, corners) => (
              <DayCell
                day={day}
                records={byDay.get(day) ?? []}
                note={dayNotes[day]}
                corners={corners}
                upcoming={upcoming != null && day >= upcoming}
                onPick={() => onPickDay(day)}
              />
            )}
          />
        ))}
      </div>
      <ShiftLegend />
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
    <div className="space-y-4 border-t border-rule xl:border-none translate-y-1
                      xl:max-w-70 xl:w-full xl:flex xl:flex-col xl:gap-6 xl:sticky
                      xl:top-32 xl:self-start bg-paper-raised/70 p-4 rounded-xl lg:min-w-92.5">
        <LegendGroup title="Смены по графику" skeleton={skeleton}>
          <Legend
            skeleton={skeleton}
            className="border-verify/25 bg-verify/30 text-verify"
            label="Начало смены"
          />
          <Legend
            skeleton={skeleton}
            className="border-verify/15 bg-verify/5 text-verify"
            label="Продолжение смены"
          />
          <Legend
            skeleton={skeleton}
            className="border-rule text-ink-faint bg-paper-raised"
            mark="В"
            label="Выходной день"
          />
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
              className="border-trace bg-trace-soft text-trace"
              mark={CALLOUT_MARK[kind]}
              label={CALLOUT_LABELS[kind]}
            />
          ))}
          <Legend
            skeleton={skeleton}
            className="border-2 border-trace bg-trace-soft text-trace"
            mark="СР РЗ"
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
  note,
  corners,
  upcoming,
  onPick,
}: {
  day: IsoDate;
  records: readonly DayRecord[];
  note?: string;
  /** Скругления углов: их знает сетка, а не клетка. */
  corners: string;
  /** Сутки ещё не наступили: показаны, но в расчёт не входят. */
  upcoming?: boolean;
  onPick: () => void;
}) {
  const date = dayOfMonth(day);
  const weekdayName = WEEKDAY_LABELS[weekday(day)] ?? "";
  // Родительный падеж, а не «2 март»: подпись читают вслух экранные
  // дикторы, и там оговорка слышна.
  const where = `${formatDayMonthRu(day)}, ${weekdayName}`;

  const shift = records.find((record) => record.calloutKind == null);
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
  const parts: string[] = [];
  if (shift) {
    parts.push(
      shift.absenceKind
        ? `${shift.isShiftStart ? "смена по графику" : "продолжение смены"}, ${ABSENCE_LABELS[shift.absenceKind]}`
        : `${shift.isShiftStart ? "начало смены" : "продолжение смены"}, ${hoursTrim(shift.hours)} ч` +
            (shift.nightHours.greaterThan(0)
              ? `, из них ночных ${hoursTrim(shift.nightHours)}`
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
  const label = `${where} — ${parts.length > 0 ? parts.join("; ") : "свободные сутки"}`;

  const worked = shift !== undefined && shift.absenceKind === null;
  const calloutKinds = callouts.flatMap((record) =>
    record.calloutKind ? [record.calloutKind] : [],
  );

  // Заметка названа в подписи, а не только помечена углом: угла незрячий
  // читатель не увидит, а знать о записи ему нужно так же.
  //
  // То же и с гашёными сутками: штриховку он не увидит, а «в расчёт не
  // входит» — единственное, что эти сутки отличает.
  const full =
    (note ? `${label}. Заметка: ${note}` : label) +
    (upcoming ? ". Ещё не наступило, в расчёт не входит" : "");

  return (
    <button
      type="button"
      title={full}
      onClick={onPick}
      className={cn(
        "relative flex aspect-square w-full min-w-0 cursor-pointer flex-col",
        "items-center justify-center leading-tight bg-paper-raised",
        corners,
      )}
    >
      <div className={
        cn(
          "flex flex-col",
          "relative flex aspect-square w-full min-w-0 cursor-pointer flex-col",
          "items-center justify-center leading-tight",
          "hover:outline-2 hover:-outline-offset-2 hover:outline-ink/40",
          "focus-visible:outline-2 focus-visible:-outline-offset-2",
          "focus-visible:outline-trace",
          records.length === 0 && "bg-paper-raised text-ink-faint rounded-md",
          worked && shift.isShiftStart && "bg-verify/30 text-verify rounded-md border border-verify/25",
          worked && !shift.isShiftStart && "bg-verify/5 text-verify rounded-md border border-verify/15",
          shift?.absenceKind && cn("border", ABSENCE_TONE[shift.absenceKind]),
          calloutKinds.length > 0 && "border border-trace bg-trace-soft text-trace",
          calloutKinds.length > 1 && "border-2 rounded-xl",
          // Гашение — последним: оно поверх любого вида суток, каким бы
          // тот ни был. Сами цвета остаются, чтобы будущую смену было
          // видно сменой, а не пустой клеткой.
          upcoming && "cell-upcoming",
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
      <dl className="flex flex-wrap xl:flex-col gap-x-5 gap-y-1.5 text-xs">{children}</dl>
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
