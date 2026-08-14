"use client";

import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/shared/collapsible-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";
import { formatHours, parseHours } from "../domain/decimal";
import { formatDateRu, formatPeriodRu } from "../domain/format";
import { formatMoney } from "../domain/overtime-pay";
import { pendingTransfers } from "../domain/production-calendar";
import { DOCUMENT_NOUN } from "../domain/report-documents";
import { reconcile, type Discrepancy } from "../domain/reconciliation";
import {
  accountingPeriodsOf,
  calculateFor,
  monthBounds,
  overtimePayFor,
  statutoryBounds,
} from "../model/derive";
import {
  ABSENCE_KIND_BASIS,
  CALLOUT_KIND_BASIS,
  type AccountingPeriodKind,
} from "../domain/value-objects";
import type { StoredProfile } from "../storage/profile";
import {
  ABSENCE_EFFECT,
  ABSENCE_LABELS,
  CALLOUT_LABELS,
  type AbsenceKind,
  type CalloutKind,
} from "../schemas";
import { DateField } from "./date-field";
import { OvertimePayCard } from "./overtime-pay-card";
import { PeriodSummary } from "./period-summary";
import { ReportDocumentsCard } from "./report-documents-card";
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
const CALLOUT_KINDS = Object.keys(CALLOUT_LABELS) as CalloutKind[];

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

  const pay = useMemo(() => overtimePayFor(profile, calculation), [profile, calculation]);

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
        <PeriodSummary
          calculation={calculation}
          accountingYear={profile.accountingYear}
          payTotal={pay?.primary.total ?? null}
        />
      </section>

      {/* Деньги — отдельным разделом и свёрнутым: сумма нужна не всем и не
          сразу, а поле оклада в основной сводке смотрелось бы как
          обязательное к заполнению. */}
      <CollapsibleSection
        title="Сколько это в деньгах"
        summary={
          pay
            ? `${formatMoney(pay.primary.total)} за ${formatHours(calculation.overtimeHours)} ч`
            : "укажите оклад — посчитаем по приказу"
        }
      >
        <OvertimePayCard
          profile={profile}
          calculation={calculation}
          pay={pay}
          onChange={onChange}
        />
      </CollapsibleSection>

      {/* Сразу за деньгами, а не в конце: человек, увидевший сумму, тут же
          спрашивает «и что мне теперь с этим делать». Ответ на этот вопрос
          обязан стоять там, где он задан. */}
      <CollapsibleSection
        title={`Как это потребовать: ${DOCUMENT_NOUN[profile.employmentKind]}`}
        summary="образец, файл и порядок подачи"
      >
        <ReportDocumentsCard
          profile={profile}
          calculation={calculation}
          pay={pay}
          onChange={onChange}
        />
      </CollapsibleSection>

      {/* Разделы сворачиваются, и открыт по умолчанию только график: за
          ним приходят чаще всего. Иначе экран — пять экранов подряд, и до
          сверки, ради которой всё написано, нужно пролистать двенадцать
          календарных сеток. Подпись у свёрнутого раздела говорит, что
          внутри, чтобы не открывать наугад. */}
      <CollapsibleSection
        title="Ваш график"
        summary={`смен за период: ${calculation.scheduledShifts}`}
        defaultOpen
      >
        <ShiftStrip calculation={calculation} />
      </CollapsibleSection>

      <CollapsibleSection
        title={`Календарь ${profile.accountingYear} года`}
        summary={
          Object.keys(profile.calendarOverrides).length > 0
            ? `ваших правок: ${Object.keys(profile.calendarOverrides).length}`
            : pendingTransfers(profile.accountingYear).length > 0
              ? "переносы выходных не размечены"
              : "праздники и переносы размечены"
        }
      >
        <YearCalendarEditor profile={profile} onChange={onChange} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Отпуска и больничные"
        summary={
          profile.absences.length > 0
            ? `внесено периодов: ${profile.absences.length}`
            : "не внесено"
        }
      >
        <AbsenceSection profile={profile} onChange={onChange} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Вызовы помимо графика"
        summary={
          profile.callouts.length > 0
            ? `внесено: ${profile.callouts.length}`
            : "не внесено"
        }
      >
        <CalloutSection profile={profile} onChange={onChange} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Что написано в вашем табеле"
        summary={
          discrepancies === null
            ? "сверка не проводилась"
            : discrepancies.length === 0
              ? "расхождений нет"
              : `расхождений: ${discrepancies.length}`
        }
      >
        <ReconcileSection discrepancies={discrepancies} onSubmit={setReportedRaw} />
      </CollapsibleSection>

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
            className="block h-9 w-56 rounded-sm border border-rule-strong bg-paper px-2 text-sm"
          >
            {ABSENCE_KINDS.map((option) => (
              <option key={option} value={option}>
                {ABSENCE_LABELS[option]}
              </option>
            ))}
          </select>
          {/* Отгул работает не так, как остальные виды, и человек обязан
              это увидеть до того, как внесёт период. */}
          <p className="max-w-56 text-xs text-ink-muted" aria-live="polite">
            {ABSENCE_EFFECT[kind]}
          </p>
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

