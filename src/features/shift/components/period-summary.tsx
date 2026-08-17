"use client";

import type { ReactNode } from "react";

import { Hint } from "@/components/ui/hint";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils/cn";

import {
  atLeastZero,
  formatHours as hours,
  formatDays as days,
  type Decimal,
} from "../domain/decimal";
import { formatMoneyAmount } from "../domain/overtime-pay";
import { pendingTransfers } from "../domain/production-calendar";
import type { PeriodCalculation } from "../domain/calculation";

/**
 * Итог периода.
 *
 * --- Почему три числа, а не одно ---------------------------------------
 *
 * Норма, исключённые часы и факт показаны раздельно, потому что спор
 * идёт именно об их соотношении. Свести всё к «переработка: 24 ч»
 * значило бы спрятать то самое место, где расходятся расчёты.
 *
 * --- Почему числа стоят в шапке ------------------------------------------
 *
 * Они нужны при каждой правке в календаре: человек отмечает день в
 * декабре и тут же смотрит, что стало с нормой. Сначала они были первым
 * экраном страницы, и до них приходилось прокручивать назад через
 * двенадцать сеток; потом — отдельной закреплённой полосой под шапкой, и
 * это стоило странице двух закреплённых строк вместо одной.
 *
 * Теперь они в самой шапке, на месте названия сайта. Название там было
 * единственным, что не нужно человеку НА рабочем экране: он уже пришёл
 * куда хотел, а вернуться домой можно по знаку слева.
 *
 * --- Куда делись статьи и приказы ----------------------------------------
 *
 * Под числами стояли два абзаца в рамке — вывод нормы со ссылками на
 * ст. 95 и 104 ТК РФ, письмо Роструда, приказ № 410 — и отдельная
 * карточка про неуменьшенную норму. Всё это правда и всё это нужно, но не
 * в тот момент, когда человек ищет глазами переработку.
 *
 * Обоснование ушло за знаки вопроса — туда же, куда на этой странице ушли
 * остальные пояснения. Оно не удалено и не смягчено: раскрывается у того
 * самого числа, к которому относится, и программе чтения экрана видно
 * всегда.
 */

/**
 * Числа для шапки: даты периода и главные величины.
 *
 * На узком экране остаются три числа — норма, факт, переработка. Сутки,
 * деньги и сами даты уходят строкой под шапку (`PeriodExtras`): в шапке
 * для них нет места, а прятать их за кнопку значило бы требовать нажатия
 * там, где хватает взгляда ниже.
 */
export function PeriodFigures({
  calculation,
  payTotal,
  periodLabel,
}: {
  calculation: PeriodCalculation;
  /** Деньги за переработку, если человек указал оклад. */
  payTotal?: Decimal | null;
  /** Даты периода словами: в споре важно, за какие именно числа расчёт. */
  periodLabel: string;
}) {
  const overtime = calculation.overtimeHours.greaterThan(0);
  const undertime = calculation.undertimeHours.greaterThan(0);
  const excluded = calculation.excludedHours.greaterThan(0);
  const wide = useMediaQuery("(min-width: 768px)");

  return (
    <div className="flex min-w-0 items-end gap-x-5 max-md:w-full">
      {wide ? (
        <div className="shrink-0 border-r border-rule pr-5">
          <p className="font-display text-[10px] font-bold uppercase tracking-wide text-ink-muted">
            Как должно быть за
          </p>
          <p className="flex items-center gap-1 whitespace-nowrap font-mono text-[11px]">
            {periodLabel}
            <NormHint calculation={calculation} />
          </p>
        </div>
      ) : null}

      <dl className="flex min-w-0 items-end gap-x-5">
        <Figure
          value={hours(calculation.normHours)}
          unit="ч"
          caption="Норма к отработке"
          emphatic
        />
        <Figure value={hours(calculation.actualHours)} unit="ч" caption="Отработано" />
        <Figure
          value={hours(calculation.overtimeHours)}
          unit="ч"
          caption="Переработка"
          tone={overtime ? "verify" : undefined}
          // Довод про неуменьшенную норму — у того числа, которое от неё
          // зависит. Он стоял отдельной карточкой во весь абзац, и её
          // читают один раз, а место она занимала всегда.
          hint={
            excluded ? (
              <Hint label="Если норму не уменьшили">
                <WrongNormNote calculation={calculation} />
              </Hint>
            ) : undefined
          }
        />
        {undertime ? (
          <Figure
            value={hours(calculation.undertimeHours)}
            unit="ч"
            caption="Недоработка"
            tone="signal"
          />
        ) : null}
        {wide && overtime ? (
          <Figure
            value={`≈ ${days(calculation.overtimeHours)}`}
            unit="суток"
            caption="В сутках"
            tone="verify"
          />
        ) : null}
        {wide && overtime && payTotal ? (
          <Figure
            value={formatMoneyAmount(payTotal)}
            unit="₽"
            caption="Выплата (до НДФЛ)"
            tone="verify"
          />
        ) : null}
      </dl>
    </div>
  );
}

