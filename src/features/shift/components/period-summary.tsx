import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Hint } from "@/components/ui/hint";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils/cn";

import { atLeastZero, formatHours as hours, formatDays as days, type Decimal } from "../domain/decimal";
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
 * Стрелка от базовой нормы к норме к отработке показана явно: это и есть
 * действие, которое работодатель часто не совершает.
 *
 * --- Куда делись статьи и приказы ----------------------------------------
 *
 * Под числами стояли два абзаца в рамке — вывод нормы со ссылками на
 * ст. 95 и 104 ТК РФ, письмо Роструда, приказ № 410. Всё это правда и
 * всё это нужно, но не в тот момент, когда человек ищет глазами
 * переработку: до неё приходилось прокручивать через полтора экрана
 * права.
 *
 * Обоснование ушло за знак вопроса — туда же, куда на этой странице ушли
 * остальные пояснения. Оно не удалено и не смягчено: раскрывается у того
 * самого числа, к которому относится, и программе чтения экрана видно
 * всегда.
 *
 * --- Что осталось на виду -------------------------------------------------
 *
 * Числа и ОДИН вывод: во что обойдётся неуменьшенная норма. Это не
 * справка, а довод в споре, и прятать его за знаком вопроса значило бы
 * спрятать то, ради чего страницу открыли.
 */
