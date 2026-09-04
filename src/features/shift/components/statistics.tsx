"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils/cn";

import { formatHoursTrim as hoursTrim, numberWord, shiftsWord } from "../domain/decimal";
import { MONTH_NAMES } from "./month-names";
import { ABSENCE_MARK, ABSENCE_TONE } from "./day-marks";
import { ABSENCE_LABELS } from "../schemas";
import { statisticsOf, type MonthStat, type Statistics } from "../model/statistics";
import type { StoredProfile } from "../storage/profile";
import { BalanceChart, ColumnChart, ShareBar, type Column } from "./charts";

/**
 * Статистика года.
 *
 * --- Зачем она отдельно от полосы с числами -------------------------------
 *
 * Полоса наверху рабочего экрана отвечает на вопрос «сколько сейчас» и
 * обязана быть тонкой: она стоит над сеткой, ради которой человек и
 * пришёл. Всё, что не помещается в три числа, там показать нельзя — а
 * непоместившегося много, и оно ровно то, о чём спрашивают дальше первого
 * вопроса: в каком месяце ушёл в минус, сколько ночных набежало к осени,
 * что именно съело норму.
 *
 * --- Из чего она собрана --------------------------------------------------
 *
 * Из трёх ответов на три разных вопроса, и в этом порядке:
 *
 *  1. «Чем кончился год» — одно крупное число баланса и пять величин при
 *     нём. Рисунка здесь нет и быть не должно: одно значение — это плашка
 *     с числом, а не столбик.
 *  2. «Как шло» — два рисунка. Норма и факт по месяцам отвечают на вопрос
 *     «где недобрал», накопленный баланс — на вопрос «когда вышел в плюс».
 *     Третий рисунок, ночные часы, стоит отдельно, потому что величина у
 *     них другая: подсадить их к норме второй осью значило бы выдумать
 *     связь, которой в данных нет.
 *  3. «Из чего это вышло» — перечень освобождений и таблица по месяцам.
 *
 * Таблица внизу — не запасной путь для читалки, а обязательство: числа,
 * показанные цветом, обязаны быть доступны и без цвета. Зелёный на светлой
 * бумаге даёт 2,9:1 против трёх положенных, и таблица — то, чем это
 * возмещается.
 */

/** Короткое имя месяца для оси: «янв». Из общего списка, а не второй копией. */
const SHORT = MONTH_NAMES.map((name) => name.slice(0, 3).toLowerCase());

/**
 * Цвета рисунков — переменными темы, а не значениями.
 *
 * Иначе тёмная тема получила бы светлые столбцы: у приложения два набора
 * цветов, и выбирает между ними сам браузер по метке на корне. Здесь же
 * стоят ровно те переменные, какими подписан итог наверху: переработка
 * зелёная, недоработка сигнальная, ночные — цвета следа. Человек уже знает
 * их по рабочему экрану, и заводить рисункам свою палитру значило бы
 * заставить его выучить вторую.
 */
const TONE = {
  fact: "var(--fps-verify)",
  norm: "var(--fps-ink-faint)",
  night: "var(--fps-trace)",
  over: "var(--fps-verify)",
  under: "var(--fps-signal)",
};

function hours(value: number): string {
  return `${hoursTrim(value)} ч`;
}

/** Ось подписывается целыми: «160», а не «160,0». */
function axis(value: number): string {
  return String(Math.round(value));
}

