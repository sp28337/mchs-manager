"use client";

import {
  Banknote,
  CalendarMinus2,
  CalendarRange,
  ClipboardCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Siren,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  CollapsiblePanel,
  CollapsibleSection,
} from "@/components/shared/collapsible-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";
import { formatHours, parseHours } from "../domain/decimal";
import { formatDateRu, formatPeriodRu } from "../domain/format";
import { formatMoney } from "../domain/overtime-pay";
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
import { YearView, type YearViewKind } from "./year-view";

/**
 * Рабочий экран: период, расчёт, график, отсутствия и сверка.
 *
 * Всё на одной странице намеренно. Человек сверяет бумажный табель за
 * один месяц, и разносить норму, график и расхождения по вкладкам значило
 * бы заставить его держать числа в голове, переходя между ними, — ровно в
 * тот момент, когда важна точность.
 *
 * --- Что стоит в боковой колонке и почему именно это --------------------
 *
 * Слева — ВВОД, справа — ВЫВОД. Слева человек говорит приложению, что он
 * знает: какой период смотрим, какой у него оклад, когда он был в отпуске,
 * куда его вызывали и что написано в выданном табеле. Справа приложение
 * отвечает: вот норма, вот график, вот производственный календарь.
 *
 * Раньше и то и другое стояло одной лентой сверху вниз, и это стоило
 * человеку прокрутки на каждом шаге: чтобы посмотреть тот же график за
 * соседний месяц, приходилось листать двенадцать календарных сеток вверх,
 * переключать и листать обратно; чтобы внести отпуск и увидеть, как
 * изменилась норма, — то же самое в другую сторону.
 *
 * Колонка закреплена, поэтому ввод и его последствие видны одновременно:
 * внесённый отпуск сразу меняет норму справа, и человеку не нужно
 * запоминать, сколько было до.
 *
 * Ниже `lg` колонки нет: на телефоне она встала бы над содержимым, и это
 * была бы прежняя раскладка, только уже.
 *
 * --- Почему все блоки колонки сворачиваются ------------------------------
 *
 * Их пять, и развёрнутыми они не помещаются ни в один экран. Открытым
 * держится только то, что нужно всегда: период и сумма. Остальное человек
 * открывает, когда вносит, — а свёрнутая крышка при этом отвечает на свой
 * вопрос без раскрытия («внесено периодов: 3», «расхождений нет»).
 *
 * --- Почему колонку можно убрать целиком ---------------------------------
 *
 * График на год и двенадцать календарных сеток — самое широкое, что есть
 * на экране, и девятнадцать рем слева им мешают. Но убрать колонку совсем
 * значило бы спрятать вход в неё: человек, свернувший её ради календаря,
 * должен видеть, куда нажать, чтобы вернуться к отпускам.
 *
 * Поэтому она сворачивается не в ничто, а в полоску значков. Значок в
 * полоске — тот же, что в заголовке блока, и нажатие на него делает сразу
 * два дела: возвращает колонку и открывает именно этот блок. Иначе
 * человек, нажавший на сирену, получил бы развёрнутую колонку и всё тот же
 * закрытый блок вызовов.
 *
 * Свёрнутость — состояние экрана, а не данных, и в профиль не пишется:
 * человек сворачивает колонку на время, пока смотрит календарь.
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

/**
 * Блоки боковой колонки.
 *
 * Список объявлен один раз, потому что читается дважды: заголовками в
 * развёрнутой колонке и значками в свёрнутой полоске. Разойдись эти два
 * места — и полоска перестала бы отвечать на вопрос «где здесь вызовы».
 *
 * Значки выбраны по смыслу, а не по красоте: диапазон дат у периода,
 * купюра у денег, календарь с минусом у отсутствий (они вычитаются из
 * нормы), сирена у вызовов, планшет с галочкой у сверки.
 */
type PanelId = "period" | "pay" | "absences" | "callouts" | "reconcile";

const PANEL_META: Record<PanelId, { title: string; Icon: LucideIcon }> = {
  period: { title: "Период", Icon: CalendarRange },
  pay: { title: "Сколько это в деньгах", Icon: Banknote },
  absences: { title: "Отпуска и больничные", Icon: CalendarMinus2 },
  callouts: { title: "Вызовы помимо графика", Icon: Siren },
  reconcile: { title: "Что написано в вашем табеле", Icon: ClipboardCheck },
};

/**
 * Порядок значков в свёрнутой полоске.
 *
 * Здесь перечислены только те блоки, которые реально показываются: значок
 * в полоске обязан куда-то вести, а нажатие на значок выключенного блока
 * развернуло бы колонку и не открыло ничего. Сейчас снаружи оставлена
 * сверка — она выключена в разметке ниже.
 */
