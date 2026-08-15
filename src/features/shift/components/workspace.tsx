"use client";

import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/shared/collapsible-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";
import { formatHours, parseHours } from "../domain/decimal";
import { formatDateRu, formatPeriodRu } from "../domain/format";
import { pendingTransfers } from "../domain/production-calendar";
import { reconcile, type Discrepancy } from "../domain/reconciliation";
import {
  accountingPeriodsOf,
  calculateFor,
  monthBounds,
  overtimePayFor,
  statutoryBounds,
} from "../model/derive";
import { ABSENCE_KIND_BASIS, CALLOUT_KIND_BASIS } from "../domain/value-objects";
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
import { PeriodPicker, type StatutoryChoice } from "./period-picker";
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
 * --- Почему настройки съехали в боковую колонку -------------------------
 *
 * Выбор периода, выбор месяца и оклад — это не разделы наравне с графиком
 * и сверкой, а РУЧКИ, которыми управляют всем остальным. Стоя в общем
 * потоке сверху, они прокручивались вместе с ним: чтобы посмотреть тот же
 * график за соседний месяц, приходилось листать двенадцать календарных
 * сеток вверх, переключать и листать обратно.
 *
 * В колонке они закреплены и видны всё время, пока человек листает
 * содержимое, — то есть ровно тогда, когда ими и хочется воспользоваться.
 * Ниже `lg` колонки нет: на телефоне она встала бы над содержимым, и это
 * была бы прежняя раскладка, только уже.
 *
 * --- Почему нет состояний загрузки --------------------------------------
 *
 * Считать больше нечего ждать: расчёт идёт здесь же, за доли миллисекунды,
 * и ошибок сети у него не бывает. Экран, который раньше умел показывать
 * «Считаем…» и «Сервер недоступен», теперь просто всегда показывает
 * результат — и это самое заметное следствие переноса расчёта в браузер.
 */

const ABSENCE_KINDS = Object.keys(ABSENCE_LABELS) as AbsenceKind[];
const CALLOUT_KINDS = Object.keys(CALLOUT_LABELS) as CalloutKind[];

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
  const [statutory, setStatutory] = useState<StatutoryChoice>({
    kind: widest,
    index: 0,
  });
  // Месяц хранится отдельно от периода, а не вместо него: это уточнение
  // поверх выбранного периода, и `null` значит «весь период». Раньше это
  // было одно поле с двумя режимами, и выбор месяца стирал выбранный
  // период — вернуться к нему можно было, только вспомнив, какой он был.
  const [month, setMonth] = useState<number | null>(null);

  const { periodStart, periodEnd } =
    month === null
      ? statutoryBounds(profile.accountingYear, statutory.kind, statutory.index)
      : monthBounds(profile.accountingYear, month);

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
    <div className="lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start lg:gap-8 xl:grid-cols-[21rem_minmax(0,1fr)]">
      {/* Ручки управления. Закреплены и прокручиваются внутри себя: с
          длинной оговоркой про оклад колонка бывает выше экрана, и без
          собственной прокрутки её низ стал бы недостижим. */}
      <aside
        aria-label="Что показывать"
        className={cn(
          "mb-10 space-y-6 lg:mb-0",
          "lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:pb-6 lg:pr-1",
        )}
      >
        <div className="space-y-5 rounded-xl border border-rule bg-paper-raised p-4">
          <PeriodPicker
            accountingYear={profile.accountingYear}
            employmentKind={profile.employmentKind}
            periods={periods}
            statutory={statutory}
            month={month}
            onStatutory={(choice) => {
              setStatutory(choice);
              // Месяц сбрасывается вместе с периодом: он выбирался из
              // месяцев прежнего периода и в новый может не входить.
              setMonth(null);
            }}
            onMonth={setMonth}
          />
        </div>

        {/* Деньги — тоже ручка: сумма меняется от одного введённого числа
            и от выбранного выше периода. */}
        <div className="space-y-4 rounded-xl border border-rule bg-paper-raised p-4">
          <h2 className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
            Сколько это в деньгах
          </h2>
          <OvertimePayCard
            profile={profile}
            calculation={calculation}
            pay={pay}
            onChange={onChange}
          />
        </div>
      </aside>

      <div className="min-w-0 space-y-10">
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
          <Select
            id={kindId}
            value={kind}
            onChange={(event) => setKind(event.target.value as AbsenceKind)}
            className="w-56"
          >
            {ABSENCE_KINDS.map((option) => (
              <option key={option} value={option}>
                {ABSENCE_LABELS[option]}
              </option>
            ))}
          </Select>
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
          <Select
            id={kindId}
            value={kind}
            onChange={(event) => setKind(event.target.value as CalloutKind)}
            className="w-56"
          >
            {CALLOUT_KINDS.map((option) => (
              <option key={option} value={option}>
                {CALLOUT_LABELS[option]}
              </option>
            ))}
          </Select>
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
