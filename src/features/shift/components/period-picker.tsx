"use client";

import { Check } from "lucide-react";
import { Fragment, useId, useRef, useState } from "react";

import { KNOB, KNOB_ICON, KNOB_NEST, KNOB_POPOVER, KnobLabel, knobOption } from "@/components/ui/knob";
import { useDismiss } from "@/components/ui/use-dismiss";
import { cn } from "@/lib/utils/cn";

import { todayIso, year as yearOf } from "../domain/plain-date";
import type { AccountingPeriodKind } from "../domain/value-objects";
import { ACCOUNTING_PERIODS } from "../domain/value-objects";
import { PeriodIcon, YearMark } from "./grid-icons";

/**
 * Выбор периода — двумя кнопками: доля года в шапке и сам год в нижнем
 * ряду.
 *
 * --- Почему двумя, а не одним окном ---------------------------------------
 *
 * Вопросов здесь два, и они разной природы. КАКАЯ ЧАСТЬ ГОДА — главный
 * вопрос экрана: по итогу учётного периода определяется переработка
 * (ч. 3 ст. 104 ТК РФ), и ответ на него стоит посередине шапки, над
 * цифрами и сеткой разом. КАКОЙ ГОД — вопрос другого рода: его меняют
 * редко, чтобы заглянуть в прошлый расчёт, и место ему среди органов
 * управления сеткой, внизу.
 *
 * Прежде оба вопроса и третий — «не сузить ли до месяца» — сидели в одном
 * окне тремя списками. Месяц убран вовсе: он отвечал не на вопрос учёта, а
 * на «посмотреть поближе», а поближе показывает сама сетка — у каждого
 * месяца над ним стоят норма, отработанное и разница.
 *
 * --- Почему списком, а не окном --------------------------------------------
 *
 * Вариантов немного — семь долей года, восемь-девять лет, — и они
 * помещаются в окошко под кнопкой целиком. Окно во весь экран со списком
 * внутри требовало трёх нажатий там, где хватает двух, и закрывало то, что
 * от выбора меняется. Выбор применяется сразу, окошко закрывается само.
 */

export interface StatutoryChoice {
  kind: AccountingPeriodKind;
  index: number;
}

/**
 * Порядок долей — от широкой к узкой: год, полугодия, кварталы.
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
 * Подпись доли в списке — без года.
 *
 * Снаружи, на кнопке, год нужен: она отвечает на вопрос «что я сейчас
 * вижу», и «Год» без числа на него не отвечает. В списке же год один на
 * все строки, и «2026 год» в первой из них читался бы ещё одним выбором.
 */
function partChoiceLabel(kind: AccountingPeriodKind, index: number): string {
  if (kind === "year") return "Весь год";
  return `${index + 1}-${kind === "quarter" ? "й квартал" : "е полугодие"}`;
}

