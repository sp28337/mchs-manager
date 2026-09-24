"use client";

import { useMemo, useState } from "react";

import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { cn } from "@/lib/utils/cn";

import {
  ZERO,
  formatHoursTrim as hoursTrim,
  numberWord,
  shiftsWord,
  type Decimal,
} from "../domain/decimal";
import { MONTH_NAMES } from "./month-names";
import { ABSENCE_MARK, ABSENCE_TONE, CALLOUT_MARK, CALLOUT_TONE } from "./day-marks";
import { ABSENCE_LABELS, CALLOUT_LABELS } from "../schemas";
import {
  statisticsOf,
  totalsOf,
  type MonthStat,
  type ProfileTotals,
  type Statistics,
} from "../model/statistics";
import { readEntryProfile } from "../storage/library";
import type { StoredProfile } from "../storage/profile";
import { BalanceChart, ColumnChart, ShareBar, type Column } from "./charts";
import { useLibrary } from "./profile-explorer";

/**
 * Статистика года — разделом страницы, на месте графика.
 *
 * Показывает её `workspace.tsx` тем же порядком, что настройки и
 * проводник: кнопка в шапке подменяет содержимое страницы и сама же его
 * закрывает. Окном поверх графика она была ровно до тех пор, пока не
 * выяснилось, что окно закрывает собой источник собственных чисел, —
 * доводы целиком там, у `statsOpen`.
 *
 * Отсюда и строй: разделы стоят плашками поднятой бумаги (`PLATE`), как
 * карточки настроек и плитки проводника, а не сплошной лентой, как было
 * внутри окна.
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
 *  1. «Чем кончился год» — одно крупное число баланса и шесть величин
 *     при нём. Рисунка здесь нет и быть не должно: одно значение — это
 *     число, а не столбик.
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

/**
 * Плашка раздела: поднятая бумага со светом по кромке.
 *
 * Статистика стоит НА СТРАНИЦЕ, на месте графика (`workspace.tsx`), а не
 * окном поверх неё, и строй у неё тот же, что у проводника и настроек:
 * разделы — плашки на бумаге, а не куски сплошной ленты. Плашек ровно
 * столько, сколько вопросов: чем кончился год, как шло (по рисунку на
 * каждый), из чего вышло, и таблица.
 *
 * `lit` — плашка ловит свет лампы: блик по верхней кромке, мягкая тень
 * вниз и кайма под курсором. Забирает их ближайшая к указателю
 * поверхность, и потому внутри плашки второго `lit` быть не должно —
 * иначе кромка самой плашки гасла бы, стоило подвести курсор к числу.
 * В окне всё было наоборот: там поднятой бумагой было само окно, и
 * плашки внутри читались коробкой в коробке.
 */
const PLATE = "lit rounded-xl bg-paper-raised p-4 sm:p-5";

function hours(value: number): string {
  return `${hoursTrim(value)} ч`;
}

/** Ось подписывается целыми: «160», а не «160,0». */
function axis(value: number): string {
  return String(Math.round(value));
}

/**
 * Один профиль в переключателе: кого показывать и чем он назван.
 *
 * Снимок, а не ссылка на запись: профиль читается из хранилища один раз на
 * перечень, и дальше с ним работают как с данными. У ОТКРЫТОГО профиля
 * берётся не снимок, а то, что сейчас на странице: правка попадает в
 * запись сразу (`syncActiveIntoLibrary`), но взять живой объект и дешевле,
 * и честнее — числа в статистике обязаны совпадать с полосой наверху в ту
 * же секунду.
 */
interface Sheet {
  id: string;
  name: string;
  profile: StoredProfile;
  /** Тот самый профиль, что сейчас открыт на странице. */
  open: boolean;
}

/** Запись открытого профиля, если её в проводнике почему-то нет. */
const LOOSE = "\u0000open";