const PANEL_ORDER: readonly PanelId[] = ["period", "pay", "absences", "callouts"];

/** Опознаватель блока в разметке: по нему в блок уводится фокус. */
const panelDomId = (id: PanelId) => `aside-panel-${id}`;

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

  // Что показано на сетке года. Живёт здесь, а не в самой сетке, потому
  // что от этого зависят заголовок и подпись раздела вокруг неё.
  const [yearView, setYearView] = useState<YearViewKind>("shifts");

  const [collapsed, setCollapsed] = useState(false);
  const [openPanels, setOpenPanels] = useState<Record<PanelId, boolean>>({
    period: true,
    pay: true,
    absences: false,
    callouts: false,
    reconcile: false,
  });

  // Куда увести фокус после разворота колонки из полоски. Само по себе
  // открытие блока фокус не двигает, и человек с клавиатуры остался бы на
  // кнопке, которой на экране больше нет.
  //
  // Ссылка, а не состояние: намерение живёт от нажатия до ближайшей
  // отрисовки и ни на что не влияет, кроме одного вызова `focus`.
  // Состоянием оно потребовало бы сброса — то есть ещё одной отрисовки
  // ради ничего.
  const aside = useRef<HTMLElement>(null);
  const pendingFocus = useRef<PanelId | null>(null);

  useEffect(() => {
    if (collapsed) return;
    const id = pendingFocus.current;
    if (id === null) return;
    pendingFocus.current = null;

    const summary = aside.current?.querySelector<HTMLElement>(
      `#${panelDomId(id)} > summary`,
    );
    summary?.focus();
    summary?.scrollIntoView({ block: "nearest" });
  }, [collapsed]);

  function openFromRail(id: PanelId) {
    pendingFocus.current = id;
    setCollapsed(false);
    setOpenPanels((previous) => ({ ...previous, [id]: true }));
  }

  function panelProps(id: PanelId) {
    return {
      id: panelDomId(id),
      title: PANEL_META[id].title,
      icon: <PanelIcon id={id} />,
      open: openPanels[id],
      onOpenChange: (next: boolean) =>
        setOpenPanels((previous) => ({ ...previous, [id]: next })),
    };
  }

  return (
    <div
      className={cn(
        "lg:grid lg:items-start lg:gap-8",
        collapsed
          ? "lg:grid-cols-[3.25rem_minmax(0,1fr)]"
          : "lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]",
      )}
    >
      {/* Ручки управления. Закреплены и прокручиваются внутри себя: с
          длинной оговоркой про оклад колонка бывает выше экрана, и без
          собственной прокрутки её низ стал бы недостижим.

          Полоска и сами блоки существуют в разметке одновременно, а
          показывается одно из двух — классами. Ниже `lg` колонки нет
          вовсе, и сворачивать там нечего: полоска значков поперёк
          телефона была бы лишней строкой ни о чём, поэтому в узком окне
          блоки видны всегда, а полоска — никогда. */}
      <aside
        ref={aside}
        aria-label="Что вы вносите"
        className={cn(
          "mb-10 lg:mb-0",
          "lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:pb-6",
          collapsed ? "lg:overflow-x-hidden" : "lg:pr-1",
        )}
      >
        {collapsed ? (
          <div className="hidden flex-col items-center gap-1 rounded-xl border border-rule bg-paper-raised p-1.5 lg:flex">
            <RailButton
              label="Развернуть панель"
              onClick={() => setCollapsed(false)}
            >
              <PanelLeftOpen aria-hidden className="size-4" />
            </RailButton>
            <span aria-hidden className="my-1 h-px w-6 bg-rule" />
            {PANEL_ORDER.map((id) => {
              const { title, Icon } = PANEL_META[id];
              return (
                <RailButton key={id} label={title} onClick={() => openFromRail(id)}>
                  <Icon aria-hidden className="size-4" />
                </RailButton>
              );
            })}
          </div>
        ) : null}

        <div className={cn("space-y-3", collapsed && "lg:hidden")}>
          {/* Кнопка сворачивания стоит над блоками и вплотную к правому
              краю колонки — там, куда она колонку и уводит. Ниже `lg`
              скрыта: там нет колонки, которую можно свернуть. */}
          <div className="hidden justify-end lg:flex">
            <RailButton label="Свернуть панель" onClick={() => setCollapsed(true)}>
              <PanelLeftClose aria-hidden className="size-4" />
            </RailButton>
          </div>

        <CollapsiblePanel
          {...panelProps("period")}
          summary={formatPeriodRu(periodStart, periodEnd)}
        >
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
        </CollapsiblePanel>

        {/* Открыт по умолчанию, как и период: сумма — это ответ, а не
            ввод, и прятать её за крышкой значило бы вернуть человека к
            тому, чтобы искать её щелчком. */}
        <CollapsiblePanel
          {...panelProps("pay")}
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
        </CollapsiblePanel>

        <CollapsiblePanel
          {...panelProps("absences")}
          hint={
            <>
              Внесите периоды, когда вы были освобождены от службы с
              сохранением места. Смены, попавшие в них, вычтутся из НОРМЫ —
              именно этого чаще всего и не делают в табеле.
            </>
          }
          summary={
            profile.absences.length > 0
              ? `внесено периодов: ${profile.absences.length}`
              : "не внесено"
          }
        >
          <AbsenceSection profile={profile} onChange={onChange} />
        </CollapsiblePanel>

        <CollapsiblePanel
          {...panelProps("callouts")}
          hint={
            <>
              Соревнования, сборы, резерв, праздничные мероприятия, выборы.
              Это исполнение обязанностей, то есть служебное время (ч. 1
              ст. 54 ФЗ-141, ст. 91 ТК РФ): часы прибавляются к
              отработанному и норму не трогают. На графике такие сутки
              помечены отдельно — видно, куда именно вызывали.
              <span className="mt-2 block">
                Вызовов на одни сутки может быть несколько: после смены
                соревнования, а следом резерв. Вносите каждый отдельно —
                часы складываются, а в клетке графика встанут все коды
                сразу.
              </span>
            </>
          }
          summary={
            profile.callouts.length > 0
              ? `внесено: ${profile.callouts.length}`
              : "не внесено"
          }
        >
          <CalloutSection profile={profile} onChange={onChange} />
        </CollapsiblePanel>

        {/* Блок сверки выключен. Если он возвращается — раскомментировать
            здесь и добавить "reconcile" обратно в PANEL_ORDER, иначе в
            свёрнутой полоске появится значок, ведущий в никуда.

        <CollapsiblePanel
          {...panelProps("reconcile")}
          hint={
            <>
              Впишите числа из выданного табеля. Пустое поле не
              сравнивается — если какого-то числа в табеле нет, оставьте
              его пустым.
            </>
          }
          summary={
            discrepancies === null
              ? "сверка не проводилась"
              : discrepancies.length === 0
                ? "расхождений нет"
                : `расхождений: ${discrepancies.length}`
          }
        >
          <ReconcileSection discrepancies={discrepancies} onSubmit={setReportedRaw} />
        </CollapsiblePanel>

        */}
        </div>
      </aside>

      <div className="min-w-0 space-y-10">
      <header className="space-y-1">
        <h1 className="text-3xl leading-tight">{profile.displayName}</h1>
      </header>
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

      {/* Один раздел на обе сетки: они показывают одно и то же поле —
          месяцы клетками по дням недели, — и человек смотрит их по
          очереди, сверяя смену с типом дня. Двумя разделами это означало
          прокрутку между ними; переключателем — то же место на экране.

          Заголовок и подпись следуют за переключателем: раздел называет
          то, что в нём сейчас показано, а не оба варианта сразу. */}
      <CollapsibleSection
        title={
          yearView === "shifts"
            ? "Ваш график"
            : `Производственный календарь ${profile.accountingYear} года`
        }
        summary={
          yearView === "shifts"
            ? `смен за период: ${calculation.scheduledShifts}`
            : Object.keys(profile.calendarOverrides).length > 0
              ? `ваших правок: ${Object.keys(profile.calendarOverrides).length}`
              : pendingTransfers(profile.accountingYear).length > 0
                ? "переносы выходных не размечены"
                : "праздники и переносы размечены"
        }
        defaultOpen
      >
        <YearView
          profile={profile}
          calculation={calculation}
          view={yearView}
          onViewChange={setYearView}
          onChange={onChange}
        />
      </CollapsibleSection>

        <ProfileFooter profile={profile} onForget={onForget} />
      </div>
    </div>
  );
}