/**
 * Вызовы помимо своей смены.
 *
 * --- Почему отдельно от отпусков ----------------------------------------
 *
 * Отсутствия уменьшают норму, вызовы увеличивают отработанное — это
 * противоположные действия, и складывать их в один список значило бы
 * предлагать человеку выбрать из перечня, где половина пунктов работает
 * ему в минус, а половина в плюс, и различить их можно только по названию.
 *
 * --- Почему часы вводятся, а не берутся из смены -------------------------
 *
 * Вызов не смена: на соревнования могут снять на четыре часа, а в резерв
 * поставить на сутки. Число часов человек берёт из распоряжения, и
 * подставлять за него 8 или 24 значило бы вписать в расчёт цифру, которой
 * он не видел.
 */
function CalloutSection({
  profile,
  onChange,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
}) {
  const kindId = useId();
  const hoursId = useId();
  const [kind, setKind] = useState<CalloutKind>("competition");
  const [error, setError] = useState<string | null>(null);

  const callouts = [...profile.callouts].sort((a, b) => a.startsOn.localeCompare(b.startsOn));

  return (
    <section className="space-y-4">
      <p className="max-w-prose text-sm text-ink-muted">
        Соревнования, сборы, резерв, праздничные мероприятия, выборы. Это
        исполнение обязанностей, то есть служебное время (ч. 1 ст. 54 ФЗ-141,
        ст. 91 ТК РФ): часы прибавляются к отработанному и норму не трогают.
        На графике такие сутки помечены отдельно — видно, куда именно вызывали.
      </p>
      <p className="max-w-prose text-sm text-ink-muted">
        Вызовов на одни сутки может быть несколько: после смены соревнования, а
        следом резерв. Вносите каждый отдельно — часы складываются, а в клетке
        графика встанут все коды сразу.
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
          const raw = String(data.get("hoursPerDay") ?? "").trim();
          const parsed = parseHours(raw);

          if (!startsOn || !endsOn) {
            setError("Укажите обе даты.");
            return;
          }
          if (endsOn < startsOn) {
            setError("Дата окончания раньше даты начала.");
            return;
          }
          // Больше суток в сутках не бывает, и ноль часов — это не вызов.
          if (parsed === null || parsed.lessThanOrEqualTo(0) || parsed.greaterThan(24)) {
            setError("Часы в сутки — число от 0 до 24, например 8 или 4,5.");
            return;
          }

          setError(null);
          onChange((previous) => ({
            ...previous,
            callouts: [
              ...previous.callouts,
              {
                id: crypto.randomUUID(),
                kind,
                startsOn,
                endsOn,
                hoursPerDay: parsed.toString(),
              },
            ],
          }));
          form.reset();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={kindId}>Куда вызывали</Label>
          <select
            id={kindId}
            value={kind}
            onChange={(event) => setKind(event.target.value as CalloutKind)}
            className="block h-9 w-56 rounded-xs border border-rule-strong bg-paper px-2 text-sm"
          >
            {CALLOUT_KINDS.map((option) => (
              <option key={option} value={option}>
                {CALLOUT_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        <DateField label="С" name="startsOn" required />
        <DateField
          label="По включительно"
          name="endsOn"
          required
          hint="Однодневный вызов — одна и та же дата."
        />
        <div className="space-y-1.5">
          <Label htmlFor={hoursId}>Часов в сутки</Label>
          <Input
            id={hoursId}
            name="hoursPerDay"
            inputMode="decimal"
            defaultValue="8"
            className="w-28 font-mono"
          />
        </div>
        <Button type="submit" variant="outline" className="mt-[1.375rem]">
          Добавить
        </Button>
      </form>

      {callouts.length > 0 ? (
        <ul className="divide-y divide-rule border-y border-rule">
          {callouts.map((callout) => (
            <li key={callout.id} className="flex flex-wrap items-baseline gap-x-4 py-2 text-sm">
              <span className="font-medium">{CALLOUT_LABELS[callout.kind]}</span>
              <span className="font-mono">
                {formatDateRu(callout.startsOn)} — {formatDateRu(callout.endsOn)}
              </span>
              <span className="font-mono text-trace">
                {formatHours(callout.hoursPerDay)} ч/сут
              </span>
              <span className="text-xs text-ink-muted">{CALLOUT_KIND_BASIS[callout.kind]}</span>
              <button
                type="button"
                className="ml-auto text-xs text-ink-muted underline underline-offset-2 hover:text-signal"
                onClick={() =>
                  onChange((previous) => ({
                    ...previous,
                    callouts: previous.callouts.filter((item) => item.id !== callout.id),
                  }))
                }
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">Вызовов не внесено.</p>
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
          Внимательно, проверьте, что караул, дата
          первой смены, периоды отсутствия и производственный календарь заполнены корректно: 
          ошибка в них даст расхождение там, где его нет.
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