export function Statistics({ profile }: { profile: StoredProfile }) {
  // Расчётов тринадцать — год и двенадцать месяцев, — и делать их заново
  // на каждую отрисовку окна незачем: пока профиль тот же, и числа те же.
  const stats = useMemo(() => statisticsOf(profile), [profile]);

  if (!stats.any) {
    return (
      <p className="rounded-xl bg-paper-raised px-4 py-3 text-sm text-ink-muted">
        За {stats.year} год считать нечего: выбранный год ещё не начался или
        целиком раньше начала отсчёта.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <Headline stats={stats} />
      <Trends stats={stats} />
      <Absences stats={stats} />
      <MonthTable stats={stats} />
    </div>
  );
}

/**
 * Чем кончился год: одно крупное число и пять при нём.
 *
 * Крупное ровно одно на всё окно. Два крупных числа рядом — это уже не
 * ответ, а выбор, который читатель должен сделать сам, не зная, какое из
 * них главное.
 */
function Headline({ stats }: { stats: Statistics }) {
  const { total } = stats;
  const over = total.overtimeHours;
  const under = total.undertimeHours;
  const positive = over.greaterThan(0);
  const balance = positive ? over : under;

  return (
    <section className="space-y-3">
      <div className="lit rounded-xl bg-paper-raised px-5 py-4">
        <p className="text-xs uppercase tracking-wide text-ink-muted">
          {positive ? "Переработка за год" : under.greaterThan(0) ? "Недоработка за год" : "Баланс за год"}
        </p>
        <p
          className={cn(
            "font-mono text-4xl font-semibold leading-tight sm:text-5xl",
            positive && "text-verify",
            under.greaterThan(0) && "text-signal",
          )}
        >
          {hours(balance.toNumber())}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Отработано {hours(total.actualHours.toNumber())} при норме{" "}
          {hours(total.normHours.toNumber())}
          {total.excludedHours.greaterThan(0)
            ? `; из нормы года исключено ${hours(total.excludedHours.toNumber())}`
            : ""}
          .
        </p>
      </div>

      {/* Пять величин в ряд плашками, а не рисунком: это разные величины,
          а не одна в разрезе, и сравнивать их между собой не нужно. */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label="Норма года" value={hours(total.normHours.toNumber())} />
        <Tile label="Отработано" value={hours(total.actualHours.toNumber())} />
        <Tile
          label="Ночные"
          value={hours(total.nightHours.toNumber())}
          note="с 22 до 6 часов"
        />
        <Tile
          label="Праздничные"
          value={hours(total.holidayHours.toNumber())}
          note="в нерабочие праздничные дни"
        />
        <Tile
          label="Смены"
          value={`${total.workedShifts} ${shiftsWord(total.workedShifts)}`}
          note={
            total.absentShifts > 0
              ? `${total.absentShifts} ${numberWord(total.absentShifts, "пропущена", "пропущено", "пропущено")} по графику`
              : `по графику ${total.scheduledShifts}`
          }
        />
        <Tile
          label="Рабочих дней в году"
          value={String(total.calendar.workingDays)}
          note={`предпраздничных ${total.calendar.preHolidayDays}`}
        />
      </dl>
    </section>
  );
}

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl bg-paper-raised px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      {/* Крупное число набирается обычными цифрами, а не табличными:
          табличные дают каждой цифре ширину нуля, и «121» на таком кегле
          рассыпается. Табличные — ниже, в таблице, где столбцы. */}
      <dd className="font-mono text-lg font-medium leading-tight">{value}</dd>
      {note ? <p className="text-[11px] text-ink-faint">{note}</p> : null}
    </div>
  );
}