/** Доли года, сгруппированные по виду: год, два полугодия, четыре квартала. */
function partGroups(): StatutoryChoice[][] {
  return PERIOD_ORDER.map((kind) =>
    Array.from({ length: 12 / monthsIn(kind) }, (_, index) => ({ kind, index })),
  );
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
 * Год из профиля добавляется, даже если в список не попал: иначе человек,
 * вернувшийся к давнему расчёту, увидел бы список, в котором не отмечено
 * ничего.
 */
function yearChoices(accountingYear: number): number[] {
  const current = yearOf(todayIso());
  const years = new Set(Array.from({ length: 8 }, (_, index) => current - 6 + index));
  years.add(accountingYear);
  return [...years].sort((left, right) => left - right);
}

/**
 * Доля года — кнопкой посередине шапки и списком под ней.
 *
 * Кнопка — плашка того же рода, что итоги под шапкой: бумага, скругление,
 * свет лампы по кромке (`lit`). На ней знак — часы, чей круг показывает
 * выбранную долю (`PeriodIcon`), — и та же доля словами: «2026 год»,
 * «2-е полугодие». Не «Период» и не даты: кнопку нажимают, чтобы СМЕНИТЬ
 * долю, и сначала нужно знать, на какой стоишь.
 */
export function PeriodPicker({
  accountingYear,
  statutory,
  onStatutory,
}: {
  accountingYear: number;
  statutory: StatutoryChoice;
  onStatutory: (choice: StatutoryChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const nest = useRef<HTMLDivElement>(null);
  const id = useId();
  useDismiss(open, setOpen, nest);

  const current = partLabel(statutory.kind, statutory.index, accountingYear);

  return (
    <div ref={nest} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Учётный период: ${current}. Выбрать другой`}
        className={cn(
          "lit inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl",
          "bg-paper-raised px-3 text-sm font-medium whitespace-nowrap text-ink",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        )}
      >
        {/* Чернилами, а не серым: выбранная доля кольца должна читаться
            рядом с тусклыми, а на сером всё кольцо сливалось в одно. */}
        <PeriodIcon kind={statutory.kind} index={statutory.index} />
        {current}
      </button>

      {open && (
        <div
          id={id}
          role="group"
          aria-label="Учётный период"
          className={cn(
            // Под кнопкой и по её оси: кнопка стоит посередине шапки, и
            // окошко, прижатое к одному её краю, съезжало бы с середины.
            "modal-lift absolute left-1/2 top-full z-100 mt-2 w-64 max-w-[calc(100vw-3rem)]",
            "-translate-x-1/2 rounded-xl bg-paper-raised p-1.5",
          )}
        >
          {partGroups().map((group, at) => (
            <Fragment key={group[0]?.kind}>
              {/* Черта между видами: год, полугодия, кварталы читаются
                  тремя ступенями сужения, а не семью строками подряд. */}
              {at > 0 ? <div aria-hidden className="mx-2.5 my-1 border-t border-rule" /> : null}
              {group.map((part) => {
                const active = part.kind === statutory.kind && part.index === statutory.index;
                return (
                  <button
                    key={`${part.kind}:${part.index}`}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      onStatutory(part);
                      // Выбрали — и спрашивать больше нечего.
                      setOpen(false);
                    }}
                    className={knobOption(active)}
                  >
                    <PeriodIcon
                      kind={part.kind}
                      index={part.index}
                      className={active ? "text-ink" : undefined}
                    />
                    {partChoiceLabel(part.kind, part.index)}
                    {/* Галочка, а не только цвет: выбранное названо знаком,
                        который читается и на чёрно-белом экране. */}
                    {active ? <Check aria-hidden className="ml-auto text-ink" /> : null}
                  </button>
                );
              })}
            </Fragment>
          ))}

          <p className="mt-1.5 border-t border-rule px-2.5 pt-2 pb-1 text-xs leading-snug text-ink-muted">
            По итогу учётного периода определяется переработка (ч. 3 ст. 104 ТК РФ).
            Какой он у вас — устанавливает работодатель.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Учётный год — знаком нижнего ряда (`grid-dock.tsx`) и списком над ним.
 *
 * Год записывается прямо в профиль, а не хранится состоянием экрана:
 * человек, вернувшийся к прошлогоднему расчёту через день, должен найти
 * его там же, где оставил.
 */
export function YearPicker({
  accountingYear,
  onAccountingYear,
}: {
  accountingYear: number;
  onAccountingYear: (year: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const nest = useRef<HTMLDivElement>(null);
  const id = useId();
  useDismiss(open, setOpen, nest);

  return (
    <div ref={nest} className={KNOB_NEST}>
      {open && (
        <div
          id={id}
          role="group"
          aria-label="Учётный год"
          className={cn(
            KNOB_POPOVER,
            // На телефоне знак стоит посередине ряда, и окошко — по его
            // оси; на широком экране ряд прижат к левому краю, и окошко
            // встаёт от левого края знака, как у легенды.
            "left-1/2 w-36 -translate-x-1/2 p-1.5 md:left-0 md:translate-x-0",
            "max-h-[60svh]",
          )}
        >
          {yearChoices(accountingYear).map((option) => {
            const active = option === accountingYear;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onAccountingYear(option);
                  setOpen(false);
                }}
                className={knobOption(active)}
              >
                {option}
                {active ? <Check aria-hidden className="ml-auto text-ink" /> : null}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Учётный год: ${accountingYear}. Выбрать другой`}
        className={KNOB}
      >
        <span className={cn(KNOB_ICON, "text-ink-muted")}>
          <YearMark year={accountingYear} />
        </span>
        <KnobLabel>{accountingYear} год</KnobLabel>
      </button>
    </div>
  );
}