function useSheets(open: StoredProfile): Sheet[] {
  const { library, activeId } = useLibrary();

  return useMemo(() => {
    const sheets: Sheet[] = [];
    for (const entry of library.entries) {
      const mine = entry.id === activeId;
      // Запись, которая не читается (битый снимок, отнятое хранилище), —
      // не ноль в своде, а отсутствие строки: приписать человеку нулевую
      // норму значило бы соврать о нём, а не промолчать.
      const it = mine ? open : readEntryProfile(entry.id);
      if (it === null) continue;
      sheets.push({
        id: entry.id,
        // Имя берётся из самого снимка, а не из записи: запись помнит имя
        // на миг последней правки, а переименование живёт в профиле.
        name: it.displayName.trim() === "" ? entry.name : it.displayName,
        profile: it,
        open: mine,
      });
    }

    // Порядок по имени, а не по времени правки: переключатель читают
    // глазами, ища своё, и список, перестраивающийся от каждой правки,
    // заставлял бы искать заново.
    sheets.sort((a, b) => a.name.localeCompare(b.name, "ru"));

    // Открытый профиль обязан быть в переключателе всегда — даже если в
    // проводнике его записи ещё нет: он и есть то, на что человек смотрит.
    if (!sheets.some((it) => it.open)) {
      sheets.unshift({
        id: LOOSE,
        name: open.displayName.trim() === "" ? "Открытый профиль" : open.displayName,
        profile: open,
        open: true,
      });
    }

    return sheets;
  }, [library, activeId, open]);
}

/** Что показано: свод по всем профилям или один из них. */
type Scope = { kind: "all" } | { kind: "one"; id: string };

export function Statistics({ profile }: { profile: StoredProfile }) {
  const sheets = useSheets(profile);
  /**
   * Выбор человека — или его отсутствие.
   *
   * `null` значит «не выбирали», и это не то же самое, что выбранный
   * открытый профиль: открытый может смениться (его открыли из
   * проводника), и запомненный его идентификатор оставил бы человека на
   * чужой статистике. Пока выбора нет, показан тот, что открыт.
   */
  const [scope, setScope] = useState<Scope | null>(null);

  const mine = sheets.find((it) => it.open) ?? sheets[0]!;
  const all = scope?.kind === "all";
  // Выбранный профиль мог исчезнуть, пока статистика открыта (его удалили
  // в проводнике) — тогда показывается открытый, а не пустое место.
  const shown =
    scope?.kind === "one"
      ? (sheets.find((it) => it.id === scope.id) ?? mine)
      : mine;

  return (
    // Просвет между плашками — тот же, что между карточками настроек и
    // рядами проводника: разделы тут одного рода, и разводить их вдвое
    // шире значило бы сказать, что они с разных страниц.
    <div className="space-y-4">
      {/* Переключатель — только когда переключать есть на что. При одном
          профиле ряд из «Все» и его же имени предлагал бы выбор из одного
          и обещал бы свод, которого нет. */}
      {sheets.length > 1 ? (
        <ScopeBar
          sheets={sheets}
          all={all}
          shownId={shown.id}
          onAll={() => setScope({ kind: "all" })}
          onOne={(id) => setScope({ kind: "one", id })}
        />
      ) : null}

      {all ? (
        <AllProfiles sheets={sheets} onPick={(id) => setScope({ kind: "one", id })} />
      ) : (
        <OneProfile profile={shown.profile} />
      )}
    </div>
  );
}

/**
 * Чья статистика показана.
 *
 * Переключателем, а не списком и не выпадающим полем: положений немного,
 * они взаимоисключающие, и занятое из них видно, не открывая ничего, —
 * тот же строй, что у выбора вида сетки и учётного периода
 * (`ui/segmented.tsx`). Переносится по строкам: профилей может быть
 * сколько угодно, и уехать за край они не должны.
 */
function ScopeBar({
  sheets,
  all,
  shownId,
  onAll,
  onOne,
}: {
  sheets: readonly Sheet[];
  all: boolean;
  shownId: string;
  onAll: () => void;
  onOne: (id: string) => void;
}) {
  return (
    <Segmented
      label="Чья статистика"
      className="h-auto max-w-full flex-wrap justify-start gap-1 p-1 lg:flex-none lg:justify-start"
    >
      <SegmentedItem active={all} onClick={onAll} className="h-8 lg:flex-none">
        Все
        <span className="font-mono text-[11px] tabular-nums text-ink-faint">
          {sheets.length}
        </span>
      </SegmentedItem>
      {sheets.map((sheet) => (
        <SegmentedItem
          key={sheet.id}
          active={!all && sheet.id === shownId}
          onClick={() => onOne(sheet.id)}
          className="h-8 lg:flex-none"
        >
          {/* Точка у открытого профиля, а не слово «открыт»: слово стоило
              бы половины ширины плашки на каждом имени, а сказать нужно
              одно — который из них лежит сейчас на странице. */}
          {sheet.open ? (
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-verify" />
          ) : null}
          <span className="min-w-0 max-w-40 truncate">{sheet.name}</span>
          {sheet.open ? <span className="sr-only"> (открыт)</span> : null}
        </SegmentedItem>
      ))}
    </Segmented>
  );
}