/** Как шло: три рисунка по месяцам. */
function Trends({ stats }: { stats: Statistics }) {
  const normFact: Column[] = stats.months.map((it) => ({
    label: SHORT[it.month]!,
    title: MONTH_NAMES[it.month]!,
    value: it.empty ? null : it.actualHours.toNumber(),
    target: it.empty ? null : it.normHours.toNumber(),
    readout: it.empty
      ? [{ what: "ещё не наступил", value: "—" }]
      : [
          { what: "отработано", value: hours(it.actualHours.toNumber()) },
          { what: "норма", value: hours(it.normHours.toNumber()) },
        ],
  }));

  const running: Column[] = stats.months.map((it, index) => ({
    label: SHORT[it.month]!,
    title: MONTH_NAMES[it.month]!,
    value: stats.running[index]!.toNumber(),
    readout: [
      { what: "накоплено", value: hours(stats.running[index]!.toNumber()) },
      { what: "за месяц", value: it.empty ? "—" : hours(it.balance.toNumber()) },
    ],
  }));

  const night: Column[] = stats.months.map((it) => ({
    label: SHORT[it.month]!,
    title: MONTH_NAMES[it.month]!,
    value: it.empty ? null : it.nightHours.toNumber(),
    readout: it.empty
      ? [{ what: "ещё не наступил", value: "—" }]
      : [
          { what: "ночные", value: hours(it.nightHours.toNumber()) },
          { what: "праздничные", value: hours(it.holidayHours.toNumber()) },
        ],
  }));

  const anyNight = stats.months.some((it) => it.nightHours.greaterThan(0));

  return (
    <div className="space-y-8">
      <ColumnChart
        title="Норма и факт по месяцам"
        note="Норма считается по производственному календарю и от графика смен не зависит. Столбец ниже своей черты — месяц, в котором недобрано."
        columns={normFact}
        bar={{ name: "Отработано", colour: TONE.fact, shape: "bar" }}
        target={{ name: "Норма месяца", colour: TONE.norm, shape: "tick" }}
        format={axis}
      />

      <BalanceChart
        title="Как копится баланс"
        note="Разница между фактом и нормой, сложенная от января. Выше черты — переработка, ниже — недоработка; итог года — правая точка."
        columns={running}
        format={axis}
        over={TONE.over}
        under={TONE.under}
      />

      {anyNight ? (
        <ColumnChart
          title="Ночные часы по месяцам"
          note="Часы смен, пришедшиеся на время с 22 до 6 (ст. 96 ТК РФ). Праздничные часы — в подписи при наведении и в таблице ниже."
          columns={night}
          bar={{ name: "Ночные", colour: TONE.night, shape: "bar" }}
          format={axis}
        />
      ) : null}
    </div>
  );
}

/**
 * Из чего вышла норма: что и на сколько её уменьшило.
 *
 * Цвет здесь несёт КЛЕТКА при названии — та самая, какой этот вид стоит на
 * сетке, — а полоски у всех видов одинаковые. Раскрасить полоски по видам
 * значило бы завести семь серий, которые надо различать на глаз: счётом их
 * цвета для такой роли не годятся (пара «доп. отпуск» и «отгул» расходится
 * всего на 3,6 при восьми положенных), а различать их и не требуется —
 * имя написано рядом.
 */
