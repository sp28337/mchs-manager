"use client";

import { CalendarRange } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";

import { todayIso, year as yearOf } from "../domain/plain-date";
import type { AccountingPeriodKind } from "../domain/value-objects";
import { ACCOUNTING_PERIODS } from "../domain/value-objects";
import { MONTH_NAMES } from "./month-names";

/**
 * Выбор периода — кнопкой и окном с тремя списками.
 *
 * --- Три вопроса, а не девятнадцать ответов -------------------------------
 *
 * Отрезков и правда девятнадцать: год, два полугодия, четыре квартала и
 * двенадцать месяцев. Разложенные плитками, все сразу, они и выглядели как
 * девятнадцать: окно на три экрана прокрутки, по которому нужно искать
 * глазами, где стоишь.
 *
 * Но вопросов здесь три, и они разной природы: КАКОЙ ГОД, КАКАЯ ЕГО ЧАСТЬ
 * и НЕ СУЗИТЬ ЛИ ДО МЕСЯЦА. Три списка отвечают ровно на них: каждый
 * показывает свой выбор строкой, не разворачиваясь, и окно умещается в
 * ладонь. Плитки хороши, когда вариантов немного и они равноправны;
 * здесь ни того, ни другого.
 *
 * --- Почему именно в таком порядке ----------------------------------------
 *
 * Учётный период первым: это главный вопрос экрана — именно по его итогу
 * определяется переработка (ч. 3 ст. 104 ТК РФ). Год вторым: он объемлет
 * период, но меняют его реже. Месяц последним, потому что он не про
 * учёт, а про «посмотреть поближе».
 *
 * --- Почему месяц и период — один выбор -----------------------------------
 *
 * Это два ответа на один вопрос «что показать», и держать оба значило бы
 * показывать одно, а считать другое. Поэтому у месяца есть пункт «Весь
 * период»: выбрать его — то же самое, что снять месяц, и человеку не
 * нужно догадываться, как вернуться к кварталу.
 *
 * --- Почему без кнопки «Применить» ----------------------------------------
 *
 * По той же причине, что и везде в приложении: выбор применяется сразу,
 * и его видно за окном. «Готово» внизу только закрывает окно — на телефоне
 * иначе пришлось бы целиться в крестик.
 *
 * --- Что показывает сама кнопка -------------------------------------------
 *
 * Выбранный отрезок словами: «2026 год», «2-е полугодие», «Август». Не
 * «Период» и не даты — человек нажимает её, чтобы СМЕНИТЬ отрезок, и ему
 * нужно знать, на каком он стоит сейчас. Даты стоят в полосе с числами.
 */

export interface StatutoryChoice {
  kind: AccountingPeriodKind;
  index: number;
}

/**
 * Порядок отрезков — от широкого к узкому: год, полугодия, кварталы.
 *
 * Первым стоит год: это самый частый учётный период и умолчание экрана.
 * Дальше сужение — список читается как «насколько мелко смотрим».
 */
const PERIOD_ORDER: readonly AccountingPeriodKind[] = [...ACCOUNTING_PERIODS].reverse();

/** Сколько месяцев в периоде такого вида. */
export function monthsIn(kind: AccountingPeriodKind): number {
  return kind === "quarter" ? 3 : kind === "half_year" ? 6 : 12;
}

/** Подпись отрезка: так, как его называют вслух. */
export function partLabel(
  kind: AccountingPeriodKind,
  index: number,
  year: number,
): string {
  if (kind === "year") return `${year} год`;
  return `${index + 1}-${kind === "quarter" ? "й квартал" : "е полугодие"}`;
}

/**
 * Подпись отрезка ВНУТРИ окна — без года.
 *
 * Снаружи, на кнопке, год нужен: она отвечает на вопрос «что я сейчас
 * вижу», и «Год» без числа на него не отвечает. Внутри окна год стоит
 * своим списком строкой ниже, поэтому «2026 год» рядом с выбранным
 * 2026-м — это одно и то же число дважды, и второй раз оно читается как
 * ещё один выбор.
 */
function partChoiceLabel(kind: AccountingPeriodKind, index: number): string {
  if (kind === "year") return "Весь год";
  return `${index + 1}-${kind === "quarter" ? "й квартал" : "е полугодие"}`;
}

