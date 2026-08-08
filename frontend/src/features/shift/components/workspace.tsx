"use client";

import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

import { formatHours, parseHours } from "../domain/decimal";
import { formatDateRu, formatPeriodRu } from "../domain/format";
import { reconcile, type Discrepancy } from "../domain/reconciliation";
import {
  accountingPeriodsOf,
  calculateFor,
  monthBounds,
  statutoryBounds,
} from "../model/derive";
import {
  ABSENCE_KIND_BASIS,
  type AccountingPeriodKind,
} from "../domain/value-objects";
import type { StoredProfile } from "../storage/profile";
import { ABSENCE_LABELS, type AbsenceKind } from "../schemas";
import { PeriodSummary } from "./period-summary";
import { ProfileFooter } from "./profile-footer";
import { ShiftStrip } from "./shift-strip";
import { YearCalendarEditor } from "./year-calendar-editor";

/**
 * Рабочий экран: период, расчёт, график, отсутствия и сверка.
 *
 * Всё на одной странице намеренно. Человек сверяет бумажный табель за
 * один месяц, и разносить норму, график и расхождения по вкладкам значило
 * бы заставить его держать числа в голове, переходя между ними, — ровно в
 * тот момент, когда важна точность.
 *
 * --- Почему нет состояний загрузки --------------------------------------
 *
 * Считать больше нечего ждать: расчёт идёт здесь же, за доли миллисекунды,
 * и ошибок сети у него не бывает. Экран, который раньше умел показывать
 * «Считаем…» и «Сервер недоступен», теперь просто всегда показывает
 * результат — и это самое заметное следствие переноса расчёта в браузер.
 */

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

const ABSENCE_KINDS = Object.keys(ABSENCE_LABELS) as AbsenceKind[];

type Selection =
  | { mode: "month"; index: number }
  | { mode: "statutory"; kind: AccountingPeriodKind; index: number };

export interface WorkspaceProps {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onForget: () => void;
}

export function Workspace({ profile, onChange, onForget }: WorkspaceProps) {
  const periods = accountingPeriodsOf(profile);

  // Умолчание — учётный период целиком: именно по его итогу определяется
  // переработка (ст. 104 ТК РФ), и открывать экран на месяце значило бы
  // показывать первым то число, которое ничего не решает.
  const widest = periods.at(-1) ?? "year";
  const [selection, setSelection] = useState<Selection>({
    mode: "statutory",
    kind: widest,
    index: 0,
  });

  const { periodStart, periodEnd } =
    selection.mode === "month"
      ? monthBounds(profile.accountingYear, selection.index)
      : statutoryBounds(profile.accountingYear, selection.kind, selection.index);

  const calculation = useMemo(
    () => calculateFor(profile, periodStart, periodEnd),
    [profile, periodStart, periodEnd],
  );

  // Расхождения относятся к конкретному периоду и к конкретному состоянию
  // профиля. Держать их в состоянии значило бы показывать вчерашний ответ
  // рядом с сегодняшним расчётом, поэтому они пересчитываются из тех же
  // чисел, что человек ввёл, и исчезают, когда исчезает ввод.
  const [reportedRaw, setReportedRaw] = useState<{
    norm: string;
    actual: string;
    overtime: string;
  } | null>(null);

  const discrepancies: Discrepancy[] | null = useMemo(() => {
    if (reportedRaw === null) return null;
    return reconcile(calculation, {
      normHours: parseHours(reportedRaw.norm),
      actualHours: parseHours(reportedRaw.actual),
      overtimeHours: parseHours(reportedRaw.overtime),
    });
  }, [calculation, reportedRaw]);

  return (
    <div className="space-y-10">
      <section aria-labelledby="period" className="space-y-4">
        <h2
          id="period"
          className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted"
        >
          Учётный период
        </h2>

        <div className="flex flex-wrap gap-1">
          {periods.flatMap((kind) => {
            const count = kind === "quarter" ? 4 : kind === "half_year" ? 2 : 1;
            return Array.from({ length: count }, (_, index) => {
              const active =
                selection.mode === "statutory" &&
                selection.kind === kind &&
                selection.index === index;
              return (
                <Button
                  key={`${kind}-${index}`}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  aria-pressed={active}
                  onClick={() => setSelection({ mode: "statutory", kind, index })}
                >
                  {count > 1
                    ? `${index + 1}-${kind === "quarter" ? "й квартал" : "е полугодие"}`
                    : `${profile.accountingYear} год`}
                </Button>
              );
            });
          })}
        </div>

        <p className="max-w-prose text-xs text-ink-muted">
          {profile.employmentKind === "attested"
            ? "Приказ МЧС России от 24.04.2026 № 308 п. 2: учётный период сотрудника при сменной работе — полугодие или год. Переработка определяется по его итогу."
            : "Приказ МЧС России от 24.04.2026 № 307 п. 7: учётный период работника при сменной работе — три месяца, полугодие или год. Какой именно — устанавливают правила внутреннего трудового распорядка."}
        </p>

        <div className="space-y-2 border-t border-rule pt-3">
          <h3 className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
            Помесячно
          </h3>
          <div className="flex flex-wrap gap-1">
            {MONTHS.map((name, index) => {
              const active = selection.mode === "month" && selection.index === index;
              return (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  aria-pressed={active}
                  onClick={() => setSelection({ mode: "month", index })}
                >
                  {name}
                </Button>
              );
            })}
          </div>
          <p className="max-w-prose text-xs text-ink-muted">
            Месяц учётным периодом не является — переработку по нему не считают.
            Он нужен, чтобы найти, в каком именно месяце разошлось.
          </p>
        </div>
      </section>

      <section aria-labelledby="summary" className="space-y-4">
        <h2 id="summary" className="text-xl">
          Как должно быть{" "}
          {/* Период назван словами рядом с числами. Кнопка «1-е полугодие»
              выше уже нажата, но в споре важно, какие именно даты стоят за
              нормой, а не как называется период. */}
          <span className="text-ink-muted">
            за {formatPeriodRu(periodStart, periodEnd)}
          </span>
        </h2>
        <PeriodSummary calculation={calculation} accountingYear={profile.accountingYear} />
      </section>

      <section aria-labelledby="strip" className="space-y-3">
        <h2 id="strip" className="text-xl">
          Ваш график
        </h2>
        <ShiftStrip calculation={calculation} />
      </section>

      <YearCalendarEditor profile={profile} onChange={onChange} />

      <AbsenceSection profile={profile} onChange={onChange} />

      <ReconcileSection
        discrepancies={discrepancies}
        onSubmit={setReportedRaw}
      />

      <ProfileFooter profile={profile} onForget={onForget} />
    </div>
  );
}

