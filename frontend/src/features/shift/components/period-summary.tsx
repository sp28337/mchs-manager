import { cn } from "@/lib/utils/cn";

import { hours, type Calculation } from "../schemas";

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
export function PeriodSummary({ calculation }: { calculation: Calculation }) {
  const excluded = Number(calculation.excludedHours) > 0;
  const overtime = Number(calculation.overtimeHours) > 0;

  return (
    <div className="space-y-5">
      {!calculation.calendarPublished ? (
        <p className="rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
          Производственный календарь этого года ещё не опубликован. Норма
          посчитана по тому, что в нём есть, и может измениться — прежде чем
          нести расчёт начальнику, проверьте, что праздники и переносы
          размечены.
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
        <Figure
          value={hours(calculation.overtimeHours)}
          unit="ч"
          caption="Переработка"
          tone={overtime ? "verify" : undefined}
        />
        {Number(calculation.undertimeHours) > 0 ? (
          <Figure
            value={hours(calculation.undertimeHours)}
            unit="ч"
            caption="Недоработка"
            tone="signal"
          />
        ) : null}
      </dl>

      <div className="space-y-2 rounded-sm border border-rule bg-paper-raised p-4">
        <h3 className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
          Откуда взялась норма
        </h3>
        <p className="max-w-prose text-sm">
          {calculation.workingDays} рабочих дней по производственному календарю ×{" "}
          {hours(calculation.weeklyNormHours)} ч ÷ 5
          {calculation.preHolidayDays > 0
            ? ` − ${calculation.preHolidayDays} ч за предпраздничные дни (ст. 95 ТК РФ)`
            : ""}{" "}
          = <span className="font-mono">{hours(calculation.baseNormHours)}</span> ч.
        </p>
        <p className="text-xs text-ink-muted">
          Недельная норма: {calculation.weeklyNormBasis}. Норма периода —
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
        <p className="max-w-prose rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
          Если в вашем табеле норму НЕ уменьшили на эти часы, у вас покажется
          недоработка{" "}
          <span className="font-mono">
            {hours(calculation.wrongNormUndertimeHours)}
          </span>{" "}
          ч, которой на самом деле нет.
        </p>
      ) : null}

      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <Small label="Смен по графику" value={String(calculation.scheduledShifts)} />
        <Small label="Отработано смен" value={String(calculation.workedShifts)} />
        <Small label="Пропущено по уважительной причине" value={String(calculation.absentShifts)} />
        <Small label="Ночные часы" value={`${hours(calculation.nightHours)} ч`} />
        <Small label="Праздничные часы" value={`${hours(calculation.holidayHours)} ч`} />
      </dl>

      {Number(calculation.holidayHours) > 0 || Number(calculation.nightHours) > 0 ? (
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
          tone === "verify" && "text-verify",
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