function Absences({ stats }: { stats: Statistics }) {
  const { absences, total } = stats;
  if (absences.length === 0) {
    return (
      <section className="space-y-2">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide">
          Освобождения
        </h3>
        <p className="text-xs text-ink-muted">
          За год не отмечено ни одного: норма года не уменьшалась.
        </p>
      </section>
    );
  }

  const most = Math.max(...absences.map((it) => it.days));

  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide">
          Освобождения
        </h3>
        <p className="text-xs text-ink-muted">
          Часы смен, попавших в эти дни, из нормы исключаются (письмо Роструда
          от 01.03.2010 № 550-6-1). Всего за год —{" "}
          {hours(total.excludedHours.toNumber())}.
        </p>
      </div>

      <ul className="divide-y divide-rule rounded-xl bg-paper-raised px-4">
        {absences.map((it) => (
          <li key={it.kind} className="flex items-center gap-3 py-2.5">
            <span
              aria-hidden
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center border font-mono text-[11px]",
                ABSENCE_TONE[it.kind],
              )}
            >
              {ABSENCE_MARK[it.kind]}
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="truncate text-sm">{ABSENCE_LABELS[it.kind]}</span>
                <span className="font-mono text-xs tabular-nums text-ink-muted">
                  {it.days} {numberWord(it.days, "день", "дня", "дней")}
                  {/* Отгул норму не уменьшает — он расплачивается уже
                      накопленной переработкой, — и приписывать ему снятые
                      часы нечем. Строка о нём просто короче. */}
                  {it.hours !== null && it.hours.greaterThan(0)
                    ? ` · −${hours(it.hours.toNumber())} из нормы`
                    : ""}
                </span>
              </span>
              <ShareBar share={it.days / most} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Таблица по месяцам.
 *
 * Она здесь не «для полноты»: всё, что нарисовано выше, обязано читаться и
 * без цвета — и потому, что цвет столбца на светлой бумаге не дотягивает
 * до трёх к одному, и потому, что число в таблице можно переписать в
 * заявление, а число на рисунке нельзя.
 *
 * Прокручивается она вбок сама, внутри своей коробки: двенадцать строк на
 * семь столбцов в узкий экран не влезут никак, а страница ездить вбок не
 * должна.
 */
function MonthTable({ stats }: { stats: Statistics }) {
  const shown = stats.months.filter((it) => !it.empty);

  return (
    <section className="space-y-2">
      <h3 className="font-display text-sm font-bold uppercase tracking-wide">
        По месяцам
      </h3>
      <div className="overflow-x-auto rounded-xl bg-paper-raised">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <caption className="sr-only">
            Норма, отработанные, ночные и праздничные часы по месяцам {stats.year}{" "}
            года
          </caption>
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-ink-faint">
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Месяц
              </th>
              <Head>Норма</Head>
              <Head>Факт</Head>
              <Head>Баланс</Head>
              <Head>Ночные</Head>
              <Head>Празд.</Head>
              <Head>Смены</Head>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {shown.map((it) => (
              <Row key={it.month} month={it} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-rule-strong font-medium">
              <th scope="row" className="px-4 py-2 text-left">
                За год
              </th>
              <Cell>{hoursTrim(stats.total.normHours)}</Cell>
              <Cell>{hoursTrim(stats.total.actualHours)}</Cell>
              <Cell
                tone={
                  stats.total.overtimeHours.greaterThan(0)
                    ? "over"
                    : stats.total.undertimeHours.greaterThan(0)
                      ? "under"
                      : undefined
                }
              >
                {signed(
                  stats.total.actualHours.minus(stats.total.normHours).toNumber(),
                )}
              </Cell>
              <Cell>{hoursTrim(stats.total.nightHours)}</Cell>
              <Cell>{hoursTrim(stats.total.holidayHours)}</Cell>
              <Cell>{stats.total.workedShifts}</Cell>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-ink-muted">
        Часы — за календарные сутки месяца, а не за смены, начавшиеся в нём:
        смена с 31-го отдаёт свой хвост следующему месяцу, как и в табеле.
        Сумма месячных норм может на час-другой разойтись с нормой года — она
        считается по отрезку целиком (ст. 104 ТК РФ), а не сложением.
      </p>
    </section>
  );
}

function Head({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-3 py-2 text-right font-medium">
      {children}
    </th>
  );
}

function Cell({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "over" | "under";
}) {
  return (
    <td
      className={cn(
        "px-3 py-2 text-right font-mono tabular-nums",
        tone === "over" && "text-verify",
        tone === "under" && "text-signal",
      )}
    >
      {children}
    </td>
  );
}

/** Со знаком: «+24» и «−16». Минус — типографский, как и везде в числах. */
function signed(value: number): string {
  if (value === 0) return "0";
  const text = hoursTrim(Math.abs(value));
  return value > 0 ? `+${text}` : `−${text}`;
}

function Row({ month }: { month: MonthStat }) {
  const balance = month.balance.toNumber();
  return (
    <tr>
      <th scope="row" className="px-4 py-2 text-left font-normal">
        {MONTH_NAMES[month.month]}
      </th>
      <Cell>{hoursTrim(month.normHours)}</Cell>
      <Cell>{hoursTrim(month.actualHours)}</Cell>
      <Cell tone={balance > 0 ? "over" : balance < 0 ? "under" : undefined}>
        {signed(balance)}
      </Cell>
      <Cell>{hoursTrim(month.nightHours)}</Cell>
      <Cell>{hoursTrim(month.holidayHours)}</Cell>
      <Cell>{month.workedShifts}</Cell>
    </tr>
  );
}