/**
 * Мелкие итоги строкой под шапкой.
 *
 * Одной строкой, как подпись месяца в календаре: пять подписанных
 * столбиков занимали две строки там, где хватает одной. На узком экране
 * сюда же приходят даты периода, сутки и деньги — всё, что не влезло в
 * шапку.
 */
export function PeriodExtras({
  calculation,
  accountingYear,
  payTotal,
  periodLabel,
}: {
  calculation: PeriodCalculation;
  accountingYear: number;
  payTotal?: Decimal | null;
  periodLabel: string;
}) {
  const overtime = calculation.overtimeHours.greaterThan(0);
  const pending = pendingTransfers(accountingYear).length;
  const wide = useMediaQuery("(min-width: 768px)");

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-muted">
        {!wide ? (
          <span className="whitespace-nowrap">
            за <span className="font-mono text-ink">{periodLabel}</span>{" "}
            <NormHint calculation={calculation} /> /
          </span>
        ) : null}
        {!wide && overtime ? (
          <Stat value={`≈ ${days(calculation.overtimeHours)}`} label="в сутках" />
        ) : null}
        {!wide && overtime && payTotal ? (
          <Stat value={`${formatMoneyAmount(payTotal)} ₽`} label="выплата до НДФЛ" />
        ) : null}
        <Stat value={String(calculation.scheduledShifts)} label="смен по графику" />
        <Stat value={String(calculation.workedShifts)} label="отработано" />
        <Stat value={String(calculation.absentShifts)} label="пропущено" />
        <Stat value={`${hours(calculation.nightHours)} ч`} label="ночных" />
        <Stat value={`${hours(calculation.holidayHours)} ч`} label="праздничных" last />
        <Hint label="Про ночные и праздничные часы">
          <FactOnlyNote />
        </Hint>
      </p>

      {pending > 0 ? (
        // Не «календарь не опубликован» — эта формулировка досталась от
        // серверной версии и человеку ничего не говорила. Названа
        // конкретная недостача и её цена в часах.
        //
        // Единственное, что здесь осталось карточкой: это не пояснение, а
        // недоделанное дело, и оно требует действия в календаре ниже.
        <p className="max-w-prose rounded-xl bg-signal-soft px-4 py-3 text-sm">
          Норма может быть завышена на {pending * 8} часов: переносы новогодних
          выходных на {accountingYear} год ещё не проставлены. Откройте календарь
          года ниже и отметьте их по своему производственному календарю.
        </p>
      ) : null}
    </div>
  );
}

/** Знак вопроса с выводом нормы — у дат периода, где бы они ни стояли. */
function NormHint({ calculation }: { calculation: PeriodCalculation }) {
  return (
    <Hint label="Откуда взялась норма">
      <NormNote calculation={calculation} />
    </Hint>
  );
}

/**
 * Имя стоит ПЕРЕД числом, и это не вкусовщина: «91 смен по графику» —
 * ошибка согласования, а правильная форма зависит от последней цифры.
 * Порядок «смен по графику 91» верен при любом числе и не требует
 * склонять существительное в коде.
 */
function Stat({
  value,
  label,
  last,
}: {
  value: string;
  label: string;
  last?: boolean;
}) {
  return (
    <span className="whitespace-nowrap">
      {label} <span className="font-mono text-ink">{value}</span>
      {last ? "" : " /"}
    </span>
  );
}

/**
 * Откуда взялась норма — то, что стояло абзацами в рамке под числами.
 *
 * Живёт здесь, а не там, где показывается: текст обязан слово в слово
 * следовать за расчётом, и разойтись с ним ему нельзя.
 */
