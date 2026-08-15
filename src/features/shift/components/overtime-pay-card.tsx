"use client";

import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { formatHours as hours } from "../domain/decimal";
import { formatMoney, type OvertimePay, type OvertimePayEstimate } from "../domain/overtime-pay";
import type { PeriodCalculation } from "../domain/calculation";
import type { StoredProfile } from "../storage/profile";

/**
 * Сколько денег стоит переработка.
 *
 * --- Почему разбор показан целиком, а не одна сумма ---------------------
 *
 * Человек идёт с этим числом к начальнику или в суд. Сумма без вывода —
 * это его слово против слова бухгалтерии; сумма с подстановкой чисел в
 * формулу приказа — довод, который проверяется на месте. Поэтому здесь
 * видно всё: ставка, откуда она взялась, порог, разбивка часов.
 *
 * --- Оговорки, без которых число вводит в заблуждение -------------------
 *
 * Они не мелким шрифтом внизу «на всякий случай», а рядом с суммой,
 * потому что каждая меняет ожидание:
 *
 * 1. Ставка считается от ДОЛЖНОСТНОГО ОКЛАДА, а не от денежного
 *    довольствия: надбавки за звание, выслугу и особые условия в неё не
 *    входят (п. 105 приказа № 539). Сумма выйдет меньше, чем человек
 *    ожидает, и не сказать об этом — значит получить обвинение в ошибке.
 * 2. Деньги положены, ЕСЛИ НЕ ДАЛИ ОТДЫХ, — и это противоположно тому,
 *    что было в отменённом приказе № 195. Подробнее ниже.
 * 3. Смены, попавшие на субботу и воскресенье ПО ГРАФИКУ, отдельной
 *    компенсации не дают (п. 104): у сменника такие смены каждый месяц,
 *    и без этой оговорки он ждал бы за них доплату.
 * 4. Это начислено, до НДФЛ.
 */
