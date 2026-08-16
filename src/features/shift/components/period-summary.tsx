import type { ReactNode } from "react";

import { Hint } from "@/components/ui/hint";
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
}: {
  calculation: PeriodCalculation;
  accountingYear: number;
  /** Деньги за переработку, если человек указал оклад. Разбор суммы — в
   *  отдельном разделе; здесь она стоит рядом с часами, потому что это
   *  тот же факт, названный второй раз. */
  payTotal?: Decimal | null;
}) {
  const excluded = calculation.excludedHours.greaterThan(0);
  const overtime = calculation.overtimeHours.greaterThan(0);
  const pending = pendingTransfers(accountingYear).length;

  // Переработка, которая получилась бы при НЕуменьшенной норме. Считается
  // от базовой нормы напрямую, а не вычитанием исключённых часов из
  // настоящей переработки: норма к отработке не уходит в минус, и при
  // длинном отсутствии разность дала бы неверное число.
  const wrongOvertime = atLeastZero(
    calculation.actualHours.minus(calculation.baseNormHours),
  );

  return (
    <div className="space-y-5">
      {pending > 0 ? (
        // Не «календарь не опубликован» — эта формулировка досталась от
        // серверной версии и человеку ничего не говорила. Названа
        // конкретная недостача и её цена в часах.
        //
        // Ни рамки, ни цветной полоски слева: заметность даёт сама
        // подложка другого тона, а полоска у края — украшение, доставшееся
        // от чужих библиотек.
        <p className="max-w-prose rounded-xl bg-signal-soft px-4 py-3 text-sm">
          Норма может быть завышена на {pending * 8} часов: переносы новогодних
          выходных на {accountingYear} год ещё не проставлены. Откройте
          календарь года ниже и отметьте их по своему производственному
          календарю.
        </p>
      ) : null}

      {/* Сетка, а не строка: блок стоит в колонке шириной в двадцать
          четыре рема, и числа в ней обязаны вставать друг под друга
          ровно. Связок «≈» и «или» между ними больше нет — приблизительность
          ушла внутрь самого числа, а «или» ничего не добавляло к подписи
          «Выплата». */}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 xl:grid-cols-2">
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
        />
        {overtime ? (
          <Figure
            value={`≈ ${days(calculation.overtimeHours)}`}
            unit="суток"
            caption="В сутках"
            tone="verify"
          />
        ) : null}
        {overtime && payTotal ? (
          <Figure
            value={formatMoneyAmount(payTotal)}
            unit="₽"
            caption="Выплата (до НДФЛ)"
            tone="verify"
          />
        ) : null}
        {calculation.undertimeHours.greaterThan(0) ? (
          <Figure
            value={hours(calculation.undertimeHours)}
            unit="ч"
            caption="Недоработка"
            tone="signal"
          />
        ) : null}
      </dl>

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

      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3 xl:grid-cols-2">
        <Small label="Смен по графику" value={String(calculation.scheduledShifts)} />
        <Small label="Отработано смен" value={String(calculation.workedShifts)} />
        <Small label="Пропущено по уважительной причине" value={String(calculation.absentShifts)} />
        {/* Знак вопроса стоит у обоих чисел, а не абзацем под строкой:
            оговорка у каждого из них своя причина посмотреть, и человек,
            глядящий на ночные, не обязан догадываться, что примечание
            внизу — про них тоже. */}
        <Small
          label="Ночные часы"
          value={`${hours(calculation.nightHours)} ч`}
          hint={<FactOnlyNote />}
        />
        <Small
          label="Праздничные часы"
          value={`${hours(calculation.holidayHours)} ч`}
          hint={<FactOnlyNote />}
        />
      </dl>
    </div>
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
          emphatic ? "text-3xl" : "text-2xl",
          tone === "signal" && "text-signal",
          tone === "verify" && "text-verify  font-medium",
        )}
      >
        {value}
        <span className="ml-1 text-base text-ink-muted">{unit}</span>
      </dd>
      <dt className="text-xs text-ink-muted">{caption}</dt>
    </div>
  );
}

function Small({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-xs text-ink-muted">
        {label}
        {hint ? <Hint label={`Про «${label.toLowerCase()}»`}>{hint}</Hint> : null}
      </dt>
      <dd className="whitespace-nowrap font-mono">{value}</dd>
    </div>
  );
}
