"use client";

import { CalendarRange } from "lucide-react";
import { useState } from "react";

import { Hint } from "@/components/ui/hint";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils/cn";

import { todayIso, year as yearOf } from "../domain/plain-date";
import type { AccountingPeriodKind } from "../domain/value-objects";
import { ACCOUNTING_PERIODS } from "../domain/value-objects";
import { MONTH_NAMES } from "./month-names";

/**
 * Выбор периода — кнопкой и окном, а не списком.
 *
 * --- Почему не `select` ---------------------------------------------------
 *
 * Отрезков девятнадцать: год, два полугодия, четыре квартала и двенадцать
 * месяцев. В выпадающем списке это лента, по которой нужно вести курсор,
 * и рядом с ней стоял ВТОРОЙ список — «месяц внутри периода». Два органа
 * управления ради одного выбора, причём второй зависел от первого: выбрав
 * январь, человек не мог выбрать август, не вернувшись к первому списку.
 *
 * Кнопка и окно решают это одним движением. В окне все отрезки видны
 * сразу, разложены по группам, и нажатие на любой закрывает окно с уже
 * применённым выбором: подтверждать нечего — выбор и есть подтверждение.
 *
 * --- Почему группы именно такие -------------------------------------------
 *
 * «По годам», «Учётный период», «Помесячно» — сверху вниз это сужение, и
 * список так и читается: год, часть года, месяц. Год попал сюда из
 * настроек, где стоял списком «Учётный год» рядом с караулом и нормой, —
 * то есть выглядел свойством человека. Год не свойство, а то, ЗА ЧТО
 * смотрим: вопрос тот же, что «полугодие или март», и место у него то же.
 *
 * Раньше кварталы стояли отдельной группой «Только для сверки»:
 * приложение знало, сотрудник человек или работник, и по букве приказа
 * сотруднику квартал учётным периодом не является (№ 308 п. 2 оставляет
 * ему полугодие или год). На экране это была пометка на половине пунктов,
 * которую нужно прочитать и понять, прежде чем нажать.
 *
 * Теперь приложение не спрашивает, кто человек, и делить пункты стало не
 * по чему: период у него назначен приказом подразделения, и он его знает.
 * Все три отрезка стоят одной группой.
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
 * отдельной строкой прямо над отрезками и выбирается там же, поэтому
 * «2026 год» рядом с выбранным 2026-м — это одно и то же число дважды, и
 * второй раз оно читается как ещё один выбор.
 */
function partChoiceLabel(kind: AccountingPeriodKind, index: number): string {
  if (kind === "year") return "Год";
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

/** Во сколько колонок ставить отрезок такого вида: год во всю ширину. */
const SPAN: Record<AccountingPeriodKind, string> = {
  year: "col-span-2 sm:col-span-4",
  half_year: "sm:col-span-2",
  quarter: "",
};

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

  const current =
    month === null
      ? partLabel(statutory.kind, statutory.index, accountingYear)
      : `${MONTH_NAMES[month]} ${accountingYear}`;

  function pickPart(part: StatutoryChoice) {
    onStatutory(part);
    // Месяц снимается: он и отрезок — два ответа на один вопрос, и
    // держать оба выбранными значило бы показывать один, а считать другой.
    onMonth(null);
    setOpen(false);
  }

  function pickMonth(index: number) {
    onMonth(index);
    setOpen(false);
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
        <div className="space-y-6">
          {/* Год стоит первым: он объемлет и отрезок, и месяц, и читается
              список сверху вниз как сужение — год, часть года, месяц.

              Здесь он и живёт, а не в настройках, где стоял списком «Учётный
              год». В настройках это выглядело свойством человека вроде
              караула, тогда как год — это то, ЗА ЧТО смотрим: тот же вопрос,
              что и «полугодие или март», и место у него то же. */}
          <section className="space-y-2">
            <h3 className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
              По годам
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {yearChoices(accountingYear).map((option) => (
                <Choice
                  key={option}
                  active={option === accountingYear}
                  onClick={() => {
                    onAccountingYear(option);
                    setOpen(false);
                  }}
                >
                  {option}
                </Choice>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
              Учётный период
              {/* <Hint label="Что такое учётный период">
                Переработка определяется по итогу УЧЁТНОГО периода (ст. 104 ТК
                РФ): у сотрудника ФПС ГПС это полугодие или год (Приказ № 308
                п. 2), у работника по трудовому договору — ещё и квартал
                (Приказ № 307 п. 7). Квартал и месяц показаны всем: по ним
                удобно искать, где именно расчёт разошёлся с выданным табелем,
                — но итог, который решает спор, снимается с учётного периода.
              </Hint> */}
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {allParts().map((part) => (
                <Choice
                  key={`${part.kind}:${part.index}`}
                  className={SPAN[part.kind]}
                  active={month === null && statutory.kind === part.kind && statutory.index === part.index}
                  onClick={() => pickPart(part)}
                >
                  {partChoiceLabel(part.kind, part.index)}
                </Choice>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
              Помесячно
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MONTH_NAMES.map((name, index) => (
                <Choice
                  key={name}
                  active={month === index}
                  onClick={() => pickMonth(index)}
                >
                  {name}
                </Choice>
              ))}
            </div>
          </section>
        </div>
      </Modal>
    </>
  );
}

/**
 * Пункт выбора.
 *
 * Выбранный залит чернилами: это единственное залитое пятно в окне, и
 * потому видно, где человек стоит, без второго признака вроде галочки.
 */
function Choice({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-10 cursor-pointer rounded-xl border px-3 text-sm transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
        active
          ? "border-ink bg-ink font-medium text-paper"
          : "border-rule-strong bg-paper-raised text-ink hover:bg-paper-sunken",
        className,
      )}
    >
      {children}
    </button>
  );
}
