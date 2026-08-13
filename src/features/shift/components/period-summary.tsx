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
        <p className="rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
          Норма может быть завышена на {pending * 8} часов: переносы новогодних
          выходных на {accountingYear} год ещё не проставлены. Откройте
          календарь года ниже и отметьте их по своему производственному
          календарю.
        </p>
      ) : null}

      <dl className="flex flex-wrap gap-x-10 gap-y-5">
        <Figure
          value={hours(calculation.normHours)}
          unit="ч"
          caption="Норма к отработке"
          emphatic
        />
        <Figure value={hours(calculation.actualHours)} unit="ч" caption="Отработано" />
        <div className="flex gap-6 flex-wrap">
          <Figure
            value={hours(calculation.overtimeHours)}
            unit="ч"
            caption="Переработка"
            tone={overtime ? "verify" : undefined}
          />
          {overtime ? (
            <>
              <div className="flex items-center text-2xl">
                ≈ 
              </div>
              {/* <span className="font-mono text-2xl text-verify">
                {days(calculation.overtimeHours)} суток
              </span> */}
              <Figure
                value={days(calculation.overtimeHours)}
                unit="суток"
                caption="В сутках"
                tone={overtime ? "verify" : undefined}
              />
              {payTotal ? (
                <div className="flex gap-6">
                  <span className="flex items-center font-semibold">
                    или
                  </span>
                  <Figure
                    value={formatMoneyAmount(payTotal)}
                    unit="₽"
                    caption="Выплата (до НДФЛ)"
                    tone="verify"
                  />
                </div>
              ) : null}
            </>
          ) : null}
          {calculation.undertimeHours.greaterThan(0) ? (
            <Figure
              value={hours(calculation.undertimeHours)}
              unit="ч"
              caption="Недоработка"
              tone="signal"
            />
          ) : null}
        </div>
      </dl>

      <div className="space-y-2 rounded-xl border border-rule bg-paper-raised p-4">
        <h3 className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
          Откуда взялась норма
        </h3>
        <p className="max-w-prose text-sm">
          {calculation.calendar.workingDays} рабочих дней по производственному
          календарю × {hours(calculation.weeklyNorm.hours)} ч ÷ 5
          {calculation.calendar.preHolidayDays > 0
            ? ` − ${calculation.calendar.preHolidayDays} ч за предпраздничные дни (ст. 95 ТК РФ)`
            : ""}{" "}
          = <span className="font-mono">{hours(calculation.baseNormHours)}</span> ч.
        </p>
        <p className="text-xs text-ink-muted">
          Недельная норма: {calculation.weeklyNorm.basis}. Норма периода —
          ст. 104 ТК РФ.
        </p>

        {excluded ? (
          <p className="max-w-prose border-t border-rule pt-2 text-sm">
            Из неё исключено{" "}
            <span className="font-mono">{hours(calculation.excludedHours)}</span> ч —
            это {calculation.absentShifts} смен(ы) по графику, пришедшиеся на
            отсутствие с сохранением места службы. Остаётся{" "}
            <span className="font-mono">{hours(calculation.normHours)}</span> ч.
            <span className="mt-1 block text-xs text-ink-muted">
              Основание: письмо Роструда от 01.03.2010 № 550-6-1.
            </span>
          </p>
        ) : null}
      </div>

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
        <p className="max-w-prose rounded-r-xl rounded-l-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
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

      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <Small label="Смен по графику" value={String(calculation.scheduledShifts)} />
        <Small label="Отработано смен" value={String(calculation.workedShifts)} />
        <Small label="Пропущено по уважительной причине" value={String(calculation.absentShifts)} />
        <Small label="Ночные часы" value={`${hours(calculation.nightHours)} ч`} />
        <Small label="Праздничные часы" value={`${hours(calculation.holidayHours)} ч`} />
      </dl>

      {calculation.holidayHours.greaterThan(0) || calculation.nightHours.greaterThan(0) ? (
        <p className="max-w-prose text-xs text-ink-muted">
          Ночные и праздничные часы показаны как факт. При суммированном учёте
          в пределах нормы они дополнительным временем отдыха не компенсируются
          (Приказ МЧС России от 24.09.2018 № 410, п. 14) — обещать здесь
          доплату было бы неправдой.
        </p>
      ) : null}
    </div>
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
      <dd
        className={cn(
          "font-mono leading-none",
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

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