/** Статистика одного профиля: год, разложенный на вопросы. */
function OneProfile({ profile }: { profile: StoredProfile }) {
  // Расчётов тринадцать — год и двенадцать месяцев, — и делать их заново
  // на каждую отрисовку незачем: пока профиль тот же, и числа те же.
  const stats = useMemo(() => statisticsOf(profile), [profile]);

  if (!stats.any) {
    return (
      // Пустой ответ — такой же плашкой, как у пустой папки в проводнике:
      // страница не должна выглядеть недогрузившейся.
      <p className={cn(PLATE, "text-center text-sm text-ink-muted")}>
        За {stats.year} год считать нечего: выбранный год ещё не начался или
        целиком раньше начала отсчёта.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Figures stats={stats} />
      <Trends stats={stats} />
      <Callouts stats={stats} />
      <Absences stats={stats} />
      <MonthTable stats={stats} />
    </div>
  );
}

/**
 * Год в числах — там, где их больше взять негде.
 *
 * --- Почему крупного числа здесь нет ---------------------------------------
 *
 * Было: крупная переработка за год, а при ней норма и факт. Ровно это, теми
 * же словами, стоит на полосе наверху страницы — она никуда не девается,
 * пока открыта статистика, и висит закреплённой над ней. Два ответа на один
 * вопрос в пределах одного экрана — это не «подчеркнули важное», это
 * заставили сверять, не разошлись ли они.
 *
 * --- Почему остальное показано только на узком экране ----------------------
 *
 * Полоса наверху показывает три главных числа всегда, а пять мелких —
 * смены, пропуски, ночные, праздничные — только с `lg`: ниже для них нет
 * ширины, и полоса их прячет (`period-summary.tsx`). Вот ровно там эта
 * плашка и нужна, и ровно там она и стоит.
 *
 * Спрятанное с `lg` при этом не пропадает: годовые числа целиком лежат в
 * строке «За год» таблицы по месяцам внизу — той самой, что существует,
 * чтобы всё нарисованное читалось и без цвета.
 */
function Figures({ stats }: { stats: Statistics }) {
  const { total } = stats;

  return (
    <section className={cn(PLATE, "space-y-2 lg:hidden")}>
      <h3 className="font-display text-sm font-bold uppercase tracking-wide">
        За {stats.year} год
      </h3>

      {/* Шесть величин в ряд числами, а не рисунком: это разные величины,
          а не одна в разрезе, и сравнивать их между собой не нужно. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
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
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  /** Цвет итога — только у баланса: плюс зелёный, минус сигнальный. */
  tone?: "over" | "under";
}) {
  return (
    // Своей плашки у величины нет: она стоит на общей, вместе с крупным
    // числом. Держит величины сетка и подпись под ними.
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      {/* Крупное число набирается обычными цифрами, а не табличными:
          табличные дают каждой цифре ширину нуля, и «121» на таком кегле
          рассыпается. Табличные — ниже, в таблице, где столбцы. */}
      <dd
        className={cn(
          "font-mono text-lg font-medium leading-tight",
          tone === "over" && "text-verify",
          tone === "under" && "text-signal",
        )}
      >
        {value}
      </dd>
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

  // Плашка на каждый рисунок, а не одна на три: вопросы у них разные —
  // «где недобрал», «когда вышел в плюс», «сколько ночных», — и общая
  // рамка вокруг троих читалась бы как один ответ в трёх частях. Класс
  // вешается снаружи, а не внутри `charts.tsx`: рисунки ничего не знают
  // про страницу, на которой стоят.
  return (
    <div className="space-y-4">
      <div className={PLATE}>
        <ColumnChart
          title="Норма и факт по месяцам"
          note="Норма считается по производственному календарю и от графика смен не зависит. Столбец ниже своей черты — месяц, в котором недобрано."
          columns={normFact}
          bar={{ name: "Отработано", colour: TONE.fact, shape: "bar" }}
          target={{ name: "Норма месяца", colour: TONE.norm, shape: "tick" }}
          format={axis}
        />
      </div>

      <div className={PLATE}>
        <BalanceChart
          title="Как копится баланс"
          note="Разница между фактом и нормой, сложенная от января. Выше черты — переработка, ниже — недоработка; итог года — правая точка."
          columns={running}
          format={axis}
          over={TONE.over}
          under={TONE.under}
        />
      </div>

      {anyNight ? (
        <div className={PLATE}>
          <ColumnChart
            title="Ночные часы по месяцам"
            note="Часы смен, пришедшиеся на время с 22 до 6 (ст. 96 ТК РФ). Праздничные часы — в подписи при наведении и в таблице ниже."
            columns={night}
            bar={{ name: "Ночные", colour: TONE.night, shape: "bar" }}
            format={axis}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Откуда взялись часы сверх своего графика: вызовы по видам.
 *
 * --- Зачем отдельным разделом ----------------------------------------------
 *
 * Вопросов о переработке два, и они разные. «Почему норма меньше» —
 * освобождения, они ниже. «Откуда часы сверх неё» — вот это: смены свои и
 * вызовы помимо них. До сих пор вызовы были видны только россыпью клеток
 * на сетке да строками в перечне правок, и человек, которого вызывали
 * четырежды за год, складывал часы сам — по распоряжениям, если они у
 * него сохранились.
 *
 * --- Почему виды здесь названы, а в клетке нет ------------------------------
 *
 * В клетке у всех вызовов один код, «Р» (`day-marks.ts`): места на слово
 * там нет, а расчёту все шесть видов одинаковы. Здесь место есть целой
 * строкой — и «Соревнования» отличить от «Резерва» человеку нужно: он
 * спорит не о сумме, а о том, за что именно ему не заплатили.
 *
 * Полоски у всех видов одинаковые, и по той же причине, что у
 * освобождений: цвет несёт клетка при названии, а семь цветных серий
 * пришлось бы различать на глаз.
 */
function Callouts({ stats }: { stats: Statistics }) {
  const { callouts, calloutHours, total } = stats;

  if (callouts.length === 0) {
    return (
      <section className={cn(PLATE, "space-y-2")}>
        <h3 className="font-display text-sm font-bold uppercase tracking-wide">
          Сверх графика
        </h3>
        <p className="text-xs text-ink-muted">
          За год не отмечено ни одного выхода помимо своих смен.
        </p>
      </section>
    );
  }

  const most = Math.max(...callouts.map((it) => it.hours.toNumber()));
  // Доля от отработанного — не украшение: «42 часа» ничего не говорят, пока
  // не сказано, много это или мало на фоне года. Ноль в делители не идёт:
  // часы вызовов есть, а отработанных нет — состояние невозможное, и всё же
  // проверка дешевле, чем `Infinity` в разметке.
  const share = total.actualHours.greaterThan(0)
    ? calloutHours.dividedBy(total.actualHours).times(100)
    : null;

  return (
    <section className={cn(PLATE, "space-y-2")}>
      <div className="space-y-0.5">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide">
          Сверх графика
        </h3>
        <p className="text-xs text-ink-muted">
          Вызов — исполнение трудовых обязанностей, то есть рабочее время
          (ст. 91 ТК РФ): часы идут в отработанное, а норму не уменьшают.
          Всего за год — {hours(calloutHours.toNumber())}
          {share === null ? "" : ` (${share.toFixed(share.lessThan(10) ? 1 : 0)} % отработанного)`}.
        </p>
      </div>

      <ul className="divide-y divide-rule">
        {callouts.map((it) => (
          <li key={it.kind} className="flex items-center gap-3 py-2.5">
            <span
              aria-hidden
              // Тот же значок, что стоит у этих суток на сетке: клетка в
              // семь единиц, рамка, полужирный кегль.
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-md border text-xs font-bold",
                CALLOUT_TONE,
              )}
            >
              {CALLOUT_MARK}
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="truncate text-sm">{CALLOUT_LABELS[it.kind]}</span>
                <span className="font-mono text-xs tabular-nums text-ink-muted">
                  {it.days} {numberWord(it.days, "день", "дня", "дней")} ·{" "}
                  {hours(it.hours.toNumber())}
                </span>
              </span>
              <ShareBar share={it.hours.toNumber() / most} />
            </span>
          </li>
        ))}
      </ul>
    </section>
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
      <section className={cn(PLATE, "space-y-2")}>
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
    <section className={cn(PLATE, "space-y-2")}>
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

      {/* Строки разделяет линовка, а не вторая плашка у каждой: они стоят
          на общей, и это один список, а не семь ответов (`ui/panel.tsx`,
          `Card`). */}
      <ul className="divide-y divide-rule">
        {absences.map((it) => (
          <li key={it.kind} className="flex items-center gap-3 py-2.5">
            <span
              aria-hidden
              // Тот же значок, что в перечне внесённых изменений: клетка в
              // семь единиц, рамка, полужирный кегль.
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-md border text-xs font-bold",
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
    <section className={cn(PLATE, "space-y-2")}>
      <h3 className="font-display text-sm font-bold uppercase tracking-wide">
        По месяцам
      </h3>
      {/* Прокручивается вбок сама, внутри плашки: двенадцать строк на семь
          столбцов в узкий экран не влезут никак, а страница ездить вбок не
          должна. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <caption className="sr-only">
            Норма, отработанные, ночные и праздничные часы по месяцам {stats.year}{" "}
            года
          </caption>
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-ink-faint">
              <th scope="col" className="py-2 pr-3 text-left font-medium">
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
              <th scope="row" className="py-2 pr-3 text-left">
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
    <th scope="col" className="px-3 py-2 text-right font-medium last:pr-0">
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
        "px-3 py-2 text-right font-mono tabular-nums last:pr-0",
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
      <th scope="row" className="py-2 pr-3 text-left font-normal">
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

/**
 * Свод по всем профилям.
 *
 * --- Зачем он есть ----------------------------------------------------------
 *
 * Профилей в проводнике бывает не один. Это либо разные годы одного
 * человека, либо — в карауле — разные люди: начальник держит график на
 * каждого, и вопрос «сколько у кого вышло» задают не о ком-то одном, а обо
 * всех сразу. Отвечать на него, открывая профили по очереди и переписывая
 * числа на бумажку, — ровно тот труд, ради отмены которого приложение и
 * написано.
 *
 * --- Почему год у каждого свой ----------------------------------------------
 *
 * Учётный год — свойство профиля, и у шести профилей он может быть шести
 * разный. Считать их все по году открытого значило бы показать чужие числа
 * под правильной с виду шапкой, поэтому год стоит столбцом в таблице, а в
 * заголовке названы те, что в своде встретились.
 *
 * --- Чего здесь нет ---------------------------------------------------------
 *
 * Рисунков по месяцам. Месяц у каждого профиля свой, и двенадцать столбцов,
 * сложенных по шести людям, отвечают на вопрос, которого никто не задавал.
 * Сравнивают профили между собой — а для этого годится полоска доли при
 * имени и таблица, где числа стоят точно.
 *
 * Столбцов с подписями-именами тоже нет: подпись под столбцом — это
 * несколько точек ширины, а имя профиля в них не влезает ни при каком
 * сокращении.
 */
function AllProfiles({
  sheets,
  onPick,
}: {
  sheets: readonly Sheet[];
  onPick: (id: string) => void;
}) {
  // По расчёту на профиль, а не по тринадцать: месяцы в своде не показаны,
  // и считать их значило бы потратить дюжину вызовов на каждого ради
  // чисел, которых на экране нет (`totalsOf`).
  const lines = useMemo(
    () => sheets.map((sheet) => ({ sheet, totals: totalsOf(sheet.profile) })),
    [sheets],
  );

  // В сумму идут только те, чей год начался: у остальных отрезок пуст, и
  // их ноль — это «ещё нечего считать», а не «наработал нисколько».
  const counted = lines.filter((line) => line.totals.any);
  const sum = (pick: (totals: ProfileTotals) => Decimal): Decimal =>
    counted.reduce((total, line) => total.plus(pick(line.totals)), ZERO);

  const norm = sum((it) => it.total.normHours);
  const actual = sum((it) => it.total.actualHours);
  const balance = sum((it) => it.balance);
  const night = sum((it) => it.total.nightHours);
  const holiday = sum((it) => it.total.holidayHours);
  const callout = sum((it) => it.calloutHours);
  const shifts = counted.reduce((total, line) => total + line.totals.total.workedShifts, 0);

  return (
    <div className="space-y-4">
      <section className={cn(PLATE, "space-y-2")}>
        <div className="space-y-0.5">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide">
            Все профили
          </h3>
          <p className="text-xs text-ink-muted">
            {counted.length} из {lines.length}{" "}
            {numberWord(lines.length, "профиля", "профилей", "профилей")} за{" "}
            {yearsOf(counted.map((line) => line.totals.year))}
            {counted.length < lines.length
              ? "; у остальных учётный год ещё не начался"
              : ""}
            . Часы сложены как есть: у каждого профиля своя норма, и складывать
            их можно только затем, чтобы увидеть общий объём.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <Tile label="Норма" value={hours(norm.toNumber())} />
          <Tile label="Отработано" value={hours(actual.toNumber())} />
          <Tile
            label="Баланс"
            value={`${signed(balance.toNumber())} ч`}
            tone={
              balance.greaterThan(0) ? "over" : balance.lessThan(0) ? "under" : undefined
            }
            note={
              balance.greaterThan(0)
                ? "переработка"
                : balance.lessThan(0)
                  ? "недоработка"
                  : "ровно в норму"
            }
          />
          <Tile label="Сверх графика" value={hours(callout.toNumber())} note="вызовы помимо смен" />
          <Tile label="Ночные" value={hours(night.toNumber())} note="с 22 до 6 часов" />
          <Tile
            label="Праздничные"
            value={hours(holiday.toNumber())}
            note="в нерабочие праздничные дни"
          />
          <Tile label="Смены" value={`${shifts} ${shiftsWord(shifts)}`} note="отработано всего" />
        </dl>
      </section>

      <CalloutShares lines={counted} />

      <ProfileTable lines={lines} onPick={onPick} />
    </div>
  );
}

/** Одна строка свода: профиль и его год в числах. */
interface Line {
  readonly sheet: Sheet;
  readonly totals: ProfileTotals;
}

/**
 * Годы, встретившиеся в своде, — строкой.
 *
 * «2026 год», «2025 и 2026 годы», «2023—2026 годы»: подряд идущие годы
 * сворачиваются в отрезок, потому что перечислять их по одному — это
 * строка длиннее самого свода.
 */
function yearsOf(years: readonly number[]): string {
  const list = [...new Set(years)].sort((a, b) => a - b);
  if (list.length === 0) return "учётный год";
  if (list.length === 1) return `${list[0]} год`;
  if (list.length === 2) return `${list[0]} и ${list[1]} годы`;
  const solid = list.at(-1)! - list[0]! === list.length - 1;
  return solid ? `${list[0]}—${list.at(-1)} годы` : `${list.join(", ")} годы`;
}

/**
 * Сколько кого вызывали помимо графика — полосками.
 *
 * Это тот вопрос, ради которого свод чаще всего и открывают: часы сверх
 * своих смен распределены между людьми неравномерно, и увидеть это надо
 * не в столбце цифр, а глазом. Полоска здесь — доля от наибольшего, а не
 * от суммы: сравнивают людей друг с другом, а не с общим котлом.
 */
function CalloutShares({ lines }: { lines: readonly Line[] }) {
  const called = lines
    .filter((line) => line.totals.calloutHours.greaterThan(0))
    .sort((a, b) => b.totals.calloutHours.comparedTo(a.totals.calloutHours));

  if (called.length === 0) return null;

  const most = called[0]!.totals.calloutHours.toNumber();

  return (
    <section className={cn(PLATE, "space-y-2")}>
      <div className="space-y-0.5">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide">
          Сверх графика — по профилям
        </h3>
        <p className="text-xs text-ink-muted">
          Часы вызовов помимо своих смен. Полоска — доля от наибольшего в
          своде, а не от суммы.
        </p>
      </div>

      <ul className="divide-y divide-rule">
        {called.map((line) => (
          <li key={line.sheet.id} className="flex items-center gap-3 py-2.5">
            <span
              aria-hidden
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-md border text-xs font-bold",
                CALLOUT_TONE,
              )}
            >
              {CALLOUT_MARK}
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="truncate text-sm">{line.sheet.name}</span>
                <span className="font-mono text-xs tabular-nums text-ink-muted">
                  {hours(line.totals.calloutHours.toNumber())}
                </span>
              </span>
              <ShareBar share={line.totals.calloutHours.toNumber() / most} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Таблица по профилям.
 *
 * Она здесь тем же, чем таблица по месяцам у одного профиля: точные числа,
 * читаемые без цвета. И заодно — способ уйти в подробности: имя профиля
 * нажимается и открывает его статистику целиком, с рисунками и месяцами.
 * Это и есть «переключиться» в самом частом случае: человек нашёл в своде
 * того, у кого число необычное, и хочет посмотреть, из чего оно вышло.
 */
function ProfileTable({
  lines,
  onPick,
}: {
  lines: readonly Line[];
  onPick: (id: string) => void;
}) {
  const counted = lines.filter((line) => line.totals.any);
  const sum = (pick: (totals: ProfileTotals) => Decimal): Decimal =>
    counted.reduce((total, line) => total.plus(pick(line.totals)), ZERO);

  return (
    <section className={cn(PLATE, "space-y-2")}>
      <h3 className="font-display text-sm font-bold uppercase tracking-wide">
        По профилям
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <caption className="sr-only">
            Норма, отработанные, ночные и праздничные часы по профилям
          </caption>
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-ink-faint">
              <th scope="col" className="py-2 pr-3 text-left font-medium">
                Профиль
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Год
              </th>
              <Head>Норма</Head>
              <Head>Факт</Head>
              <Head>Баланс</Head>
              <Head>Ночные</Head>
              <Head>Сверх</Head>
              <Head>Смены</Head>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {lines.map((line) => (
              <ProfileRow key={line.sheet.id} line={line} onPick={onPick} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-rule-strong font-medium">
              <th scope="row" className="py-2 pr-3 text-left">
                Всего
              </th>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-faint">
                —
              </td>
              <Cell>{hoursTrim(sum((it) => it.total.normHours))}</Cell>
              <Cell>{hoursTrim(sum((it) => it.total.actualHours))}</Cell>
              <BalanceCell value={sum((it) => it.balance)} />
              <Cell>{hoursTrim(sum((it) => it.total.nightHours))}</Cell>
              <Cell>{hoursTrim(sum((it) => it.calloutHours))}</Cell>
              <Cell>
                {counted.reduce((total, line) => total + line.totals.total.workedShifts, 0)}
              </Cell>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function ProfileRow({ line, onPick }: { line: Line; onPick: (id: string) => void }) {
  const { sheet, totals } = line;

  // Год, которого ещё не было, — прочерки, а не нули: ноль в колонке
  // «Норма» читается как «норма нулевая», и это неправда.
  if (!totals.any) {
    return (
      <tr className="text-ink-faint">
        <ProfileName sheet={sheet} onPick={onPick} />
        <td className="px-3 py-2 text-right font-mono tabular-nums">{totals.year}</td>
        {Array.from({ length: 6 }, (_, index) => (
          <td key={index} className="px-3 py-2 text-right font-mono tabular-nums last:pr-0">
            —
          </td>
        ))}
      </tr>
    );
  }

  return (
    <tr>
      <ProfileName sheet={sheet} onPick={onPick} />
      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">
        {totals.year}
      </td>
      <Cell>{hoursTrim(totals.total.normHours)}</Cell>
      <Cell>{hoursTrim(totals.total.actualHours)}</Cell>
      <BalanceCell value={totals.balance} />
      <Cell>{hoursTrim(totals.total.nightHours)}</Cell>
      <Cell>{hoursTrim(totals.calloutHours)}</Cell>
      <Cell>{totals.total.workedShifts}</Cell>
    </tr>
  );
}

function ProfileName({
  sheet,
  onPick,
}: {
  sheet: Sheet;
  onPick: (id: string) => void;
}) {
  return (
    <th scope="row" className="py-2 pr-3 text-left font-normal">
      <button
        type="button"
        onClick={() => onPick(sheet.id)}
        title={`Статистика профиля «${sheet.name}»`}
        className={cn(
          "inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md",
          "text-left underline decoration-rule-strong underline-offset-4",
          "hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-ink",
        )}
      >
        {sheet.open ? (
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-verify" />
        ) : null}
        <span className="truncate">{sheet.name}</span>
        {sheet.open ? <span className="sr-only"> (открыт)</span> : null}
      </button>
    </th>
  );
}

/** Баланс в таблице: со знаком и цветом итога — как у месяцев. */
function BalanceCell({ value }: { value: Decimal }) {
  const balance = value.toNumber();
  return (
    <Cell tone={balance > 0 ? "over" : balance < 0 ? "under" : undefined}>
      {signed(balance)}
    </Cell>
  );
}