export function OvertimePayCard({
  profile,
  calculation,
  pay,
  onChange,
}: {
  profile: StoredProfile;
  calculation: PeriodCalculation;
  pay: OvertimePayEstimate | null;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
}) {
  const fieldId = useId();
  const attested = profile.employmentKind === "attested";

  return (
    <div className="space-y-4 rounded-xl border border-rule bg-paper/70 p-4">
      <div className="space-y-1.5">
        <Label htmlFor={fieldId}>
          {attested ? "Должностной оклад, ₽ в месяц" : "Зарплата в месяц, ₽"}
        </Label>
        <Input
          id={fieldId}
          inputMode="decimal"
          placeholder="—"
          className="w-40 font-mono"
          value={profile.monthlyPayBase}
          onChange={(event) => {
            const next = event.target.value;
            onChange((previous) => ({ ...previous, monthlyPayBase: next }));
          }}
        />
        <p className="max-w-prose text-xs text-ink-muted">
          {attested ? (
            <>
              Только должностной оклад — оклад по званию и надбавки в часовую
              ставку не входят (Приказ МЧС России от 27.06.2024 № 539, п. 105).
            </>
          ) : (
            <>
              Оклад вместе с компенсационными и стимулирующими выплатами:
              сверхурочная работа оплачивается исходя из заработной платы
              целиком (Приказ МЧС России от 14.12.2019 № 747, приложение 2
              п. 10; ч. 1 ст. 152 ТК РФ).
            </>
          )}
        </p>
      </div>

      {pay === null ? null : (
        <div className="space-y-4 border-t border-rule pt-4">
          <Derivation pay={pay.primary} calculation={calculation} attested={attested} />

          {pay.alternative ? (
            <p className="max-w-prose rounded-xl border border-trace/30 bg-trace-soft px-4 py-3 text-sm">
              Порог полуторного размера при суммированном учёте приказ № 747 не
              определяет, и практика расходится. Если исходить из того, что в
              полуторном размере оплачиваются только первые два часа за весь
              учётный период, а остальное в двойном, выйдет{" "}
              <span className="font-mono">{formatMoney(pay.alternative.total)}</span> —
              на{" "}
              <span className="font-mono">
                {formatMoney(pay.alternative.total.minus(pay.primary.total))}
              </span>{" "}
              больше. Требовать разумно с меньшей суммы, но знать про большую вы
              вправе.
            </p>
          ) : null}

          <ul className="max-w-prose space-y-1.5 text-xs text-ink-muted">
            <li>
              Сумма начислена до НДФЛ — на руки придёт меньше на величину
              налога.
            </li>
            {attested ? (
              <>
                {/* Самая важная строка на карточке. По отменённому приказу
                    № 195 деньги шли «по рапорту сотрудника», и человек,
                    рапорта не подавший, оставался ни с чем. Приказ № 539
                    развернул условие: компенсация выплачивается, ЕСЛИ отдых
                    не предоставлен. Рапорт теперь нужен тому, кто хочет
                    взять отдых ВМЕСТО денег. */}
                <li>
                  Компенсация выплачивается{" "}
                  <strong>если вам не предоставили дополнительное время
                  отдыха или дополнительные дни отпуска</strong> (п. 103
                  приказа № 539). Рапорт нужен для обратного — чтобы взять
                  отдых вместо денег; тогда эти часы не оплачиваются (п. 109),
                  а день отдыха за выходной или праздник оплате не подлежит
                  (п. 110).
                </li>
                <li>
                  Смены, попавшие на субботу и воскресенье{" "}
                  <strong>по графику сменности</strong>, отдельной денежной
                  компенсации не дают (п. 104) — они оплачены как обычное
                  служебное время и входят в часы выше.
                </li>
                <li>
                  Компенсация не выплачивается за службу в особых условиях —
                  при ликвидации ЧС, в зоне контртеррористической операции,
                  при военном или чрезвычайном положении (п. 111): там она
                  заменена отдельными выплатами.
                </li>
              </>
            ) : (
              <li>
                Коллективный договор или локальный акт могут установить размеры
                выше — расчёт даёт минимум (п. 10(1) приказа № 747). Порядок
                исчисления часовой ставки тоже задаёт локальный акт (п. 8),
                поэтому сверьтесь со своим.
              </li>
            )}
            <li>
              Ночные и праздничные часы сюда не входят: они оплачиваются
              отдельно и ежемесячно. Прибавить их к этой сумме значило бы
              посчитать одни и те же часы дважды.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/** Вывод суммы: та же арифметика, что в приказе, с подставленными числами. */
function Derivation({
  pay,
  calculation,
  attested,
}: {
  pay: OvertimePay;
  calculation: PeriodCalculation;
  attested: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <div className="text-2xl">
            ≈ 
          </div>
          <p className="font-mono text-3xl leading-none text-verify">
            {formatMoney(pay.total)}
          </p>
        </div>
        <p className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
          За {hours(calculation.overtimeHours)} ч переработки
        </p>
      </div>

      <dl className="space-y-1 text-sm">
        <Step
          label="Часовая ставка"
          formula={
            <>
              {formatMoney(pay.monthlyBase)} ÷ {hours(pay.averageMonthlyHours)} ч
            </>
          }
          value={`${formatMoney(pay.hourlyRate)}/ч`}
          note={`норма ${hours(pay.averageMonthlyHours.times(12))} ч за ${
            calculation.periodStart.slice(0, 4)
          } год ÷ 12 месяцев`}
        />

        {pay.atOneAndHalf.hours.greaterThan(0) ? (
          <Step
            label="В полуторном размере"
            formula={
              <>
                {hours(pay.atOneAndHalf.hours)} ч × 1,5 × {formatMoney(pay.hourlyRate)}
              </>
            }
            value={formatMoney(pay.atOneAndHalf.amount)}
          />
        ) : null}

        {pay.atDouble.hours.greaterThan(0) ? (
          <Step
            label="В двойном размере"
            formula={
              <>
                {hours(pay.atDouble.hours)} ч × 2 × {formatMoney(pay.hourlyRate)}
              </>
            }
            value={formatMoney(pay.atDouble.amount)}
          />
        ) : null}
      </dl>

      <p className="max-w-prose text-xs text-ink-muted">
        Полуторный размер — за часы, не превышающие в среднем двух часов на
        каждый рабочий день учётного периода: {calculation.calendar.workingDays}{" "}
        рабочих дней × 2 = <span className="font-mono">{hours(pay.thresholdHours)}</span>{" "}
        ч.{" "}
        {pay.atDouble.hours.isZero()
          ? "Ваша переработка в этот порог укладывается целиком."
          : "Часы сверх порога оплачиваются в двойном размере."}{" "}
        {attested ? (
          <>Основание: {pay.basis}.</>
        ) : (
          <>
            Приказ № 747 порога не устанавливает — он взят из п. 107 приказа МЧС
            России от 27.06.2024 № 539, применённого по аналогии. Размеры
            полуторного и двойного — {pay.basis}.
          </>
        )}
      </p>
    </div>
  );
}

function Step({
  label,
  formula,
  value,
  note,
}: {
  label: string;
  formula: React.ReactNode;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-rule pb-1">
      <dt className="space-x-2">
        <span>{label}</span>
        <span className="font-mono text-xs text-ink-muted">{formula}</span>
        {note ? <span className="block text-xs text-ink-faint">{note}</span> : null}
      </dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
