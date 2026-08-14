import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import type { DayRecord, PeriodCalculation } from "../domain/calculation";
import { ZERO, formatHours as hours, type Decimal } from "../domain/decimal";
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
  competition: "СОР",
  training_camp: "СБР",
  reserve: "РЕЗ",
  public_event: "МЕР",
  elections: "ВЫБ",
  other_callout: "ВЫЗ",
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
  unpaid_leave: "ДО",
  business_trip: "К",
  other_excused: "ОСВ",
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
  annual_leave: "border-dashed border-signal bg-signal-soft text-signal",
  sick_leave: "border-dashed border-sick bg-sick-soft text-sick",
  time_off_in_lieu: "border-dashed border-rest bg-rest-soft text-rest",
  study_leave: "border-dashed border-study bg-study-soft text-study",
  unpaid_leave: "border-dashed border-unpaid bg-unpaid-soft text-unpaid",
  business_trip: "border-dashed border-trip bg-trip-soft text-trip",
  other_excused: "border-dashed border-excused bg-excused-soft text-excused",
};
import { MONTH_NAMES } from "./month-names";
import { MonthGrid, WEEKDAY_LABELS } from "./month-grid";

/**
 * График смен: месяц — блок, неделя — строка.
 *
 * --- Почему счёт идёт по СУТКАМ, а не по сменам --------------------------
 *
 * Смена длится сутки с развода, поэтому лежит в двух календарных днях. При
 * разводе в 08:30 смена, заступившая 31 марта, отдаёт марту 15,5 часа, а
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
 * Учётный период — полугодие или год (Приказ № 308 п. 2, № 307 п. 7), то
 * есть шесть-двенадцать блоков. В одну колонку они дают полосу в
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
  /** Пропущенных по уважительной причине заступлений. */
  absentStarts: number;
}

export function ShiftStrip({ calculation }: { calculation: PeriodCalculation }) {
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
      };
      groups.push(group);
    }

    group.days.push(day);

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
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group, index) => (
          <MonthGrid
            key={`${group.year}-${group.month}`}
            title={
              <>
                {MONTH_NAMES[group.month]}
                {/* Год подписывается только там, где он меняется:
                    повторять его у каждого месяца — шум. */}
                {index === 0 || group.year !== groups[index - 1]?.year ? (
                  <span className="text-ink-muted"> {group.year}</span>
                ) : null}
              </>
            }
            meta={
              <>
                {group.starts} см · {hours(group.workedHours)} ч
                {/* Раньше здесь стояло «· −8», и человек справедливо
                    прочитал это как «минус 8 часов». Число пропущенных
                    смен обязано быть подписано словом: приложение
                    существует ровно для того, чтобы часы не отнимались
                    молча, и двусмысленность в его собственном итоге —
                    последнее, что тут допустимо. */}
                {group.absentStarts > 0 ? (
                  <span className="text-signal"> · пропущено {group.absentStarts}</span>
                ) : null}
                {group.calloutHours.greaterThan(0) ? (
                  <span className="text-trace"> · вызовы {hours(group.calloutHours)}</span>
                ) : null}
                {group.nightHours.greaterThan(0) ? (
                  <span className="text-ink-faint"> · ноч. {hours(group.nightHours)}</span>
                ) : null}
              </>
            }
            days={group.days}
            renderDay={(day) => <DayCell day={day} records={byDay.get(day) ?? []} />}
          />
        ))}
      </div>

      {/* Легенда разложена на три группы с заголовками, а не в одну
          полосу из восемнадцати значков. Группа отвечает на вопрос «что
          вообще бывает в клетке»: смена, пропуск, вызов, — и внутри
          группы человек уже ищет свой случай. Прежняя сплошная строка
          заставляла перебирать всё подряд. */}
      <div className="space-y-4 border-t border-rule pt-4">
        <LegendGroup title="Смены по графику">
          <Legend
            className="border-verify bg-verify-soft text-verify"
            label="Заступление на смену"
          />
          <Legend
            className="border-verify/50 bg-verify-soft/50 text-verify"
            label="Продолжение смены, заступившей накануне"
          />
          <Legend className="border-rule text-ink-faint" mark="В" label="Выходной день" />
        </LegendGroup>

        <LegendGroup title="Смены по графику, пропущенные по уважительной причине">
          {(Object.keys(ABSENCE_MARK) as AbsenceKind[]).map((kind) => (
            <Legend
              key={kind}
              className={ABSENCE_TONE[kind]}
              mark={ABSENCE_MARK[kind]}
              label={ABSENCE_LABELS[kind]}
            />
          ))}
        </LegendGroup>

        <LegendGroup title="Вызовы помимо графика">
          {(Object.keys(CALLOUT_MARK) as CalloutKind[]).map((kind) => (
            <Legend
              key={kind}
              className="border-trace bg-trace-soft text-trace"
              mark={CALLOUT_MARK[kind]}
              label={CALLOUT_LABELS[kind]}
            />
          ))}
          <Legend
            className="border-2 border-trace bg-trace-soft text-trace"
            mark="СОР РЕЗ"
            label="Несколько вызовов в одни сутки — часы складываются"
          />
        </LegendGroup>
      </div>
    </div>
  );
}