export function NormNote({ calculation }: { calculation: PeriodCalculation }) {
  return (
    <>
      <span className="block">
        {calculation.calendar.workingDays} рабочих дней по производственному
        календарю × {hours(calculation.weeklyNorm.hours)}&nbsp;ч ÷ 5
        {calculation.calendar.preHolidayDays > 0
          ? ` − ${calculation.calendar.preHolidayDays} ч за предпраздничные дни (ст. 95 ТК РФ)`
          : ""}{" "}
        = <span className="font-mono">{hours(calculation.baseNormHours)}</span>&nbsp;ч.
      </span>

      {calculation.excludedHours.greaterThan(0) ? (
        <span className="mt-2 block">
          Из неё исключено{" "}
          <span className="font-mono">{hours(calculation.excludedHours)}</span>&nbsp;ч
          — это {calculation.absentShifts} смен(ы) по графику, пришедшиеся на
          отсутствие с сохранением места службы. Остаётся{" "}
          <span className="font-mono">{hours(calculation.normHours)}</span>&nbsp;ч.
          Основание: письмо Роструда от 01.03.2010 № 550-6-1.
        </span>
      ) : null}

      <span className="mt-2 block text-ink-muted">
        Недельная норма: {calculation.weeklyNorm.basis}. Норма периода —
        ст. 104 ТК РФ.
      </span>
    </>
  );
}

/**
 * Цена чужой ошибки, названная числом. Без неё «считают неверно» — это
 * спор; с ней — довод.
 *
 * Последствие у ошибки ДВА, и какое наступит — зависит от того, перекрыл
 * ли факт неуменьшенную норму. Прежняя версия знала только про
 * недоработку и в самом частом случае — когда человек всё равно
 * переработал — печатала «недоработка 0,00 ч, которой нет». Число верное,
 * фраза бессмысленная, а настоящая потеря (заниженная переработка) при
 * этом не называлась вовсе.
 */
function WrongNormNote({ calculation }: { calculation: PeriodCalculation }) {
  // Переработка, которая получилась бы при НЕуменьшенной норме. Считается
  // от базовой нормы напрямую, а не вычитанием исключённых часов из
  // настоящей переработки: норма к отработке не уходит в минус, и при
  // длинном отсутствии разность дала бы неверное число.
  const wrongOvertime = atLeastZero(
    calculation.actualHours.minus(calculation.baseNormHours),
  );

  if (calculation.wrongNormUndertimeHours.greaterThan(0)) {
    return (
      <>
        Если в вашем табеле норму НЕ уменьшили на эти часы, у вас покажется
        недоработка{" "}
        <span className="font-mono">
          {hours(calculation.wrongNormUndertimeHours)}
        </span>{" "}
        ч, которой на самом деле нет.
      </>
    );
  }

  return (
    <>
      Если в вашем табеле норму НЕ уменьшили на эти часы, переработка выйдет на{" "}
      <span className="font-mono">
        {hours(calculation.overtimeHours.minus(wrongOvertime))}
      </span>{" "}
      ч меньше действительной: <span className="font-mono">{hours(wrongOvertime)}</span>{" "}
      ч вместо{" "}
      <span className="font-mono">{hours(calculation.overtimeHours)}</span> ч.
    </>
  );
}

/**
 * Почему ночные и праздничные часы здесь только названы.
 *
 * Обещать за них доплату было бы неправдой, и молчать об этом нельзя:
 * человек, увидевший 664 часа ночных, сам достроит вывод, которого закон
 * не даёт.
 */
function FactOnlyNote() {
  return (
    <>
      Показаны как факт. При суммированном учёте в пределах нормы ночные и
      праздничные часы дополнительным временем отдыха не компенсируются
      (Приказ МЧС России от 24.09.2018 № 410, п. 14) — обещать здесь доплату
      было бы неправдой.
    </>
  );
}

function Figure({
  value,
  unit,
  caption,
  emphatic,
  tone,
  hint,
}: {
  value: string;
  unit: string;
  caption: string;
  emphatic?: boolean;
  tone?: "signal" | "verify";
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      {/* Число и его единица не разрываются переносом: «1796,00» на одной
          строке и «ч» на следующей читается как другое число. */}
      <dd
        className={cn(
          "whitespace-nowrap font-mono leading-none",
          emphatic ? "text-xl sm:text-2xl" : "text-lg sm:text-xl",
          tone === "signal" && "text-signal",
          tone === "verify" && "text-verify font-medium",
        )}
      >
        {value}
        <span className="ml-1 text-xs text-ink-muted sm:text-sm">{unit}</span>
      </dd>
      <dt className="flex items-center gap-1 whitespace-nowrap text-[11px] leading-tight text-ink-muted">
        {caption}
        {hint}
      </dt>
    </div>
  );
}
