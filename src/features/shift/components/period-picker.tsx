"use client";

import { useId } from "react";

import { Hint } from "@/components/ui/hint";
import { Select } from "@/components/ui/select";

import type { AccountingPeriodKind } from "../domain/value-objects";
import { MONTH_NAMES } from "./month-names";

/**
 * Выбор периода: учётный период и месяц внутри него.
 *
 * --- Почему это два разных вопроса, а не один список ---------------------
 *
 * Переработка определяется по итогу учётного периода (ст. 104 ТК РФ), и
 * это то число, ради которого человек пришёл. Месяц ему нужен для
 * другого: найти, в каком именно месяце разошлось с табелем. Одним
 * списком «год / 1-е полугодие / … / январь / февраль …» эти два вопроса
 * слились бы в один, и месяц встал бы в один ряд с периодами, которыми он
 * не является.
 *
 * Поэтому месяц — уточнение к периоду, а не его замена, и в списке
 * месяцев стоят только те, что в выбранный период входят. Показать здесь
 * март при выбранном втором полугодии значило бы дать выбрать положение,
 * в котором верхний список говорит одно, а числа на экране — другое.
 *
 * --- Почему «весь период» первым пунктом ---------------------------------
 *
 * Это состояние по умолчанию и то, ради чего сюда пришли. Пункт назван
 * словами, а не оставлен пустым: пустая строка в списке читается как
 * «ничего не выбрано», а выбрано как раз главное.
 *
 * --- Почему выбор помесячно не сбрасывает период -------------------------
 *
 * Раньше месяц и период были одной кнопочной группой, и нажатие на месяц
 * гасило выбранный период. Вернуться к нему можно было только вспомнив,
 * какой он был. Здесь период остаётся выбранным, а месяц — отдельным
 * уточнением поверх него.
 */

export interface StatutoryChoice {
  kind: AccountingPeriodKind;
  index: number;
}

/** Сколько месяцев в периоде такого вида. */
export function monthsIn(kind: AccountingPeriodKind): number {
  return kind === "quarter" ? 3 : kind === "half_year" ? 6 : 12;
}

function labelFor(kind: AccountingPeriodKind, index: number, year: number): string {
  if (kind === "year") return `${year} год`;
  return `${index + 1}-${kind === "quarter" ? "й квартал" : "е полугодие"}`;
}

export function PeriodPicker({
  accountingYear,
  employmentKind,
  periods,
  statutory,
  month,
  onStatutory,
  onMonth,
}: {
  accountingYear: number;
  employmentKind: "attested" | "civilian";
  periods: readonly AccountingPeriodKind[];
  statutory: StatutoryChoice;
  /** Месяц внутри периода или `null` — «весь период». */
  month: number | null;
  onStatutory: (choice: StatutoryChoice) => void;
  onMonth: (month: number | null) => void;
}) {
  const periodId = useId();
  const monthId = useId();

  const span = monthsIn(statutory.kind);
  const firstMonth = statutory.index * span;
  const monthsAvailable = Array.from({ length: span }, (_, offset) => firstMonth + offset);

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={periodId}
            className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted"
          >
            Учётный период
          </label>
          <Hint label="За что отвечает учётный период">
            {employmentKind === "attested"
              ? "Приказ МЧС России от 24.04.2026 № 308 п. 2: учётный период сотрудника при сменной работе — полугодие или год. Переработка определяется по его итогу."
              : "Приказ МЧС России от 24.04.2026 № 307 п. 7: учётный период работника при сменной работе — три месяца, полугодие или год. Какой именно — устанавливают правила внутреннего трудового распорядка."}
          </Hint>
        </div>
        <Select
          id={periodId}
          value={`${statutory.kind}:${statutory.index}`}
          onChange={(event) => {
            const [kind, index] = event.target.value.split(":");
            onStatutory({
              kind: kind as AccountingPeriodKind,
              index: Number(index),
            });
          }}
        >
          {periods.flatMap((kind) => {
            const count = 12 / monthsIn(kind);
            return Array.from({ length: count }, (_, index) => (
              <option key={`${kind}-${index}`} value={`${kind}:${index}`}>
                {labelFor(kind, index, accountingYear)}
              </option>
            ));
          })}
        </Select>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={monthId}
            className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted"
          >
            Помесячно
          </label>
          <Hint label="Зачем нужен выбор месяца">
            Месяц учётным периодом не является — переработку по нему не
            считают. Он нужен, чтобы найти, в каком именно месяце разошлось.
          </Hint>
        </div>
        <Select
          id={monthId}
          value={month === null ? "all" : String(month)}
          onChange={(event) => {
            const raw = event.target.value;
            onMonth(raw === "all" ? null : Number(raw));
          }}
        >
          <option value="all">Весь период</option>
          {monthsAvailable.map((index) => (
            <option key={index} value={index}>
              {MONTH_NAMES[index]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