/**
 * Годы на выбор: шесть прошлых, нынешний и следующий.
 *
 * Отсчёт от НЫНЕШНЕГО года, а не от выбранного, и это важно: иначе список
 * уезжал бы вслед за каждым выбором, и человек, посмотревший 2021-й, нашёл
 * бы под ним 2015-й вместо своего 2026-го.
 *
 * Шесть назад — потому что спорят и за прошлые годы: трёхлетний срок
 * давности по трудовым спорам о выплатах (ч. 2 ст. 392 ТК РФ) считается от
 * дня, когда сумма должна была быть выплачена, и запас к нему нужен.
 * Один вперёд — потому что график на следующий год известен заранее.
 *
 * Год из профиля добавляется, даже если в окно не попал: иначе человек,
 * вернувшийся к давнему расчёту, увидел бы список, в котором не отмечено
 * ничего.
 */
function yearChoices(accountingYear: number): number[] {
  const current = yearOf(todayIso());
  const years = new Set(Array.from({ length: 8 }, (_, index) => current - 6 + index));
  years.add(accountingYear);
  return [...years].sort((left, right) => left - right);
}

/** Все учётные отрезки списком: год, два полугодия, четыре квартала. */
function allParts(): StatutoryChoice[] {
  return PERIOD_ORDER.flatMap((kind) =>
    Array.from({ length: 12 / monthsIn(kind) }, (_, index) => ({ kind, index })),
  );
}

export function PeriodPicker({
  accountingYear,
  onAccountingYear,
  statutory,
  onStatutory,
  month,
  onMonth,
}: {
  accountingYear: number;
  /** Учётный год — такой же ответ на «что смотрим», как отрезок и месяц. */
  onAccountingYear: (year: number) => void;
  statutory: StatutoryChoice;
  onStatutory: (choice: StatutoryChoice) => void;
  /** Месяц года или `null` — выбран учётный отрезок. */
  month: number | null;
  onMonth: (month: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const partId = useId();
  const yearId = useId();
  const monthId = useId();

  const current =
    month === null
      ? partLabel(statutory.kind, statutory.index, accountingYear)
      : `${MONTH_NAMES[month]} ${accountingYear}`;

  function pickPart(value: string) {
    const [kind, index] = value.split(":");
    onStatutory({ kind: kind as AccountingPeriodKind, index: Number(index) });
    // Месяц снимается: он и отрезок — два ответа на один вопрос, и
    // держать оба выбранными значило бы показывать один, а считать другой.
    onMonth(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Период: ${current}. Выбрать другой`}
        className={cn(
          "inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl",
          "bg-paper-raised px-3 text-sm font-medium",
          "text-ink transition-colors hover:bg-paper-sunken",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-trace",
        )}
      >
        <CalendarRange aria-hidden className="size-4.5 shrink-0 text-ink-muted" />
        {current}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="За какой период">
        <div className="space-y-4">
          <Field
            id={partId}
            label="Учётный период"
            hint="По его итогу и определяется переработка (ч. 3 ст. 104 ТК РФ).
                  Какой он у вас — устанавливает работодатель."
          >
            <Select
              id={partId}
              value={`${statutory.kind}:${statutory.index}`}
              onChange={(event) => pickPart(event.target.value)}
            >
              {allParts().map((part) => (
                <option key={`${part.kind}:${part.index}`} value={`${part.kind}:${part.index}`}>
                  {partChoiceLabel(part.kind, part.index)}
                </option>
              ))}
            </Select>
          </Field>

          {/* Год живёт здесь, а не в настройках, где стоял списком «Учётный
              год». Там это выглядело свойством человека, тогда как год —
              то, ЗА ЧТО смотрим: тот же вопрос, что и «полугодие или
              март», и место у него то же. */}
          <Field id={yearId} label="Год">
            <Select
              id={yearId}
              value={String(accountingYear)}
              onChange={(event) => onAccountingYear(Number(event.target.value))}
            >
              {yearChoices(accountingYear).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id={monthId}
            label="Месяц"
            hint="Сузить показанное до одного месяца. «Весь период» —
                  вернуться к выбранному отрезку целиком."
          >
            <Select
              id={monthId}
              value={month === null ? "" : String(month)}
              onChange={(event) => {
                const value = event.target.value;
                onMonth(value === "" ? null : Number(value));
              }}
            >
              <option value="">Весь период</option>
              {MONTH_NAMES.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="border-t border-rule pt-4">
            <Button type="button" onClick={() => setOpen(false)}>
              Готово
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/**
 * Подпись и поле.
 *
 * Знак вопроса стоит у подписи, а не под полем: пояснение отвечает на
 * вопрос «что здесь выбрать», и читают его до выбора, а не после.
 */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        {hint ? <Hint label={`Что такое «${label}»`}>{hint}</Hint> : null}
      </div>
      {children}
    </div>
  );
}