/**
 * Коды вызовов, ужатые до ширины клетки.
 *
 * Один вызов — свой код целиком. Два — оба, потому что «СОР РЕЗ» человек
 * прочитает и в сорока пикселях. Три и больше в клетку не влезут, и вместо
 * каши там стоит «СОР+2»: счётчик честно говорит, что вызовов больше, а
 * какие именно — скажет подпись при наведении.
 */
function calloutMarks(kinds: readonly CalloutKind[]): string {
  const marks = kinds.map((kind) => CALLOUT_MARK[kind]);
  if (marks.length <= 2) return marks.join(" ");
  return `${marks[0]}+${marks.length - 1}`;
}

function DayCell({ day, records }: { day: IsoDate; records: readonly DayRecord[] }) {
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
  const parts: string[] = [];
  if (shift) {
    parts.push(
      shift.absenceKind
        ? `${shift.isShiftStart ? "смена по графику" : "продолжение смены"}, ${ABSENCE_LABELS[shift.absenceKind]}`
        : `${shift.isShiftStart ? "заступление" : "продолжение смены"}, ${hours(shift.hours)} ч` +
            (shift.nightHours.greaterThan(0)
              ? `, из них ночных ${hours(shift.nightHours)}`
              : ""),
    );
  }
  for (const callout of callouts) {
    if (callout.calloutKind) {
      parts.push(`${CALLOUT_LABELS[callout.calloutKind]}, ${hours(callout.hours)} ч`);
    }
  }
  // Итог суток называется, когда слагаемых больше одного: спор идёт именно
  // о том, всё ли посчитано, и сумма отвечает на это прямо.
  if (parts.length > 1 && workedHours.greaterThan(0)) {
    parts.push(`всего за сутки ${hours(workedHours)} ч`);
  }
  const label = `${where} — ${parts.length > 0 ? parts.join("; ") : "свободные сутки"}`;

  const worked = shift !== undefined && shift.absenceKind === null;
  const calloutKinds = callouts.flatMap((record) =>
    record.calloutKind ? [record.calloutKind] : [],
  );

  return (
    <div
      title={label}
      className={cn(
        "flex min-w-0 flex-col items-center justify-center rounded-xs border py-0.5 leading-tight",
        "lg:aspect-square lg:py-0",
        records.length === 0 && "border-rule text-ink-faint",
        // Хвост смены отличается от заступления бледностью, а не другим
        // цветом: это те же отработанные часы, и разный цвет читался бы как
        // разный род времени.
        worked && shift.isShiftStart && "border-verify bg-verify-soft text-verify",
        worked && !shift.isShiftStart && "border-verify/50 bg-verify-soft/50 text-verify",
        shift?.absenceKind && ABSENCE_TONE[shift.absenceKind],
        // Вызов перебивает вид смены: он редок, и человек ищет глазами
        // именно его. Часы при этом не теряются — они в подписи и в итоге
        // месяца.
        calloutKinds.length > 0 && "border-trace bg-trace-soft text-trace",
        // Несколько вызовов в одни сутки видно и без чтения кодов: рамка
        // становится плотнее. Это единственные сутки, где человеку нужно
        // навести курсор, — пусть они сами просят об этом.
        calloutKinds.length > 1 && "border-2",
      )}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden className="font-mono text-xs">
        {date}
      </span>
      <span
        aria-hidden
        className={cn(
          "font-mono",
          // Два кода вместо одного набираются мельче и теснее: иначе
          // «СОР РЕЗ» распирает клетку и ломает сетку месяца.
          calloutKinds.length > 1 ? "text-[8px] tracking-tighter" : "text-[9px]",
        )}
      >
        {calloutKinds.length > 0
          ? calloutMarks(calloutKinds)
          : records.length === 0
            ? "В"
            : shift?.absenceKind
              ? ABSENCE_MARK[shift.absenceKind]
              : hours(workedHours).replace(",00", "")}
      </span>
    </div>
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
function LegendGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="font-display text-[11px] font-bold uppercase tracking-wide text-ink-muted">
        {title}
      </p>
      <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">{children}</dl>
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
}: {
  className: string;
  label: string;
  mark?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <dt
        aria-hidden
        className={cn(
          // Ширина по содержимому, а не квадрат: «ДО» и «ОСВ» в
          // шестнадцати пикселях сминаются в кашу.
          "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-xs border px-1",
          "font-mono text-[9px] leading-none",
          className,
        )}
      >
        {mark}
      </dt>
      <dd className="text-ink-muted">{label}</dd>
    </div>
  );
}