/** Значок блока — тот же в заголовке и в свёрнутой полоске. */
function PanelIcon({ id }: { id: PanelId }) {
  const { Icon } = PANEL_META[id];
  return <Icon aria-hidden />;
}

/**
 * Кнопка в полоске значков и кнопка сворачивания колонки.
 *
 * Подпись обязательна и живёт в двух местах сразу: `aria-label` — для
 * программы чтения, `title` — для всплывающей подсказки браузера. В
 * свёрнутой полоске на экране нет ни одного слова, и без второй человек,
 * не узнавший значок, остаётся гадать.
 */
function RailButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg",
        "text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",
      )}
    >
      {children}
    </button>
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
    <section aria-labelledby="absences" className="space-y-3">
      {error ? (
        <p className="rounded-sm border-l-2 border-signal bg-signal-soft px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      {/* Поля стоят столбиком, а не строкой: в боковой колонке строка из
          четырёх полей всё равно переносится, но переносится как попало —
          то по два, то по три, в зависимости от длины подписи. */}
      <form
        className="space-y-3 rounded-sm border border-rule bg-paper p-3"
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
          >
            {ABSENCE_KINDS.map((option) => (
              <option key={option} value={option}>
                {ABSENCE_LABELS[option]}
              </option>
            ))}
          </Select>
          {/* Отгул работает не так, как остальные виды, и человек обязан
              это увидеть до того, как внесёт период. */}
          <p className="text-xs text-ink-muted" aria-live="polite">
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
        <Button type="submit" variant="outline" className="w-full">
          Добавить
        </Button>
      </form>

      {absences.length > 0 ? (
        <ul className="divide-y divide-rule border-y border-rule">
          {absences.map((absence) => (
            <li key={absence.id} className="space-y-0.5 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">
                  {ABSENCE_LABELS[absence.kind]}
                </span>
                <button
                  type="button"
                  className="shrink-0 cursor-pointer text-xs text-ink-muted underline underline-offset-2 hover:text-signal"
                  onClick={() =>
                    onChange((previous) => ({
                      ...previous,
                      absences: previous.absences.filter((item) => item.id !== absence.id),
                    }))
                  }
                >
                  Удалить
                </button>
              </div>
              <p className="font-mono text-xs">
                {formatDateRu(absence.startsOn)} — {formatDateRu(absence.endsOn)}
              </p>
              <p className="text-xs text-ink-muted">
                {ABSENCE_KIND_BASIS[absence.kind]}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-muted">Периодов отсутствия не внесено.</p>
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
    <section className="space-y-3">
      {error ? (
        <p className="rounded-sm border-l-2 border-signal bg-signal-soft px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      <form
        className="space-y-3 rounded-sm border border-rule bg-paper p-3"
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
        <Button type="submit" variant="outline" className="w-full">
          Добавить
        </Button>
      </form>

      {callouts.length > 0 ? (
        <ul className="divide-y divide-rule border-y border-rule">
          {callouts.map((callout) => (
            <li key={callout.id} className="space-y-0.5 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">
                  {CALLOUT_LABELS[callout.kind]}
                </span>
                <button
                  type="button"
                  className="shrink-0 cursor-pointer text-xs text-ink-muted underline underline-offset-2 hover:text-signal"
                  onClick={() =>
                    onChange((previous) => ({
                      ...previous,
                      callouts: previous.callouts.filter((item) => item.id !== callout.id),
                    }))
                  }
                >
                  Удалить
                </button>
              </div>
              <p className="font-mono text-xs">
                {formatDateRu(callout.startsOn)} — {formatDateRu(callout.endsOn)}
                <span className="ml-2 text-trace">
                  {formatHours(callout.hoursPerDay)} ч/сут
                </span>
              </p>
              <p className="text-xs text-ink-muted">
                {CALLOUT_KIND_BASIS[callout.kind]}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-muted">Вызовов не внесено.</p>
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
    <section aria-labelledby="reconcile" className="space-y-3">
      <form
        className="space-y-3 rounded-sm border border-rule bg-paper p-3"
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
        <Button type="submit" className="w-full">
          Сверить
        </Button>
      </form>

      {discrepancies !== null ? (
        discrepancies.length === 0 ? (
          <p className="rounded-sm border-l-2 border-verify bg-verify-soft px-3 py-2 text-xs">
            Расхождений нет: табель сходится с расчётом. Это тоже результат —
            значит, за этот период вопросов к работодателю нет.
          </p>
        ) : (
          <ul className="space-y-2">
            {discrepancies.map((item) => (
              <li
                key={item.field}
                className={cn(
                  "space-y-1 rounded-sm border-l-2 px-3 py-2",
                  item.favoursEmployer
                    ? "border-signal bg-signal-soft"
                    : "border-rule-strong bg-paper-sunken",
                )}
              >
                <p className="text-sm font-medium">
                  {item.label}: у вас в табеле{" "}
                  <span className="font-mono">{formatHours(item.reported)}</span> ч, по
                  расчёту <span className="font-mono">{formatHours(item.expected)}</span> ч
                  <span className="ml-2 font-mono">
                    ({item.delta.greaterThan(0) ? "+" : ""}
                    {formatHours(item.delta)} ч)
                  </span>
                </p>
                <p className="text-xs">{item.explanation}</p>
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
        <p className="text-xs text-ink-muted">
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
        className="w-full font-mono"
      />
    </div>
  );
}
