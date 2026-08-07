"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { ErrorPanel } from "@/components/shared/error-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client/client";
import { cn } from "@/lib/utils/cn";

import { addAbsence, getCalculation, listAbsences, reconcile, removeAbsence } from "../api";
import {
  ABSENCE_LABELS,
  hours,
  type Absence,
  type AbsenceKind,
  type Calculation,
  type Discrepancy,
  type Profile,
} from "../schemas";
import { PeriodSummary } from "./period-summary";
import { ShiftStrip } from "./shift-strip";

/**
 * Рабочий экран: период, расчёт, график, отсутствия и сверка.
 *
 * Всё на одной странице намеренно. Человек сверяет бумажный табель за
 * один месяц, и разносить норму, график и расхождения по вкладкам
 * значило бы заставить его держать числа в голове, переходя между ними,
 * — ровно в тот момент, когда важна точность.
 */

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

const ABSENCE_KINDS = Object.keys(ABSENCE_LABELS) as AbsenceKind[];

function monthBounds(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  return {
    periodStart: `${year}-${pad(month + 1)}-01`,
    periodEnd: `${nextYear}-${pad(nextMonth + 1)}-01`,
  };
}

export function Workspace({ profile }: { profile: Profile }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getUTCMonth());
  const [wholeYear, setWholeYear] = useState(false);

  const [calculation, setCalculation] = useState<Calculation | null>(null);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  // Границы держатся примитивами, а не объектом: объектный литерал
  // пересоздаётся на каждый рендер, и хук, зависящий от него, перезапускал
  // бы запрос бесконечно.
  const { periodStart, periodEnd } = wholeYear
    ? {
        periodStart: `${profile.accountingYear}-01-01`,
        periodEnd: `${profile.accountingYear + 1}-01-01`,
      }
    : monthBounds(profile.accountingYear, month);

  const fail = useCallback((cause: unknown) => {
    setError(
      cause instanceof ApiError
        ? cause
        : new ApiError({
            type: "about:blank",
            title: "Сервер недоступен",
            status: 0,
            detail: "Не удалось получить данные. Проверьте соединение.",
          }),
    );
  }, []);

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [next, list] = await Promise.all([
        getCalculation(profile.id, { periodStart, periodEnd }),
        listAbsences(profile.id),
      ]);
      setCalculation(next);
      setAbsences(list);
      // Расхождения относятся к прежнему периоду и после смены периода
      // лгали бы: сбрасываются вместе с расчётом.
      setDiscrepancies(null);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }, [profile.id, periodStart, periodEnd, fail]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="space-y-10">
      {error ? <ErrorPanel error={error} /> : null}

      <section aria-labelledby="period" className="space-y-3">
        <h2 id="period" className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
          Период
        </h2>
        <div className="flex flex-wrap gap-1">
          {MONTHS.map((name, index) => (
            <Button
              key={name}
              type="button"
              size="sm"
              variant={!wholeYear && month === index ? "default" : "outline"}
              aria-pressed={!wholeYear && month === index}
              onClick={() => {
                setWholeYear(false);
                setMonth(index);
              }}
            >
              {name}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={wholeYear ? "default" : "outline"}
            aria-pressed={wholeYear}
            onClick={() => setWholeYear(true)}
          >
            весь {profile.accountingYear} год
          </Button>
        </div>
        <p className="max-w-prose text-xs text-ink-muted">
          Учётный период при суммированном учёте устанавливает работодатель — до
          года (ст. 104 ТК РФ). Переработка определяется по его итогу, поэтому
          спор обычно идёт о годе, а месяц полезен, чтобы найти, где именно
          разошлось.
        </p>
      </section>

      {calculation ? (
        <>
          <section aria-labelledby="summary" className="space-y-4">
            <h2 id="summary" className="text-xl">
              Как должно быть
            </h2>
            <PeriodSummary calculation={calculation} />
          </section>

          <section aria-labelledby="strip" className="space-y-3">
            <h2 id="strip" className="text-xl">
              Ваш график
            </h2>
            <ShiftStrip calculation={calculation} />
          </section>
        </>
      ) : (
        <p className="text-sm text-ink-muted">{busy ? "Считаем…" : "Нет данных."}</p>
      )}

      <AbsenceSection
        profile={profile}
        absences={absences}
        onChanged={reload}
        onError={fail}
      />

      {calculation ? (
        <ReconcileSection
          profile={profile}
          period={{ periodStart, periodEnd }}
          discrepancies={discrepancies}
          onResult={setDiscrepancies}
          onError={fail}
        />
      ) : null}
    </div>
  );
}

function AbsenceSection({
  profile,
  absences,
  onChanged,
  onError,
}: {
  profile: Profile;
  absences: Absence[];
  onChanged: () => Promise<void>;
  onError: (cause: unknown) => void;
}) {
  const kindId = useId();
  const fromId = useId();
  const toId = useId();
  const [kind, setKind] = useState<AbsenceKind>("annual_leave");
  const [pending, setPending] = useState(false);

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

      <form
        className="flex flex-wrap items-start gap-3 rounded-sm border border-rule bg-paper-raised p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setPending(true);
          try {
            await addAbsence(profile.id, {
              kind,
              startsOn: String(form.get("startsOn") ?? ""),
              endsOn: String(form.get("endsOn") ?? ""),
            });
            (event.target as HTMLFormElement).reset();
            await onChanged();
          } catch (cause) {
            onError(cause);
          } finally {
            setPending(false);
          }
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
        <div className="space-y-1.5">
          <Label htmlFor={fromId}>С</Label>
          <Input id={fromId} name="startsOn" type="date" required className="w-44" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={toId}>По включительно</Label>
          <Input id={toId} name="endsOn" type="date" required className="w-44" />
          <p className="max-w-44 text-xs text-ink-muted">
            Как в приказе об отпуске: последний день входит.
          </p>
        </div>
        <Button type="submit" variant="outline" className="mt-[1.375rem]" disabled={pending}>
          {pending ? "Добавление…" : "Добавить"}
        </Button>
      </form>

      {absences.length > 0 ? (
        <ul className="divide-y divide-rule border-y border-rule">
          {absences.map((absence) => (
            <li key={absence.id} className="flex flex-wrap items-baseline gap-x-4 py-2 text-sm">
              <span className="font-medium">{ABSENCE_LABELS[absence.kind]}</span>
              <span className="font-mono">
                {absence.startsOn} — {absence.endsOn}
              </span>
              <span className="text-xs text-ink-muted">{absence.basis}</span>
              <button
                type="button"
                className="ml-auto text-xs text-ink-muted underline underline-offset-2 hover:text-signal"
                onClick={async () => {
                  try {
                    await removeAbsence(profile.id, absence.id);
                    await onChanged();
                  } catch (cause) {
                    onError(cause);
                  }
                }}
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
  profile,
  period,
  discrepancies,
  onResult,
  onError,
}: {
  profile: Profile;
  period: { periodStart: string; periodEnd: string };
  discrepancies: Discrepancy[] | null;
  onResult: (next: Discrepancy[]) => void;
  onError: (cause: unknown) => void;
}) {
  const normId = useId();
  const actualId = useId();
  const overtimeId = useId();
  const [pending, setPending] = useState(false);

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
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const num = (name: string) => {
            const raw = String(form.get(name) ?? "").trim();
            return raw === "" ? null : Number(raw.replace(",", "."));
          };
          setPending(true);
          try {
            const result = await reconcile(profile.id, {
              ...period,
              normHours: num("normHours"),
              actualHours: num("actualHours"),
              overtimeHours: num("overtimeHours"),
            });
            onResult(result.discrepancies);
          } catch (cause) {
            onError(cause);
          } finally {
            setPending(false);
          }
        }}
      >
        <Field id={normId} name="normHours" label="Норма" />
        <Field id={actualId} name="actualHours" label="Отработано" />
        <Field id={overtimeId} name="overtimeHours" label="Переработка" />
        <Button type="submit" className="mt-[1.375rem]" disabled={pending}>
          {pending ? "Сверяем…" : "Сверить"}
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
                  <span className="font-mono">{hours(item.reported)}</span> ч, по
                  расчёту <span className="font-mono">{hours(item.expected)}</span> ч
                  <span className="ml-2 font-mono text-sm">
                    ({Number(item.delta) > 0 ? "+" : ""}
                    {hours(item.delta)} ч)
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