export function PeriodSummary({
  calculation,
  accountingYear,
  payTotal,
  periodLabel,
  hint,
}: {
  calculation: PeriodCalculation;
  accountingYear: number;
  /** Деньги за переработку, если человек указал оклад. Разбор суммы — в
   *  отдельном окне; здесь она стоит рядом с часами, потому что это тот
   *  же факт, названный второй раз. */
  payTotal?: Decimal | null;
  /** Даты периода словами: в споре важно, за какие именно числа расчёт. */
  periodLabel: string;
  /** Знак вопроса с выводом нормы. */
  hint?: ReactNode;
}) {
  const excluded = calculation.excludedHours.greaterThan(0);
  const overtime = calculation.overtimeHours.greaterThan(0);
  const undertime = calculation.undertimeHours.greaterThan(0);
  const pending = pendingTransfers(accountingYear).length;

  // Широкий экран показывает всё сразу; на узком остаются три главных
  // числа, остальное открывается кнопкой. Порог в JS, а не классами:
  // иначе те же числа пришлось бы вывести в разметку дважды, и программа
  // чтения объявила бы каждое по два раза.
  const wide = useMediaQuery("(min-width: 1024px)");
  const [open, setOpen] = useState(false);
  const showAll = wide || open;

  // Переработка, которая получилась бы при НЕуменьшенной норме. Считается
  // от базовой нормы напрямую, а не вычитанием исключённых часов из
  // настоящей переработки: норма к отработке не уходит в минус, и при
  // длинном отсутствии разность дала бы неверное число.
  const wrongOvertime = atLeastZero(
    calculation.actualHours.minus(calculation.baseNormHours),
  );

  return (
    <>
      {/* Полоса стоит на месте, как шапка над ней. Числа нужны при каждой
          правке в календаре: человек отмечает день в декабре и тут же
          смотрит, что стало с нормой. Пока они были первым экраном, до
          них приходилось прокручивать назад через двенадцать сеток —
          именно в тот момент, когда важна точность. */}
      {/* Щиток над полосой. Шапка залита бумагой только на верхнюю
          половину, ниже она уходит в прозрачность, — и содержимое
          страницы просвечивало сквозь неё полоской между шапкой и этой
          панелью. Псевдоэлемент закрывает ровно эту половину: на своём
          месте, до прокрутки, он приходится на пустое поле под шапкой и
          не виден. */}
      <div
        className={cn(
          // `relative` тут ставить нельзя: это то же свойство `position`,
          // и оно отменило бы `sticky`. Липкий элемент и так задаёт
          // систему координат для `absolute` внутри себя.
          "sticky top-24 z-40 -mx-6 border-b border-rule bg-paper px-6 py-3",
          "before:absolute before:inset-x-0 before:bottom-full",
          "before:h-12 before:bg-paper before:content-['']",
        )}
      >
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="font-display text-[11px] font-bold uppercase tracking-wide text-ink-muted">
              Как должно быть за
            </p>
            <p className="flex items-center gap-1 whitespace-nowrap font-mono text-xs text-ink">
              {periodLabel}
              {hint}
            </p>
          </div>

          <dl className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <Figure
              value={hours(calculation.normHours)}
              unit="ч"
              caption="Норма к отработке"
              emphatic
            />
            <Figure
              value={hours(calculation.actualHours)}
              unit="ч"
              caption="Отработано"
            />
            <Figure
              value={hours(calculation.overtimeHours)}
              unit="ч"
              caption="Переработка"
              tone={overtime ? "verify" : undefined}
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
              <Figure
                value={`≈ ${days(calculation.overtimeHours)}`}
                unit="суток"
                caption="В сутках"
                tone="verify"
              />
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

          {/* Кнопка появляется только там, где что-то спрятано. На широком
              экране прятать нечего, и кнопка, ничего не открывающая, была
              бы обманом. */}
          {!wide ? (
            <button
              type="button"
              onClick={() => setOpen((previous) => !previous)}
              aria-expanded={open}
              className={cn(
                "ml-auto inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5",
                "rounded-xl border border-rule px-2.5 text-xs text-ink-muted",
                "transition-colors hover:bg-paper-sunken hover:text-ink",
                "focus-visible:outline-2 focus-visible:outline-offset-2",
                "focus-visible:outline-trace",
              )}
            >
              {open ? "Свернуть" : "Подробнее"}
              <ChevronDown
                aria-hidden
                className={cn("size-4 transition-transform", open && "rotate-180")}
              />
            </button>
          ) : null}
        </div>

        {/* Мелкие итоги — одной строкой, как подпись месяца в календаре:
            пять подписанных чисел столбиками занимали две строки полосы,
            которая обязана быть тонкой. */}
        {showAll ? (
          <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-rule pt-2 text-xs text-ink-muted">
            <Stat value={String(calculation.scheduledShifts)} label="смен по графику" />
            <Stat value={String(calculation.workedShifts)} label="отработано" />
            <Stat value={String(calculation.absentShifts)} label="пропущено" />
            <Stat value={`${hours(calculation.nightHours)} ч`} label="ночных" />
            <Stat value={`${hours(calculation.holidayHours)} ч`} label="праздничных" last />
            <Hint label="Про ночные и праздничные часы">
              <FactOnlyNote />
            </Hint>
          </p>
        ) : null}
      </div>

      <div className="space-y-5 pt-6">
        {pending > 0 ? (
          // Не «календарь не опубликован» — эта формулировка досталась от
          // серверной версии и человеку ничего не говорила. Названа
          // конкретная недостача и её цена в часах.
          //
          // Ни рамки, ни цветной полоски слева: заметность даёт сама
          // подложка другого тона, а полоска у края — украшение,
          // доставшееся от чужих библиотек.
          <p className="max-w-prose rounded-xl bg-signal-soft px-4 py-3 text-sm">
            Норма может быть завышена на {pending * 8} часов: переносы новогодних
            выходных на {accountingYear} год ещё не проставлены. Откройте
            календарь года ниже и отметьте их по своему производственному
            календарю.
          </p>
        ) : null}

        {excluded ? (
          // Цена чужой ошибки, названная числом. Без неё «считают неверно» —
          // это спор; с ней — довод.
          //
          // Последствие у ошибки ДВА, и какое наступит — зависит от того,
          // перекрыл ли факт неуменьшенную норму. Прежняя версия знала
          // только про недоработку и в самом частом случае — когда человек
          // всё равно переработал — печатала «недоработка 0,00 ч, которой
          // нет». Число верное, фраза бессмысленная, а настоящая потеря
          // (заниженная переработка) при этом не называлась вовсе.
          //
          // В полосу это не убрано намеренно: полоса — числа, а это довод,
          // и читают его один раз.
          <p className="max-w-prose rounded-xl bg-signal-soft px-4 py-3 text-sm">
            {calculation.wrongNormUndertimeHours.greaterThan(0) ? (
              <>
                Если в вашем табеле норму НЕ уменьшили на эти часы, у вас
                покажется недоработка{" "}
                <span className="font-mono">
                  {hours(calculation.wrongNormUndertimeHours)}
                </span>{" "}
                ч, которой на самом деле нет.
              </>
            ) : (
              <>
                Если в вашем табеле норму НЕ уменьшили на эти часы, переработка
                выйдет на{" "}
                <span className="font-mono">
                  {hours(calculation.overtimeHours.minus(wrongOvertime))}
                </span>{" "}
                ч меньше действительной:{" "}
                <span className="font-mono">{hours(wrongOvertime)}</span> ч вместо{" "}
                <span className="font-mono">{hours(calculation.overtimeHours)}</span> ч.
              </>
            )}
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * Число и его имя в строке мелких итогов.
 *
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
 * следовать за расчётом, и разойтись с ним ему нельзя. Показывается
 * знаком вопроса у заголовка периода — то есть у того самого числа, о
 * котором говорит.
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
}: {
  value: string;
  unit: string;
  caption: string;
  emphatic?: boolean;
  tone?: "signal" | "verify";
}) {
  return (
    <div className="space-y-0.5">
      {/* Число и его единица не разрываются переносом: «1796,00» на одной
          строке и «ч» на следующей читается как другое число. */}
      <dd
        className={cn(
          "whitespace-nowrap font-mono leading-none",
          emphatic ? "text-xl sm:text-2xl" : "text-lg sm:text-xl",
          tone === "signal" && "text-signal",
          tone === "verify" && "text-verify  font-medium",
        )}
      >
        {value}
        <span className="ml-1 text-xs text-ink-muted sm:text-sm">{unit}</span>
      </dd>
      <dt className="text-[11px] leading-tight text-ink-muted">{caption}</dt>
    </div>
  );
}