function AbsenceSection({
  profile,
  onChange,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
}) {
  const kindId = useId();
  const [kind, setKind] = useState<AbsenceKind>("annual_leave");
  const [error, setError] = useState<string | null>(null);

  const absences = [...profile.absences].sort((a, b) => a.startsOn.localeCompare(b.startsOn));

  return (
    <section aria-labelledby="absences" className="space-y-4">
      <h2 id="absences" className="text-xl">
        Отпуска и больничные
      </h2>
      <p className="max-w-prose text-sm text-ink-muted">
        Внесите периоды, когда вы были освобождены от службы с сохранением
        места. Смены, попавшие в них, вычтутся из НОРМЫ — именно этого чаще
        всего и не делают в табеле.
      </p>

      {error ? (
        <p className="max-w-prose rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}

      <form
        className="flex flex-wrap items-start gap-3 rounded-sm border border-rule bg-paper-raised p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const startsOn = String(data.get("startsOn") ?? "");
          const endsOn = String(data.get("endsOn") ?? "");

          if (endsOn < startsOn) {
            setError("Дата окончания раньше даты начала.");
            return;
          }
          // Пересекающиеся отсутствия запрещены: смена, попавшая и в
          // отпуск, и в больничный, была бы исключена из нормы дважды — то
          // есть норма уменьшилась бы на 48 часов за одни сутки.
          const overlap = profile.absences.find(
            (item) => item.startsOn <= endsOn && startsOn <= item.endsOn,
          );
          if (overlap) {
            setError(
              `Этот период пересекается с уже внесённым: ` +
                `${ABSENCE_LABELS[overlap.kind]} ` +
                `${formatDateRu(overlap.startsOn)} — ${formatDateRu(overlap.endsOn)}. ` +
                `Смена, попавшая в оба, вычлась бы из нормы дважды.`,
            );
            return;
          }

          setError(null);
          onChange((previous) => ({
            ...previous,
            absences: [
              ...previous.absences,
              { id: crypto.randomUUID(), kind, startsOn, endsOn },
            ],
          }));
          form.reset();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={kindId}>Причина</Label>
          <select
            id={kindId}
            value={kind}
            onChange={(event) => setKind(event.target.value as AbsenceKind)}
            className="block h-9 w-56 rounded-xs border border-rule-strong bg-paper px-2 text-sm"
          >
            {ABSENCE_KINDS.map((option) => (
              <option key={option} value={option}>
                {ABSENCE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        <DateField label="С" name="startsOn" required />
        <DateField
          label="По включительно"
          name="endsOn"
          required
          hint="Как в приказе об отпуске: последний день входит."
        />
        <Button type="submit" variant="outline" className="mt-[1.375rem]">
          Добавить
        </Button>
      </form>

      {absences.length > 0 ? (
        <ul className="divide-y divide-rule border-y border-rule">
          {absences.map((absence) => (
            <li key={absence.id} className="flex flex-wrap items-baseline gap-x-4 py-2 text-sm">
              <span className="font-medium">{ABSENCE_LABELS[absence.kind]}</span>
              <span className="font-mono">
                {formatDateRu(absence.startsOn)} — {formatDateRu(absence.endsOn)}
              </span>
              <span className="text-xs text-ink-muted">
                {ABSENCE_KIND_BASIS[absence.kind]}
              </span>
              <button
                type="button"
                className="ml-auto text-xs text-ink-muted underline underline-offset-2 hover:text-signal"
                onClick={() =>
                  onChange((previous) => ({
                    ...previous,
                    absences: previous.absences.filter((item) => item.id !== absence.id),
                  }))
                }
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">Периодов отсутствия не внесено.</p>
      )}
    </section>
  );
}

function ReconcileSection({
  discrepancies,
  onSubmit,
}: {
  discrepancies: Discrepancy[] | null;
  onSubmit: (values: { norm: string; actual: string; overtime: string }) => void;
}) {
  const normId = useId();
  const actualId = useId();
  const overtimeId = useId();

  return (
    <section aria-labelledby="reconcile" className="space-y-4">
      <h2 id="reconcile" className="text-xl">
        Что написано в вашем табеле
      </h2>
      <p className="max-w-prose text-sm text-ink-muted">
        Впишите числа из выданного табеля. Пустое поле не сравнивается — если
        какого-то числа в табеле нет, оставьте его пустым.
      </p>

      <form
        className="flex flex-wrap items-start gap-3 rounded-sm border border-rule bg-paper-raised p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onSubmit({
            norm: String(data.get("normHours") ?? ""),
            actual: String(data.get("actualHours") ?? ""),
            overtime: String(data.get("overtimeHours") ?? ""),
          });
        }}
      >
        <Field id={normId} name="normHours" label="Норма" />
        <Field id={actualId} name="actualHours" label="Отработано" />
        <Field id={overtimeId} name="overtimeHours" label="Переработка" />
        <Button type="submit" className="mt-[1.375rem]">
          Сверить
        </Button>
      </form>

      {discrepancies !== null ? (
        discrepancies.length === 0 ? (
          <p className="rounded-sm border-l-2 border-verify bg-verify-soft px-4 py-3 text-sm">
            Расхождений нет: табель сходится с расчётом. Это тоже результат —
            значит, за этот период вопросов к работодателю нет.
          </p>
        ) : (
          <ul className="space-y-3">
            {discrepancies.map((item) => (
              <li
                key={item.field}
                className={cn(
                  "space-y-1 rounded-sm border-l-2 px-4 py-3",
                  item.favoursEmployer
                    ? "border-signal bg-signal-soft"
                    : "border-rule-strong bg-paper-sunken",
                )}
              >
                <p className="font-medium">
                  {item.label}: у вас в табеле{" "}
                  <span className="font-mono">{formatHours(item.reported)}</span> ч, по
                  расчёту <span className="font-mono">{formatHours(item.expected)}</span> ч
                  <span className="ml-2 font-mono text-sm">
                    ({item.delta.greaterThan(0) ? "+" : ""}
                    {formatHours(item.delta)} ч)
                  </span>
                </p>
                <p className="max-w-prose text-sm">{item.explanation}</p>
                <p className="text-xs text-ink-muted">Основание: {item.basis}</p>
                {!item.favoursEmployer ? (
                  <p className="text-xs text-ink-muted">
                    Это расхождение в вашу пользу — проверьте, не ошибка ли это
                    с вашей стороны.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {discrepancies !== null && discrepancies.length > 0 ? (
        <p className="max-w-prose text-xs text-ink-muted">
          Расчёт построен на вашем графике и производственном календаре.
          Прежде чем идти с ним к руководителю, проверьте, что караул, дата
          первой смены и периоды отсутствия внесены верно: ошибка в них даст
          расхождение там, где его нет.
        </p>
      ) : null}
    </section>
  );
}

function Field({ id, name, label }: { id: string; name: string; label: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        inputMode="decimal"
        placeholder="—"
        className="w-32 font-mono"
      />
    </div>
  );
}
