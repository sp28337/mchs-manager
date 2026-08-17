"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

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
 * --- Почему числа держатся на месте --------------------------------------
 *
 * Они нужны при каждой правке в календаре: человек отмечает день в
 * декабре и тут же смотрит, что стало с нормой. Пока они были первым
 * экраном страницы, до них приходилось прокручивать назад через
 * двенадцать сеток — именно в тот момент, когда важна точность.
 *
 * Поэтому это полоса, закреплённая под шапкой. В саму шапку числа тоже
 * пробовали переселить, но там они вытесняли название сайта и на узком
 * экране ломали строку надвое; своя полоса обходится одной строкой и
 * ничего у шапки не отнимает.
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
 * Итог периода: закреплённая полоса под шапкой.
 *
 * Полоса обязана быть тонкой — она отнимает высоту у календаря, — поэтому
 * внутри всё в одну-две строки: числа и подписанная строка мелких итогов.
 */
export function PeriodSummary({
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
  // Широкий экран показывает всё сразу; на узком остаются три главных
  // числа, остальное открывается кнопкой — полоса не вправе съедать
  // четверть телефонного экрана. Порог в JS, а не классами: иначе те же
  // числа пришлось бы вывести в разметку дважды, и программа чтения
  // объявила бы каждое по два раза.
  const wide = useMediaQuery("(min-width: 560px)");
  const [open, setOpen] = useState(false);
  const showAll = wide || open;

  return (
    <>
      {/* Щиток над полосой. Шапка залита бумагой только на верхнюю
          половину, ниже она уходит в прозрачность, — и содержимое
          страницы просвечивало сквозь неё полоской между шапкой и этой
          панелью. Псевдоэлемент закрывает ровно эту половину: на своём
          месте, до прокрутки, он приходится на пустое поле под шапкой и
          не виден.

          `relative` тут ставить нельзя: это то же свойство `position`, и
          оно отменило бы `sticky`. Липкий элемент и так задаёт систему
          координат для `absolute` внутри себя. */}
        {/* <PeriodExtras
          calculation={calculation}
          payTotal={payTotal}
          periodLabel={periodLabel}
          wide={wide}
        /> */}
      <div
        className={cn(
          "sticky top-24 z-40 -mx-6 -translate-y-8",
          "",
        )}
      >
        <div className="flex items-end gap-x-6 gap-y-3 bg-paper px-6 pb-3">
          <PeriodFigures
            calculation={calculation}
            payTotal={payTotal}
            periodLabel={periodLabel}
            showAll={showAll}
          />

          {/* Кнопка появляется только там, где что-то спрятано. На широком
              экране прятать нечего, и кнопка, ничего не открывающая, была
              бы обманом. */}
        </div>
      </div>

      <PendingNotice accountingYear={accountingYear} />
    </>
  );
}

/**
 * Числа: даты периода и главные величины.
 *
 * На узком экране остаются три числа — норма, факт, переработка. Сутки,
 * деньги и сами даты уходят в строку мелких итогов под ними: полоса
 * обязана оставаться тонкой, а прятать их за кнопку значило бы требовать
 * нажатия там, где хватает взгляда строкой ниже.
 *
 * --- Почему числа стоят плашкой ------------------------------------------
 *
 * Голым рядом они висели в воздухе: пять величин подряд, ничем не
 * ограниченных, читались как случайно оказавшиеся рядом. Плашка отвечает
 * на «где кончается итог и начинается страница», а разделители — на «где
 * кончается одно число и начинается другое».
 *
 * Оформление взято у кнопок рабочего экрана — та же рамка, та же подложка,
 * то же скругление. Не для красоты: итог и кнопки стоят на одной странице
 * в двух строках друг под другом, и два разных вида плашки на таком
 * расстоянии читались бы как две разные системы.
 */
function PeriodFigures({
  calculation,
  payTotal,
  periodLabel,
  showAll,
}: {
  calculation: PeriodCalculation;
  /** Деньги за переработку, если человек указал оклад. */
  payTotal?: Decimal | null;
  /** Даты периода словами: в споре важно, за какие именно числа расчёт. */
  periodLabel: string;
  /** Показывать ли всё, а не только три главных числа. */
  showAll: boolean;
}) {
  const overtime = calculation.overtimeHours.greaterThan(0);
  const undertime = calculation.undertimeHours.greaterThan(0);
  const excluded = calculation.excludedHours.greaterThan(0);

  return (
    <dl
      className={cn(
        "flex min-w-0 max-w-full flex-wrap items-stretch overflow-hidden",
        "divide-x divide-rule rounded-xl border border-rule-strong bg-paper-raised",
      )}
    >
        <Figure
          value={hours(calculation.normHours)}
          unit="ч"
          caption="Норма"
          emphatic
        />
        <Figure value={hours(calculation.actualHours)} unit="ч" caption="Фактически" />
        <Figure
          value={hours(calculation.overtimeHours)}
          unit="ч"
          caption="Переработка"
          tone={overtime ? "verify" : undefined}
          // Довод про неуменьшенную норму — у того числа, которое от неё
          // зависит. Он стоял отдельной карточкой во весь абзац, и её
          // читают один раз, а место она занимала всегда.
        />
        {undertime ? (
          <Figure
            value={hours(calculation.undertimeHours)}
            unit="ч"
            caption="Недоработка"
            tone="signal"
          />
        ) : null}

        {showAll && overtime ? (
          // «≈» стоит в той же ячейке, что и число: это знак при нём, а не
          // шестая величина, и отдельной клеткой он читался бы как заголовок
          // пустого столбца.
          <div className="flex items-center gap-x-3 px-4 py-2">
            <span aria-hidden className="text-xl text-ink-faint sm:text-2xl">
              ≈
            </span>
            <Figure
              bare
              value={`${days(calculation.overtimeHours)}`}
              unit="суток"
              caption="В сутках"
              tone="verify"
            />
          </div>
        ) : null}
        {showAll && overtime && payTotal ? (
          <Figure
            value={formatMoneyAmount(payTotal)}
            unit="₽"
            caption="Выплата (до НДФЛ)"
            tone="verify"
          />
        ) : null}
    </dl>
  );
}

/**
 * Мелкие итоги — второй строкой полосы.
 *
 * Одной строкой, как подпись месяца в календаре: пять подписанных
 * столбиков занимали две строки там, где хватает одной. На узком экране
 * сюда же приходят даты периода, сутки и деньги — всё, что не влезло в
 * первую строку.
 */
// function PeriodExtras({
//   calculation,
//   payTotal,
//   periodLabel,
//   wide,
// }: {
//   calculation: PeriodCalculation;
//   payTotal?: Decimal | null;
//   periodLabel: string;
//   /** На широком экране даты и деньги уже стоят числами выше. */
//   wide: boolean;
// }) {
//   const overtime = calculation.overtimeHours.greaterThan(0);

//   return (
//       <p className="flex flex-wrap items-center gap-x-1.5 -translate-y-7.5 gap-y-1 text-xs text-ink-muted">
//         {/* {!wide && overtime ? (
//           <Stat value={`≈ ${days(calculation.overtimeHours)}`} label="в сутках" />
//         ) : null}
//         {!wide && overtime && payTotal ? (
//           <Stat value={`${formatMoneyAmount(payTotal)} ₽`} label="выплата до НДФЛ" />
//         ) : null} */}
//         <Stat value={String(calculation.scheduledShifts)} label="смен по графику" />
//         <Stat value={String(calculation.workedShifts)} label="отработано" />
//         <Stat value={String(calculation.absentShifts)} label="пропущено" />
//         <Stat value={`${hours(calculation.nightHours)} ч`} label="ночных" />
//         <Stat value={`${hours(calculation.holidayHours)} ч`} label="праздничных" last />
//         <Hint label="Про ночные и праздничные часы">
//           <FactOnlyNote />
//         </Hint>
//       </p>
//   );
// }

/**
 * Названная цена непроставленного переноса.
 *
 * Единственное, что осталось карточкой в потоке страницы: это не
 * пояснение, а недоделанное дело, и оно требует действия в календаре
 * ниже. В полосе ему не место — полоса это числа.
 */
function PendingNotice({ accountingYear }: { accountingYear: number }) {
  const pending = pendingTransfers(accountingYear).length;
  if (pending === 0) return null;

  return (
    // Не «календарь не опубликован» — эта формулировка досталась от
    // серверной версии и человеку ничего не говорила. Названа конкретная
    // недостача и её цена в часах.
    <p className="mt-6 max-w-prose rounded-xl bg-signal-soft px-4 py-3 text-sm">
      Норма может быть завышена на {pending * 8} часов: переносы новогодних
      выходных на {accountingYear} год ещё не проставлены. Откройте календарь
      года ниже и отметьте их по своему производственному календарю.
    </p>
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
  bare,
}: {
  value: string;
  unit: string;
  caption: string;
  emphatic?: boolean;
  tone?: "signal" | "verify";
  hint?: ReactNode;
  /** Без своего поля: величина стоит внутри чужой ячейки плашки. */
  bare?: boolean;
}) {
  return (
    <div className={cn("min-w-0", bare ? "" : "px-4 py-2")}>
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
