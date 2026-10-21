"use client";

import { ChevronDown, Folder, User, type LucideIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { useDragScroll } from "@/lib/hooks/use-drag-scroll";
import { cn } from "@/lib/utils/cn";

import {
  formatHoursTrim as hoursTrim,
  numberWord,
  type Decimal,
} from "../domain/decimal";
import { formatDayMonthRu } from "../domain/format";
import type { IsoDate } from "../domain/plain-date";
import { MONTH_NAMES } from "./month-names";
import { partLabel } from "./period-picker";
import { ABSENCE_MARK, ABSENCE_TONE, CALLOUT_MARK, CALLOUT_TONE } from "./day-marks";
import { ABSENCE_LABELS, CALLOUT_LABELS } from "../schemas";
import type { AbsenceKind } from "../domain/value-objects";
import {
  statisticsOf,
  totalsOf,
  type PeriodPart,
  type AbsenceEntry,
  type AbsenceStat,
  type CalloutEntry,
  type EventNote,
  type ProfileTotals,
  type Statistics,
} from "../model/statistics";
import {
  folderPath,
  ROOT_FOLDER_ID,
  readEntryProfile,
  type Library,
  type LibraryFolder,
} from "../storage/library";
import type { StoredProfile } from "../storage/profile";
import { BalanceChart, ColumnChart, ShareBar, type Column } from "./charts";
import { useLibrary } from "./profile-explorer";
import { Ledger, signed, type LedgerColumn } from "./stats-ledger";

/**
 * Статистика выбранного учётного периода — разделом страницы, на месте
 * графика.
 *
 * Показывает её `workspace.tsx` тем же порядком, что настройки и
 * проводник: кнопка в шапке подменяет содержимое страницы и сама же его
 * закрывает. Окном поверх графика она была ровно до тех пор, пока не
 * выяснилось, что окно закрывает собой источник собственных чисел, —
 * доводы целиком там, у `statsOpen`.
 *
 * Отсюда и строй: разделы стоят прямо на странице, без плашек, рамок и
 * заливки, и отделены друг от друга просветом и заголовком. Плашки поднятой
 * бумаги тут были, и на широком экране они лежали сплошной лентой в три с
 * половиной тысячи точек: каждая рамка со своим светом по кромке отнимала
 * внимание у того, что в ней, а рисунки и таблицы без них стоят ровнее.
 *
 * Ширина — та же, что у календаря (`frame-inset` в `workspace.tsx`): с
 * `md` рамка уже страницы, и колонка знаков управления, которая стоит в поле
 * сбоку, остаётся в поле, а не ложится на статистику.
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
 * У одного графика — из двух разделов, двух ответов на два разных вопроса, и в
 * этом порядке, от картины к подробностям:
 *
 *  1. «Как шло» — три рисунка рядом (`Course`): норма и факт по месяцам,
 *     накопленный баланс и ночные часы. Месяцы у них одни и те же, и рядом
 *     они читаются как одна картина года. Ночные — отдельным рисунком, потому
 *     что величина у них другая: подсадить их к норме второй осью значило бы
 *     выдумать связь, которой в данных нет.
 *  2. «Точные числа» — таблица по месяцам (`Numbers`). Месяцы в ней идут
 *     столбцами, а не строками: год помещается на экран, а не листается.
 *
 * События периода у одного графика не перечисляются: они отмечены на самой
 * сетке и в календаре, где их и правят, а на часы влияют так, что это видно в
 * рисунках и таблице. Лента событий по датам, которая стояла между рисунками и
 * таблицей, убрана. Перечни по людям остались в своде (`Summary`): там вопрос
 * другой — «у кого сколько», и сетка одного графика на него не отвечает.
 *
 * Прежде порядок был обратный — перечни, таблицы и только потом рисунки, — и
 * всё это стояло полосой плашек в три с половиной тысячи точек высоты:
 * рисунки, самое наглядное в разделе, оказывались на третьем экране прокрутки.
 *
 * Таблица внизу — не запасной путь для читалки, а обязательство: числа,
 * показанные цветом, обязаны быть доступны и без цвета. Зелёный на светлой
 * бумаге даёт 2,9:1 против трёх положенных, и таблица — то, чем это
 * возмещается.
 */

/** Короткое имя месяца для оси: «янв». Из общего списка, а не второй копией. */
const SHORT = MONTH_NAMES.map((name) => name.slice(0, 3).toLowerCase());

/**
 * Период словами — для заголовков после «за»: «2026 год», «2-й квартал
 * 2026 года». Год назван всегда: в своде у профилей он бывает разный, а у
 * квартала без года не понять, о каком годе речь.
 */
function periodPhrase(part: PeriodPart, year: number): string {
  if (part.kind === "year") return `${year} год`;
  return `${partLabel(part.kind, part.index, year)} ${year} года`;
}

/**
 * «За год», «За полугодие», «За квартал» — по виду периода: итоговая строка
 * таблицы месяцев и пустые ответы разделов.
 */
const WHOLE_PERIOD = {
  year: "За год",
  half_year: "За полугодие",
  quarter: "За квартал",
} as const;

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
  /** Папка проводника, в которой профиль лежит. */
  folderId: string;
  profile: StoredProfile;
  /** Тот самый профиль, что сейчас открыт на странице. */
  open: boolean;
}

/** Запись открытого профиля, если её в проводнике почему-то нет. */
const LOOSE = "\u0000open";

function useSheets(open: StoredProfile): { sheets: Sheet[]; library: Library } {
  const { library, activeId } = useLibrary();

  const sheets = useMemo(() => {
    const list: Sheet[] = [];
    for (const entry of library.entries) {
      const mine = entry.id === activeId;
      // Запись, которая не читается (битый снимок, отнятое хранилище), —
      // не ноль в своде, а отсутствие строки: приписать человеку нулевую
      // норму значило бы соврать о нём, а не промолчать.
      const it = mine ? open : readEntryProfile(entry.id);
      if (it === null) continue;
      list.push({
        id: entry.id,
        // Имя берётся из самого снимка, а не из записи: запись помнит имя
        // на миг последней правки, а переименование живёт в профиле.
        name: it.displayName.trim() === "" ? entry.name : it.displayName,
        folderId: entry.folderId,
        profile: it,
        open: mine,
      });
    }

    // Порядок по имени, а не по времени правки: список читают глазами,
    // ища своё, и перечень, перестраивающийся от каждой правки, заставлял
    // бы искать заново.
    list.sort((a, b) => a.name.localeCompare(b.name, "ru"));

    // Открытый профиль обязан быть в выборе всегда — даже если в
    // проводнике его записи ещё нет: он и есть то, на что человек смотрит.
    if (!list.some((it) => it.open)) {
      list.unshift({
        id: LOOSE,
        name: open.displayName.trim() === "" ? "Открытый график" : open.displayName,
        folderId: ROOT_FOLDER_ID,
        profile: open,
        open: true,
      });
    }

    return list;
  }, [library, activeId, open]);

  return { sheets, library };
}

/**
 * Что показано: свод по всем, свод по папке или один профиль.
 *
 * Папка здесь — не украшение выбора. Профили в проводнике раскладывают по
 * папкам не по прихоти: «4-й караул» — это и есть та единица, о которой
 * спрашивают «сколько у нас вышло», а не «все графики, какие есть в
 * браузере». Свод по всем на такой вопрос отвечает суммой по чужим людям.
 */
type Scope =
  | { kind: "all" }
  | { kind: "folder"; id: string }
  | { kind: "one"; id: string };

/**
 * Выбор — строкой, потому что его хранит родной `select`.
 *
 * Разделитель — двоеточие: опознания папок и записей выдаёт `crypto.randomUUID`
 * или связка из времени и случайного хвоста (`library.ts`), и двоеточия в
 * них нет ни в одном из двух видов.
 */
function encode(scope: Scope): string {
  return scope.kind === "all" ? "all" : `${scope.kind}:${scope.id}`;
}

function decode(value: string): Scope {
  const at = value.indexOf(":");
  if (at < 0) return { kind: "all" };
  const kind = value.slice(0, at);
  const id = value.slice(at + 1);
  return kind === "folder" ? { kind: "folder", id } : { kind: "one", id };
}

/**
 * Строка списка: один выбор и его глубина в дереве папок.
 *
 * Глубина нужна только отступу. Отступ неразрывными пробелами, а не
 * обычными: раскрытый список рисует операционная система, и обычные
 * пробелы в начале строки она вправе убрать — а неразрывный для неё такой
 * же знак, как буква.
 */
interface Choice {
  value: string;
  label: string;
  depth: number;
  /** Папка или профиль — от этого знак в начале строки. */
  folder: boolean;
}

/**
 * Знак папки и знак человека — в строках раскрытого списка.
 *
 * Не `svg`, а буквы, и не от бедности: раскрытый `select` рисует
 * ОПЕРАЦИОННАЯ СИСТЕМА, разметки внутри него нет вовсе, и единственная
 * картинка, какую там можно показать, — знак из шрифта. Эти два есть во
 * всех системах, куда приложение доходит, и читаются без подписи.
 *
 * В закрытом поле и в горячем ряду стоят настоящие значки (`lucide`) — там
 * рисует страница, и подменять их буквами незачем.
 */
const FOLDER_MARK = "📁";
const PROFILE_MARK = "👤";

/**
 * Весь выбор — плоским списком строк, а не группами.
 *
 * --- Почему не `optgroup` ---------------------------------------------------
 *
 * Папки сперва стояли заголовками групп, а под каждым — её профили и особая
 * строка «⟨имя⟩ целиком». Это было неправдой дважды. Во-первых, заголовок
 * группы в родном списке НЕ ВЫБИРАЕТСЯ: человек видел «4-й караул», нажимал
 * — и ничего не происходило, а нужное лежало строкой ниже, теми же словами
 * плюс «целиком». Во-вторых, корень стоял заголовком «/», а свод по всем
 * профилям — отдельной строкой наверху: два имени у одного и того же.
 *
 * Теперь строка папки И ЕСТЬ выбор этой папки, а корень — это и есть «Все
 * профили». Лишних строк не осталось: сколько в дереве папок, столько и
 * строк выбора, плюс по строке на профиль.
 *
 * --- Порядок ----------------------------------------------------------------
 *
 * Как в проводнике: папка, сразу под ней её собственные профили, потом
 * вложенные папки — каждая со своими. Счёт при папке — сколько профилей
 * внутри неё ВСЕГО, вместе с вложенными: столько же их попадёт в свод.
 * Папка, в которой не лежит ни одного профиля, в списке не показана — в ней
 * нечего считать.
 */
function choicesOf(library: Library, sheets: readonly Sheet[]): Choice[] {
  const out: Choice[] = [];

  const walk = (folder: LibraryFolder, depth: number) => {
    const inside = sheets.filter((it) => within(library, it.folderId, folder.id));
    if (inside.length === 0) return;

    const root = folder.id === ROOT_FOLDER_ID;
    out.push({
      // Корень — это и есть «все»: свод по нему и свод по всем профилям —
      // одно и то же, и двух значений у одного выбора быть не должно.
      value: root ? "all" : encode({ kind: "folder", id: folder.id }),
      label: `${root ? "Все графики" : folder.name} (${inside.length})`,
      depth,
      folder: true,
    });

    for (const sheet of inside.filter((it) => it.folderId === folder.id)) {
      out.push({
        value: encode({ kind: "one", id: sheet.id }),
        // «открыт» словом, а не точкой: цвета в этом списке не поставить,
        // а слово читается и глазом, и диктором.
        label: `${sheet.name}`,
        depth: depth + 1,
        folder: false,
      });
    }

    library.folders
      .filter((it) => it.id !== folder.id && it.parentId === folder.id)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .forEach((child) => walk(child, depth + 1));
  };

  const root = library.folders.find((it) => it.id === ROOT_FOLDER_ID);
  if (root !== undefined) walk(root, 0);

  // Профиль, до которого обход не добрался, всё равно не пропадает из
  // выбора: `loadLibrary` поднимает потерявших папку в корень, и оказаться
  // здесь он может разве что из-за кольца в ссылках — но это чей-то год.
  for (const sheet of sheets) {
    const value = encode({ kind: "one", id: sheet.id });
    if (!out.some((it) => it.value === value)) {
      out.push({ value, label: sheet.name, depth: 1, folder: false });
    }
  }

  return out;
}

/**
 * Строка списка целиком: отступ по глубине, знак, имя.
 *
 * У ВЫБРАННОЙ строки ни отступа, ни знака нет, и это не мелочь: закрытое
 * поле показывает текст выбранной строки как есть, и в нём отступ
 * обернулся бы пустотой после знака, а знак — второй картинкой рядом с
 * настоящим значком поля. В раскрытом списке выбранная строка и так
 * помечена — подсветкой, которую рисует сама система.
 */
function optionText(choice: Choice, chosen: boolean): string {
  if (chosen) return choice.label;
  const pad = "\u00a0".repeat(choice.depth * 3);
  return `${pad}${choice.folder ? FOLDER_MARK : PROFILE_MARK}\u00a0${choice.label}`;
}

/** Лежит ли папка внутри другой — она сама или любой её потомок. */
function within(library: Library, folderId: string, rootId: string): boolean {
  return folderPath(library, folderId).some((it) => it.id === rootId);
}

export function Statistics({
  profile,
  part,
  onShow,
}: {
  profile: StoredProfile;
  /**
   * Доля учётного года, выбранная кнопкой в шапке: за неё считается всё —
   * и один профиль, и свод. Отрезок тот же, что у полосы цифр наверху, и
   * два ответа на один вопрос на одном экране не расходятся.
   */
  part: PeriodPart;
  /**
   * Чей профиль показан сейчас — чтобы полоса цифр и имя наверху
   * перестроились под него.
   *
   * `null` — показан свод (по всем или по папке) либо сам открытый
   * профиль: и в том и в другом случае наверху остаётся то, что было.
   * Зовётся из обработчика выбора, а не из отрисовки: страница наверху —
   * чужое состояние, и менять его во время своей отрисовки нельзя.
   */
  onShow: (shown: StoredProfile | null) => void;
}) {
  const { sheets, library } = useSheets(profile);
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
  // Выбранное могло исчезнуть, пока статистика открыта (профиль удалили в
  // проводнике, папку переименовали) — тогда показывается открытый
  // профиль, а не пустое место.
  const one =
    scope === null
      ? mine
      : scope.kind === "one"
        ? (sheets.find((it) => it.id === scope.id) ?? mine)
        : null;
  const folder =
    scope?.kind === "folder"
      ? (library.folders.find((it) => it.id === scope.id) ?? null)
      : null;
  const group =
    scope?.kind === "folder" && folder !== null
      ? sheets.filter((it) => within(library, it.folderId, folder.id))
      : null;

  const choices = useMemo(() => choicesOf(library, sheets), [library, sheets]);

  /**
   * Не `scope`, а то, что ПОКАЗАНО.
   *
   * Выбора могло не быть вовсе (тогда стоит открытый профиль), а выбранное
   * могло исчезнуть (тогда стоит то, чем его заменили). Поле обязано
   * показывать строку, которая сейчас на экране, а не намерение человека.
   */
  const shownScope: Scope =
    one !== null
      ? { kind: "one", id: one.id }
      : folder !== null
        ? { kind: "folder", id: folder.id }
        : { kind: "all" };

  function choose(next: Scope) {
    setScope(next);
    // Наверху страницы показывают ОДИН профиль, и только когда он не тот,
    // что открыт: у свода единственного профиля нет, а открытый там стоит
    // и без нашей просьбы.
    const shown =
      next.kind === "one" ? (sheets.find((it) => it.id === next.id) ?? null) : null;
    onShow(shown === null || shown.open ? null : shown.profile);
  }

  return (
    // Выбор стоит над разделами с обычным просветом, а сами разделы друг
    // от друга разведены шире (`space-y-10` ниже): плашек вокруг них нет, и
    // границей служит один просвет.
    <div className="space-y-6">
      {/* Выбор — только когда выбирать есть из чего. При одном профиле
          список из «Все профили» и его же имени предлагал бы выбор из
          одного и обещал бы свод, которого нет. */}
      {sheets.length > 1 ? (
        <>
          <ScopePicker
            sheets={sheets}
            library={library}
            choices={choices}
            value={shownScope}
            onChange={choose}
          />
          <ScopeDeck choices={choices} value={shownScope} onChange={choose} />
        </>
      ) : null}

      {group !== null ? (
        <Summary sheets={group} part={part} onPick={(id) => choose({ kind: "one", id })} />
      ) : one === null ? (
        <Summary sheets={sheets} part={part} onPick={(id) => choose({ kind: "one", id })} />
      ) : (
        <OneProfile profile={one.profile} part={part} />
      )}
    </div>
  );
}

/**
 * Сколько всего может стоять в горячем ряду.
 *
 * Ряд — это сокращение пути, а не второй список: в нём столько, сколько
 * помещается в строку рядом с выбором, не переносясь второй раз. Остальное
 * никуда не девается — оно в списке, из которого ряд и собран.
 */
const QUICK_MAX = 8;

/**
 * Поле выбора: знак, значение, стрелка.
 *
 * --- Почему свет на обёртке, а не на самом поле -----------------------------
 *
 * Кайму лампы рисует `::after` (`globals.css`, `.lit`), а `select` —
 * ЗАМЕЩАЕМЫЙ элемент: содержимое ему рисует браузер, и ни `::before`, ни
 * `::after` на нём не появляются вовсе. Тень от `lit` ложилась, а каймы и
 * блика по курсору не было — поле стояло в строке единственной деталью без
 * света. Поэтому `lit` вместе с бумагой переехал на обёртку, а само поле
 * стало прозрачным: светится коробка, а в ней лежит управление.
 *
 * --- Две меры ---------------------------------------------------------------
 *
 * Строкой — ростом с кнопку периода (36 точек), ячейкой панели телефона —
 * ростом с её ячейки (48). Разница только в мерах: список, знаки и
 * поведение одни и те же, и разводить их двумя компонентами значило бы
 * однажды поправить одно и забыть другое.
 */
function ScopeField({
  id,
  choices,
  value,
  onChange,
  deck = false,
}: {
  id: string;
  choices: readonly Choice[];
  value: Scope;
  onChange: (scope: Scope) => void;
  /** Ячейкой нижней панели телефона, а не строкой над статистикой. */
  deck?: boolean;
}) {
  const now = encode(value);
  // Знак говорит, ЧТО сейчас выбрано, а не «тут выбор»: папка у свода по
  // всем и по папке, человек у одного профиля. Та же пара знаков, что в
  // горячем ряду и (буквами) в раскрытом списке.
  const Chosen = value.kind === "one" ? User : Folder;

  return (
    <div
      className={cn(
        "lit relative rounded-xl bg-paper-raised",
        deck ? "h-12 min-w-0 flex-1" : "h-9 w-full min-w-56 md:w-auto md:max-w-80",
      )}
    >
      {/* `z-10` — не прихоть: поле лежит в разметке ПОСЛЕ знака и закрыло бы
          его собой, как всякий позиционированный сосед, идущий следом. */}
      <Chosen
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 text-ink-muted",
          deck ? "left-4 size-5.5" : "left-3 size-4.5",
        )}
      />
      <Select
        id={id}
        aria-label="Чья статистика"
        // Кнопка периода до последнего значения: то же скругление (14), та
        // же бумага, тот же блик — и рамки нет вовсе, как у неё. Левое поле
        // строкой — 38 точек: ровно столько же от края до слова у периода
        // (12 поля, 18 знака, 8 просвета). Правое остаётся под стрелку,
        // которой у периода нет: её рисует сам `select`.
        // Заливка у поля СВОЯ, хотя точно такая же лежит на обёртке, и это
        // не лишнее: раскрытый список браузер красит цветом самого поля, и
        // с прозрачным полем он выходил белым на тёмной теме. Цвет тот же,
        // что у обёртки, — видно их как одну поверхность.
        // `lit-face` — блик лампы по верхней кромке САМОГО поля: своей
        // заливкой оно закрывает блик обёртки, и в покое от света не
        // оставалось ничего (`globals.css`).
        className={cn(
          "lit-face rounded-xl border-0 bg-paper-raised font-medium",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
          deck ? "h-12 pl-12" : "h-9 pl-[38px]",
        )}
        value={now}
        onChange={(event) => onChange(decode(event.target.value))}
      >
        {choices.map((it) => (
          <option key={it.value} value={it.value}>
            {optionText(it, it.value === now)}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * Чья статистика показана — строкой над самой статистикой.
 *
 * --- Почему выпадающий список, а не ряд плашек ------------------------------
 *
 * Ряд плашек тут и стоял, и при трёх профилях читался прекрасно. Но
 * профилей бывает не три: в карауле их два десятка, и ряд из двадцати имён
 * — это три строки поперёк экрана над статистикой, ради которой сюда и
 * пришли.
 *
 * Список этого не боится, а на телефоне вдобавок открывает системный
 * барабан вместо трёх строк мелких плашек (`ui/select.tsx`, там же
 * остальные доводы за родной `select`).
 *
 * --- Где он стоит -----------------------------------------------------------
 *
 * С `md` — строкой над статистикой, той же породы, что строка над сеткой.
 * Ниже этого порога его здесь нет вовсе: он переезжает в закреплённую
 * панель у нижней кромки (`ScopeDeck`) — туда же, где на телефоне живёт
 * управление сеткой.
 */
function ScopePicker({
  sheets,
  library,
  choices,
  value,
  onChange,
}: {
  sheets: readonly Sheet[];
  library: Library;
  choices: readonly Choice[];
  value: Scope;
  onChange: (scope: Scope) => void;
}) {
  // Горячий ряд не вмещает своих кнопок, как только графиков становится
  // много, и пальцем он листается сам, а мышью — нечем: колесо крутит
  // страницу, а полоса прокрутки у дорожки убрана намеренно. Протягивание
  // мышью возвращает эту возможность, ничего не добавляя на экран
  // (`use-drag-scroll.ts`).
  const track = useRef<HTMLDivElement>(null);
  const onTrackPointerDown = useDragScroll(track);

  /**
   * Горячий ряд: то же, что в списке, но в одно нажатие.
   *
   * Сперва «Все», потом папки — они и есть то, о чём спрашивают чаще
   * всего («сколько вышло у четвёртого караула»), — и только потом
   * профили, сколько влезет. Открытый профиль среди них первый: к нему
   * возвращаются чаще, чем к любому другому.
   */
  const quick: { key: string; label: string; scope: Scope; Icon: LucideIcon }[] = [
    // «Все» — это корневая папка, и знак у неё папки же.
    { key: "all", label: "Все", scope: { kind: "all" }, Icon: Folder },
  ];
  for (const folder of library.folders) {
    if (folder.id === ROOT_FOLDER_ID) continue;
    const inside = sheets.filter((it) => within(library, it.folderId, folder.id));
    // Папка с единственным профилем в ряд не идёт: её свод — тот же один
    // профиль, и кнопка рядом с его именем говорила бы то же самое дважды.
    // В списке она есть: там строки не за что экономить.
    if (inside.length < 2) continue;
    quick.push({
      key: `folder:${folder.id}`,
      label: folder.name,
      scope: { kind: "folder", id: folder.id },
      Icon: Folder,
    });
  }
  const byNearness = [...sheets].sort(
    (a, b) => Number(b.open) - Number(a.open) || a.name.localeCompare(b.name, "ru"),
  );
  for (const sheet of byNearness) {
    if (quick.length >= QUICK_MAX) break;
    quick.push({
      key: `one:${sheet.id}`,
      label: sheet.name,
      scope: { kind: "one", id: sheet.id },
      Icon: User,
    });
  }

  const now = encode(value);

  return (
    // Строка управления, а не плашка.
    // -----------------------------------------------------------------------
    // Подложки у неё нет — по той же причине, по какой её нет у строки над
    // сеткой (`year-view.tsx`): плашка цвета бумаги под кнопками читалась бы
    // лишним слоем. Управление держится формой самих кнопок, а не фоном под
    // ними.
    //
    // И форма эта — та же, что у соседей по приложению: выбор чьей-то
    // статистики стоит к выбору периода и режиму «Онлайн» ровно в том же
    // отношении, что они друг к другу, — все трое отвечают на вопрос «что я
    // сейчас вижу». Поэтому и мера одна (`h-9`), и скругление, и свет лампы
    // по верхней кромке, и просвет между ними.
    //
    // С `md`, а не всегда: ниже этого порога управление сеткой уезжает в
    // панель у нижней кромки, и выбор уезжает туда же — двух мест для
    // одного рода действий на телефоне быть не должно.
    <div className="hidden flex-wrap items-center gap-2 md:flex">
      <ScopeField id="stats-scope" choices={choices} value={value} onChange={onChange} />

      {/* Горячий ряд появляется вместе со строкой, а не позже.
          -----------------------------------------------------------------
          Порог у него был свой (`lg`), и между 768 и 1024 точками строка
          стояла с одним полем посередине пустоты: выбор уже переехал из
          нижней панели наверх, а выглядел не так, как выглядит на широком
          экране. Порог теперь один — тот же, на котором выбор вообще
          меняет место. Не помещающиеся кнопки уезжают прокруткой вбок
          внутри дорожки, а не переносятся строкой. */}
      <Segmented
        label="Быстрый выбор"
        ref={track}
        onPointerDown={onTrackPointerDown}
        // Тот же переключатель, что выбирает вид сетки над календарём, и с
        // теми же мерами: ячейки во всю высоту дорожки, просвет в пол-единицы,
        // никаких своих полей. Разница одна — этот листается вбок: видов
        // сетки два, а профилей бывает сколько угодно.
        //
        // `justify-start` на всех ширинах, включая `lg`, где переключатель
        // сам по себе растягивает ячейки по краям (`segmented.tsx`). Здесь
        // это неверно: у выбора вида сетки положений ровно два и оба видны
        // всегда, а тут ячеек столько, сколько папок и графиков, и часть их
        // за кромкой. Разгонять по краям ряд, который не вмещается, нечем —
        // раздвигать пришлось бы просветы, которых нет, — зато у ряда,
        // который вмещается, кнопки разъезжались бы тем шире, чем меньше их
        // в наборе: два графика давали бы две кнопки по концам строки.
        className="hidden h-auto min-w-0 flex-1 justify-start overflow-x-scroll scroll-hidden scrollbar-none md:inline-flex md:justify-start lg:justify-start"
      >
        {quick.map((it) => (
          <SegmentedItem
            key={it.key}
            active={encode(it.scope) === now}
            onClick={() => onChange(it.scope)}
            // Знак той же меры, что у соседей по строке и у кнопок шапки:
            // девять десятых рема. Своя мера переключателя (четыре пятых)
            // оставила бы в одной строке значки двух размеров — тот же
            // довод, что у выбора вида сетки (`year-view.tsx`).
            className="md:flex-none lg:flex-none [&_svg]:size-4.5"
          >
            <it.Icon aria-hidden />
            <span className="min-w-0 max-w-40 truncate">{it.label}</span>
          </SegmentedItem>
        ))}
      </Segmented>
    </div>
  );
}

/**
 * Выбор на телефоне — закреплённой панелью у нижней кромки.
 *
 * --- Почему внизу, а не строкой над статистикой -----------------------------
 *
 * Статистика длинная: рисунки, таблица на двенадцать месяцев и, в своде,
 * перечни событий. Выбор, стоящий над ней, на телефоне уезжает за верхний край
 * с первым же движением пальца, и вернуться к нему можно, только прокрутив
 * всё обратно, — а нужен он ровно тогда, когда человек досмотрел одного и
 * хочет посмотреть другого.
 *
 * Панель закреплена у нижней кромки: она всегда под большим пальцем.
 * Растворяющийся над ней слой бумаги — в `globals.css` (`.deck`): он
 * считается от безопасной зоны, а её знает только таблица стилей.
 *
 * --- Почему через портал ----------------------------------------------------
 *
 * Раздел со статистикой поднят сдвигом (`-translate-y-2` в
 * `workspace.tsx`), а любой `transform` у предка заводит новую систему
 * отсчёта для `position: fixed`: панель, оставленная на месте, встала бы не
 * у кромки окна, а в трёх тысячах точек от верха страницы. В теле документа
 * предков у неё нет — тем же путём и по той же причине, что перечень
 * видов у дня (`day-ring.tsx`).
 */
/** Место панели: закреплена у нижней кромки, только на телефоне. */
const DECK_SHELL = "deck px-6 md:hidden";

/**
 * Строка панели. `relative` обязателен: растворение над панелью нарисовано
 * абсолютным `::before` у оболочки, и без своего слоя строка оказалась бы
 * под ним.
 */
const DECK_ROW = "relative flex items-stretch gap-2";

function ScopeDeck({
  choices,
  value,
  onChange,
}: {
  choices: readonly Choice[];
  value: Scope;
  onChange: (scope: Scope) => void;
}) {
  // Статистика открывается нажатием, то есть заведомо в браузере: при
  // сборке страницы до неё дело не доходит, а `document.body` там не
  // существует вовсе.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={DECK_SHELL}>
      <div className={DECK_ROW}>
        <ScopeField
          id="stats-scope-deck"
          choices={choices}
          value={value}
          onChange={onChange}
          deck
        />
      </div>
    </div>,
    document.body,
  );
}

/**
 * Статистика одного профиля: период, разложенный на вопросы.
 *
 * --- Порядок: от картины к подробностям -------------------------------------
 *
 * Раньше раздел шёл от текста к картине: пять перечней событий, две таблицы и
 * только в самом низу — рисунки. Рисунки при этом самое наглядное, что в нём
 * есть, а добирались до них на третьем экране прокрутки (3,6 тысячи точек
 * высоты на настольном экране).
 *
 * Теперь первым стоит «как шло» — три рисунка рядом. Последними идут точные
 * числа таблицей: их переписывают в заявление, и читают их те, кто уже понял
 * картину. Перечня событий между ними нет — см. шапку файла.
 */
function OneProfile({ profile, part }: { profile: StoredProfile; part: PeriodPart }) {
  // Расчётов до девятнадцати — период, его месяцы и вложенные доли, — и
  // делать их заново на каждую отрисовку незачем: пока профиль и период те
  // же, и числа те же. Зависимость — от вида и номера доли, а не от объекта:
  // тот же выбор, пришедший новым объектом, считать заново незачем.
  const stats = useMemo(
    () => statisticsOf(profile, undefined, { kind: part.kind, index: part.index }),
    [profile, part.kind, part.index],
  );

  if (!stats.any) {
    return (
      // Пустой ответ — словами по центру: страница не должна выглядеть
      // недогрузившейся.
      <p className="py-6 text-center text-sm text-ink-muted">
        За {periodPhrase(stats.part, stats.year)} считать нечего: выбранный
        период ещё не начался или целиком раньше начала отсчёта.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <Figures stats={stats} />
      <Course stats={stats} />
      <Numbers stats={stats} />
    </div>
  );
}

/**
 * То, что полоса наверху прячет на узком экране, — и ровно это.
 *
 * --- Чего здесь нет и почему ------------------------------------------------
 *
 * Ничего, что на экране УЖЕ есть. Полоса наверху закреплена и видна всё
 * время, пока открыта статистика; три её главных числа — норма, фактически,
 * переработка — стоят на любой ширине, и повторять их значило заставить
 * сверять, не разошлись ли два ответа на один вопрос. Отсюда ушли и крупное
 * число переработки, и «Норма года» с «Отработано».
 *
 * Не осталось и того, чего в полосе нет вовсе («рабочих дней в году»):
 * плашка отвечает на один вопрос — «что пропало, когда экран стал узким», —
 * и всё лишнее в ней снова превращает её в свод, которым она была.
 *
 * --- Что остаётся -----------------------------------------------------------
 *
 * Пять величин, которые полоса прячет ниже `lg`, потому что для них нет
 * ширины: смены по графику, отработанные, пропущенные, ночные и
 * праздничные часы (`minorItems` в `period-summary.tsx`). Те же слова и в
 * том же порядке — это одни и те же числа, просто показанные там, где для
 * них нашлось место.
 *
 * Отрезок у них тоже один — выбранная в шапке доля года.
 */
function Figures({ stats }: { stats: Statistics }) {
  const { total } = stats;

  return (
    <section className="space-y-2 lg:hidden">
      <h3 className="font-display text-sm font-bold uppercase tracking-wide">
        За {periodPhrase(stats.part, stats.year)}
      </h3>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Tile label="Смен по графику" value={String(total.scheduledShifts)} />
        <Tile label="Отработано смен" value={String(total.workedShifts)} />
        <Tile label="Пропущено" value={String(total.absentShifts)} />
        <Tile
          label="Ночные часы"
          value={hours(total.nightHours.toNumber())}
          note="с 22 до 6 часов"
        />
        <Tile
          label="Праздничные часы"
          value={hours(total.holidayHours.toNumber())}
          note="в нерабочие праздничные дни"
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

/**
 * Как шло: три рисунка по месяцам, рядом.
 *
 * --- Почему рядом, а не друг под другом -------------------------------------
 *
 * Три рисунка друг под другом — это почти тысяча точек высоты ради трёх
 * вопросов, на которые смотрят вместе: «дотянул ли до нормы», «когда вышел в
 * плюс» и «сколько ночных». Глаз сравнивает их по одним и тем же месяцам, а
 * месяцы у всех трёх одни и те же, в одном порядке. Рядом они читаются как
 * одна картина года; один под другим — как три отдельных страницы.
 *
 * На телефоне рядом им не уместиться, и там их место занимает переключатель:
 * один рисунок на весь экран, два других — одним нажатием. Три подряд заставили
 * бы листать полторы тысячи точек, чтобы дойти до таблицы.
 *
 * --- Почему не одна плашка на рисунок ---------------------------------------
 *
 * Плашка на рисунок была из-за вопросов: у каждого свой, и общая рамка вокруг
 * троих читалась бы как один ответ в трёх частях. Здесь вопрос общий — «как шёл
 * период», а заголовки у рисунков остаются свои, и этого хватает, чтобы их
 * различать.
 *
 * Ночные часы — отдельным рисунком, а не второй осью: величина другая, и
 * подсадить их к норме значило бы выдумать связь, которой в данных нет. Рисунка
 * нет вовсе, если ночных нет: пустое поле с осью от нуля до единицы — это не
 * «ночных не было», это «что-то сломалось».
 */
type CourseView = "fact" | "balance" | "night";

function Course({ stats }: { stats: Statistics }) {
  const [view, setView] = useState<CourseView>("fact");

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

  const hasNight = stats.months.some((it) => it.nightHours.greaterThan(0));

  const views: { id: CourseView; label: string }[] = [
    { id: "fact", label: "Норма и факт" },
    { id: "balance", label: "Баланс" },
    ...(hasNight ? [{ id: "night" as const, label: "Ночные" }] : []),
  ];
  // Выбранного рисунка могло не стать: ночные исчезли, когда сменили профиль.
  const shown = views.some((it) => it.id === view) ? view : "fact";
  // Скрыт только на узком экране: от `lg` рисунки стоят рядом все сразу.
  const only = (id: CourseView) => (id === shown ? undefined : "max-lg:hidden");

  return (
    <section className="space-y-4">
      <Segmented label="Рисунок" className="w-full lg:hidden">
        {views.map((it) => (
          <SegmentedItem
            key={it.id}
            active={it.id === shown}
            onClick={() => setView(it.id)}
            className="flex-1"
          >
            {it.label}
          </SegmentedItem>
        ))}
      </Segmented>

      <div className={cn("grid gap-x-8 gap-y-6", hasNight ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
        <div className={only("fact")}>
          <ColumnChart
            title="Норма и факт по месяцам"
            columns={normFact}
            bar={{ name: "Отработано", colour: TONE.fact, shape: "bar" }}
            target={{ name: "Норма месяца", colour: TONE.norm, shape: "tick" }}
            format={axis}
          />
        </div>

        <div className={only("balance")}>
          <BalanceChart
            title="Как копится баланс"
            columns={running}
            format={axis}
            over={TONE.over}
            under={TONE.under}
          />
        </div>

        {hasNight ? (
          <div className={only("night")}>
            <ColumnChart
              title="Ночные часы по месяцам"
              columns={night}
              bar={{ name: "Ночные", colour: TONE.night, shape: "bar" }}
              format={axis}
              // У соседних рисунков легенда есть, у этого серия одна и легенды
              // нет: место под неё держится, чтобы оси стояли на одной линии.
              alignWithLegend
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Заголовок раздела внутри плашки — голосом сайта. */
const TITLE = "font-display text-sm font-bold uppercase tracking-wide";

/**
 * Одно событие так, как его показывают строкой.
 *
 * Собирается из записи заранее (`calloutLine`, `absenceLine`), а не
 * разбирается в разметке: единственное событие в строке свода и перечень в
 * раскрытой строке рисуются одной и той же строкой, и расходиться им нельзя.
 */
interface EventLine {
  key: string;
  mark: string;
  tone: string;
  /** Даты отрезка словами: «10 февраля» или «18 мая — 20 мая». */
  when: string;
  /** Заметки одной строкой — или `null`, если их нет. */
  note: string | null;
  /** Вид события, если он в этом перечне не один. */
  label?: string;
  /** Сутки и часы. */
  count: string;
}

function calloutLine(it: CalloutEntry): EventLine {
  return {
    key: it.id,
    mark: CALLOUT_MARK,
    tone: CALLOUT_TONE,
    when: spanWords(it.from, it.to),
    note: noteWords(it.notes, it.from !== it.to),
    label: CALLOUT_LABELS[it.kind],
    count: `${days(it.days)} · ${hours(it.hours.toNumber())}`,
  };
}

function absenceLine(it: AbsenceEntry, named: boolean): EventLine {
  return {
    key: it.id,
    mark: ABSENCE_MARK[it.kind],
    tone: ABSENCE_TONE[it.kind],
    when: spanWords(it.from, it.to),
    note: noteWords(it.notes, it.from !== it.to),
    label: named ? ABSENCE_LABELS[it.kind] : undefined,
    count: days(it.days),
  };
}

/**
 * Четыре разговора о пропущенных сменах, а не один.
 *
 * `leave` — отдых, за которым шли сами: отпуск, дополнительный, учебный.
 * `sick` — больничный: не планируется, платится по своему правилу и
 * спрашивается по датам. `off` — отгул: единственный, кто норму не
 * уменьшает. `trip` — командировка: единственная, где человек работал, и
 * складывать её с отпусками значило бы отвечать «сколько отдыхал» числом,
 * в которое вошли рабочие поездки. Спрашивают о ней к тому же как о
 * больничном — по датам: «сколько раз и когда отправляли», а не «сколько
 * всего суток».
 *
 * Каждой группе свой раздел в своде по всем.
 */
type AbsenceGroup = "leave" | "sick" | "off" | "trip";

function groupNameOf(kind: AbsenceKind): AbsenceGroup {
  if (kind === "time_off_in_lieu") return "off";
  if (kind === "sick_leave") return "sick";
  if (kind === "business_trip") return "trip";
  return "leave";
}

function groupOf(
  entries: readonly AbsenceEntry[],
  group: AbsenceGroup,
): readonly AbsenceEntry[] {
  return entries.filter((it) => groupNameOf(it.kind) === group);
}

/**
 * Итог группы: сутки и снятые ими часы нормы.
 *
 * Сутки берутся из свода по видам, а не сложением записей: свод считает их
 * по КАЛЕНДАРЮ отрезка, и два наложившихся отпуска дают в нём одни сутки, а
 * не двое (`absencesOf` в модели). Часов у отгула нет вовсе — у него и в
 * итоге одни сутки.
 */
function absenceTotal(
  absences: readonly AbsenceStat[],
  group: AbsenceGroup,
): string | null {
  const kinds = absences.filter((it) => groupNameOf(it.kind) === group);
  if (kinds.length === 0) return null;

  const dayCount = kinds.reduce((sum, it) => sum + it.days, 0);
  const excluded = kinds.reduce((sum, it) => sum + (it.hours?.toNumber() ?? 0), 0);
  return excluded > 0
    ? `${days(dayCount)} · −${hours(excluded)} из нормы`
    : days(dayCount);
}

/** Вид, которым группа представлена одним знаком: тот, что взял больше суток. */
function faceOf(
  absences: readonly AbsenceStat[],
  group: AbsenceGroup,
): AbsenceKind | null {
  let top: AbsenceStat | null = null;
  for (const it of absences) {
    if (groupNameOf(it.kind) !== group) continue;
    if (top === null || it.days > top.days) top = it;
  }
  return top?.kind ?? null;
}

function days(count: number): string {
  return `${count} ${numberWord(count, "день", "дня", "дней")}`;
}

/**
 * Заметки записи — одной строкой.
 *
 * Их бывает несколько: своя у записи и дневные внутри её отрезка. Своя
 * идёт первой и без даты (она про весь отрезок), у дневной на записи
 * длиннее суток дата названа — иначе непонятно, к какому дню она.
 */
function noteWords(notes: readonly EventNote[], dated: boolean): string | null {
  if (notes.length === 0) return null;
  return notes
    .map((note) =>
      note.day !== null && dated ? `${formatDayMonthRu(note.day)}: ${note.text}` : note.text,
    )
    .join(" · ");
}

/**
 * Строка события: знак, дата и числа — одной строкой, пометка под ней.
 *
 * --- Почему слева дата ------------------------------------------------------
 *
 * Слева, сразу за знаком, стоит то, что у строки главное, — КОГДА это было. Вид
 * («Соревнования») и заметка идут вторым рядом, мельче: они отвечают на вопрос
 * «что это было», который задают вторым, а числа справа — на «сколько».
 *
 * --- Почему заметка под датой, а не рядом -----------------------------------
 *
 * Рядом с датой она вытягивала строку в длину и на узкой колонке переносилась
 * куда придётся, ломая и числа справа. Второй строкой она занимает ровно столько
 * места, сколько ей нужно, цветом тусклее даты — приписка не должна её
 * перебивать, — и длинную заметку строка переносит, а не обрезает: прятать её
 * значило бы прятать ровно тогда, когда её читают.
 *
 * Знак — тот же, что стоит у этих суток на сетке, но на четверть мельче прежнего:
 * строк в статистике много, и каждая точка высоты у них на счету.
 */
function EventRow({ line }: { line: EventLine }) {
  const aside = [line.label, line.note].filter((it) => it !== undefined && it !== null).join(" · ");

  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span
        aria-hidden
        className={cn(
          "mt-px grid size-6 shrink-0 place-items-center rounded-md border text-[11px] font-bold",
          line.tone,
        )}
      >
        {line.mark}
      </span>
      <span className="min-w-0 flex-1">
        {/* Первая строка не ниже знака: дата стоит против его середины, а не
            против верха. Числа — неразрывным куском: «60» на одной строке и
            «ч» на следующей — это не перенос, а поломка. */}
        <span className="flex min-h-6 flex-wrap items-center justify-between gap-x-3">
          <span className="min-w-0 text-sm">{line.when}</span>
          <span className="font-mono text-xs tabular-nums whitespace-nowrap text-ink-muted">
            {line.count}
          </span>
        </span>
        {aside === "" ? null : (
          <span className="-mt-0.5 block text-xs text-ink-faint">{aside}</span>
        )}
      </span>
    </li>
  );
}

/** Отрезок словами: одни сутки называются одной датой, а не дважды. */
function spanWords(from: IsoDate, to: IsoDate): string {
  return from === to
    ? formatDayMonthRu(from)
    : `${formatDayMonthRu(from)} — ${formatDayMonthRu(to)}`;
}

function Head({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-3 py-1.5 text-right font-medium last:pr-0">
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
        "px-3 py-1.5 text-right font-mono tabular-nums last:pr-0",
        tone === "over" && "text-verify",
        tone === "under" && "text-signal",
      )}
    >
      {children}
    </td>
  );
}

/**
 * Точные числа: таблица по месяцам.
 *
 * Месяцами человек живёт — табель, зарплата, график сменности, — и всё, что
 * нарисовано выше, читается здесь цифрами: норма, факт, баланс, ночные и
 * праздничные часы, смены. Справа — итог выбранного периода, посчитанный своим
 * расчётом, а не суммой месяцев: норма считается по отрезку (ст. 104 ТК РФ), и
 * сумма месячных норм с ней может разойтись.
 *
 * Таблицы по кварталам и полугодиям здесь нет: она была, и её убрали — для
 * кварталов есть выбор периода над сеткой, который перестраивает и статистику.
 */
function Numbers({ stats }: { stats: Statistics }) {
  const { total } = stats;
  const kind = stats.part.kind;

  const months: LedgerColumn[] = [
    ...stats.months
      .filter((it) => !it.empty)
      .map((it) => ({
        key: String(it.month),
        head: SHORT[it.month]!,
        full: MONTH_NAMES[it.month]!,
        norm: it.normHours,
        actual: it.actualHours,
        balance: it.balance.toNumber(),
        night: it.nightHours,
        holiday: it.holidayHours,
        shifts: it.workedShifts,
      })),
    {
      key: "total",
      head: TOTAL_HEAD[kind],
      full: WHOLE_PERIOD[kind],
      total: true,
      norm: total.normHours,
      actual: total.actualHours,
      balance: total.actualHours.minus(total.normHours).toNumber(),
      night: total.nightHours,
      holiday: total.holidayHours,
      shifts: total.workedShifts,
    },
  ];

  return (
    <section className="space-y-1">
      <h3 className={TITLE}>По месяцам</h3>
      <Ledger
        caption={`Норма, отработанные, ночные и праздничные часы по месяцам: за ${periodPhrase(stats.part, stats.year)}`}
        columns={months}
      />
    </section>
  );
}

/** Подпись итогового столбца — по виду периода. */
const TOTAL_HEAD = {
  year: "Год",
  half_year: "Полугодие",
  quarter: "Квартал",
} as const;

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
 * ОБЩЕЙ СУММЫ. Плашка с итогом по всем — норма, отработано, баланс — тут
 * стояла первой и обещала то, чего в ней нет: сложенная переработка шести
 * человек не переработка, а число, которое некому предъявить. Норма
 * считается каждому своя, по его отрезку и его освобождениям, и сумма
 * двенадцати норм — не норма отдела. Свод отвечает на вопрос «у КОГО
 * сколько», и отвечают на него строки, а не итог под ними: потому убрана
 * и строка «Всего» в таблице.
 *
 * Рисунков по месяцам. Месяц у каждого профиля свой, и двенадцать столбцов,
 * сложенных по шести людям, отвечают на вопрос, которого никто не задавал.
 * Сравнивают профили между собой — а для этого годится полоска доли при
 * имени и таблица, где числа стоят точно.
 *
 * Столбцов с подписями-именами тоже нет: подпись под столбцом — это
 * несколько точек ширины, а имя профиля в них не влезает ни при каком
 * сокращении.
 *
 * --- Почему тот же свод показывает и папку ----------------------------------
 *
 * Папка в проводнике — это не «место, куда сложили файлы», а единица, о
 * которой спрашивают: «4-й караул», «2025 год», «уволившиеся». Вопрос к
 * папке ровно тот же, что ко всем профилям, — сколько у нас вышло, — и
 * отвечать на него вторым, отдельно устроенным разделом значило бы
 * заставить выучить второй способ читать одни и те же числа. Меняются
 * только заголовок и то, из каких профилей сложена сумма.
 */
function Summary({
  sheets,
  part,
  onPick,
}: {
  sheets: readonly Sheet[];
  part: PeriodPart;
  onPick: (id: string) => void;
}) {
  // По расчёту на профиль, а не по тринадцать: месяцы в своде не показаны,
  // и считать их значило бы потратить дюжину вызовов на каждого ради
  // чисел, которых на экране нет (`totalsOf`). Доля года — общая, год у
  // каждого свой.
  const lines = useMemo(
    () =>
      sheets.map((sheet) => ({
        sheet,
        totals: totalsOf(sheet.profile, undefined, { kind: part.kind, index: part.index }),
      })),
    [sheets, part.kind, part.index],
  );

  const live = lines.filter((line) => line.totals.any);

  // Группы событий — в том порядке, в каком их читают: сначала то, что принесло
  // часы сверх графика, потом то, что сняло их с нормы. Пустые отброшены, а строки
  // расставлены от большего к меньшему сразу, чтобы плашка вокруг них не
  // появлялась там, где показывать нечего.
  const groups = [
    {
      title: "Сверх графика",
      rows: live.map((line) => ({
        id: line.sheet.id,
        name: line.sheet.name,
        value: line.totals.calloutHours.toNumber(),
        count: hours(line.totals.calloutHours.toNumber()),
        mark: CALLOUT_MARK,
        tone: CALLOUT_TONE,
        lines: line.totals.calloutEntries.map(calloutLine),
      })),
    },
    // Отпуска названы в строках по видам, больничные, командировки и отгулы —
    // нет: там вид один и он написан в заголовке группы.
    { title: "Отпуска", rows: live.map((line) => absenceRow(line, "leave", true)) },
    { title: "Больничные", rows: live.map((line) => absenceRow(line, "sick", false)) },
    { title: "Командировки", rows: live.map((line) => absenceRow(line, "trip", false)) },
    { title: "Отгулы", rows: live.map((line) => absenceRow(line, "off", false)) },
  ]
    .map((group) => ({
      title: group.title,
      rows: group.rows.filter((row) => row.value > 0).sort((a, b) => b.value - a.value),
    }))
    .filter((group) => group.rows.length > 0);

  return (
    <div className="space-y-10">
      {/* Таблица — первой: свод открывают ради вопроса «у кого сколько», и
          отвечает на него она, а полоски под ней — на «кто вырывается вперёд».
          Раньше она стояла последней, под пятью перечнями. */}
      <ProfileTable lines={lines} onPick={onPick} />

      {groups.length === 0 ? null : (
        <section className="space-y-3">
          <h3 className={TITLE}>События</h3>
          <div className="columns-1 gap-x-8 md:columns-2 2xl:columns-3">
            {groups.map((group) => (
              <Shares key={group.title} title={group.title} rows={group.rows} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Строка свода по одной группе освобождений: числа, знак и её события. */
function absenceRow(line: Line, group: AbsenceGroup, named: boolean) {
  const kinds = line.totals.absences.filter(
    (it) => groupNameOf(it.kind) === group,
  );
  const kind = faceOf(line.totals.absences, group);

  return {
    id: line.sheet.id,
    name: line.sheet.name,
    value: kinds.reduce((sum, it) => sum + it.days, 0),
    count: absenceTotal(line.totals.absences, group) ?? days(0),
    mark: kind === null ? "" : ABSENCE_MARK[kind],
    tone: kind === null ? "" : ABSENCE_TONE[kind],
    lines: groupOf(line.totals.absenceEntries, group).map((it) =>
      absenceLine(it, named),
    ),
  };
}

/** Одна строка свода: профиль и его год в числах. */
interface Line {
  readonly sheet: Sheet;
  readonly totals: ProfileTotals;
}

/**
 * Раздел свода: у кого сколько — полосками, и каждая строка раскрывается.
 *
 * --- Почему полоски ---------------------------------------------------------
 *
 * Это тот вопрос, ради которого свод чаще всего и открывают: часы сверх
 * своих смен и дни отпусков распределены между людьми неравномерно, и
 * увидеть это надо не в столбце цифр, а глазом. Полоска — доля от
 * НАИБОЛЬШЕГО, а не от суммы: сравнивают людей друг с другом, а не с общим
 * котлом.
 *
 * --- Почему строка раскрывается ---------------------------------------------
 *
 * «32 часа» отвечают на вопрос «сколько», а спорят о том, КОГДА и за что.
 * До сих пор за этим приходилось уходить на сетку самого профиля и
 * возвращаться обратно — по строке на каждого, кого хочешь проверить.
 * Теперь строка раскрывается в сами события: тот же знак, что стоит у этих
 * суток на сетке, дата и заметка.
 *
 * Раскрывается только та, где событий БОЛЬШЕ ОДНОГО. Где оно одно,
 * раскрывать нечего: дата и заметка стоят прямо в строке, рядом с именем,
 * и кнопка с уголком обещала бы там подробности, которых нет.
 *
 * --- Чего здесь нет ---------------------------------------------------------
 *
 * Строк с нулём. Профиль, которого ни разу не вызывали, в перечне вызовов
 * не нужен: он есть в таблице ниже, а здесь его пустая полоска сбивала бы
 * меру у остальных.
 */
function Shares({
  title,
  rows,
}: {
  title: string;
  /** Уже без нулей и от большего к меньшему: порядок и меру задаёт свод. */
  rows: readonly {
    id: string;
    name: string;
    /** Величина полоски и порядок строк. */
    value: number;
    count: string;
    /** Знак вида — пока строка не раскрыта (`Face`). */
    mark: string;
    tone: string;
    lines: readonly EventLine[];
  }[];
}) {
  const most = rows[0]?.value ?? 1;

  return (
    <section className="mb-4 break-inside-avoid">
      <h4 className="font-display text-xs font-bold tracking-wide uppercase">{title}</h4>

      <ul className="mt-1 divide-y divide-rule">
        {rows.map((row) => (
          <ShareRow key={row.id} row={row} share={row.value / most} />
        ))}
      </ul>
    </section>
  );
}

function ShareRow({
  row,
  share,
}: {
  row: {
    name: string;
    count: string;
    mark: string;
    tone: string;
    lines: readonly EventLine[];
  };
  share: number;
}) {
  const [open, setOpen] = useState(false);
  // Одно событие — раскрывать нечего: оно целиком помещается в строку.
  const many = row.lines.length > 1;
  const only = many ? null : (row.lines[0] ?? null);

  const head = (
    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="min-w-0 text-sm">
        {row.name}
        {only === null ? null : (
          // Единственное событие названо тут же: дата, вид и заметка — тем
          // же тусклым цветом, каким они стоят в раскрытом перечне. Вид
          // здесь нужен ровно затем же, зачем в перечне: «28 дней» не
          // говорят, отпуск это был или больничный.
          <span className="ml-2 text-xs text-ink-faint">
            {only.when}
            {only.label === undefined ? "" : ` · ${only.label}`}
            {only.note === null ? "" : ` · ${only.note}`}
          </span>
        )}
      </span>
      <span className="font-mono text-xs tabular-nums text-ink-muted">
        {row.count}
      </span>
    </span>
  );

  return (
    <li className="py-2">
      {many ? (
        <button
          type="button"
          onClick={() => setOpen((it) => !it)}
          aria-expanded={open}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 text-left",
            "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
          )}
        >
          {/* Уголок — единственный признак того, что строка раскрывается.
              Он же говорит, раскрыта ли она: вниз — закрыта, вверх —
              открыта. */}
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-ink-faint transition-transform",
              open && "rotate-180",
            )}
          />
          <Face mark={row.mark} tone={row.tone} shown={!open} />
          <span className="min-w-0 flex-1">{head}</span>
        </button>
      ) : (
        // Без кнопки и без уголка, но с тем же отступом слева: строки
        // раздела обязаны стоять в один столбец, раскрывается строка или
        // нет.
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-3.5 shrink-0" />
          <Face mark={row.mark} tone={row.tone} shown />
          <span className="min-w-0 flex-1">{head}</span>
        </span>
      )}

      {/* Полоска — вровень с именем, то есть за знаком: она про эту строку,
          а не про весь раздел. Отступ считается по мерам слева: уголок
          (14) и просвет (8) — это 1,375 рема, знак (28) и просвет (12)
          добавляют к ним ещё 2,5. */}
      <span className="ml-[3.875rem] block">
        <ShareBar share={share} />
      </span>

      {open ? (
        // Перечень внутри строки — теми же строками, что в статистике
        // профиля. Линовка между ними своя, а слева отступ ровно на уголок:
        // знаки событий встают на место знака, который строка отдала,
        // раскрывшись.
        <ul className="ml-[1.375rem] mt-1 divide-y divide-rule border-t border-rule">
          {row.lines.map((line) => (
            <EventRow key={line.key} line={line} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Знак вида у строки свода — пока она не раскрыта.
 *
 * Строка свода говорит о нескольких событиях сразу, и знак у неё — знак
 * того вида, который взял больше суток. Раскрывшись, она отдаёт своё место
 * знакам самих событий: два столбца знаков подряд читались бы как два
 * списка, а список тут один.
 *
 * Место за собой знак оставляет и раскрытым — пустым квадратом той же
 * меры. Иначе имя при раскрытии прыгало бы влево, а полоска под ним — вслед
 * за ним.
 */
function Face({ mark, tone, shown }: { mark: string; tone: string; shown: boolean }) {
  if (!shown || mark === "") {
    return <span aria-hidden className="size-7 shrink-0" />;
  }

  return (
    <span
      aria-hidden
      // Тот же значок, что стоит у этих суток на сетке и в строке события:
      // клетка в семь единиц, рамка, полужирный кегль.
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md border text-xs font-bold",
        tone,
      )}
    >
      {mark}
    </span>
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
  // Полоска баланса — доля от наибольшего по модулю: сравнивают людей друг с
  // другом, а не с общим котлом (так же, как полоски в разделах событий).
  const most = Math.max(
    1,
    ...lines.filter((line) => line.totals.any).map((line) => Math.abs(line.totals.balance.toNumber())),
  );

  return (
    <section className="space-y-2">
      <h3 className={TITLE}>По графикам</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] border-collapse text-sm">
          <caption className="sr-only">
            Норма, отработанные, ночные и праздничные часы по графикам
          </caption>
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-ink-faint">
              <th scope="col" className="py-1.5 pr-3 text-left font-medium">
                График
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
              <ProfileRow key={line.sheet.id} line={line} most={most} onPick={onPick} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProfileRow({
  line,
  most,
  onPick,
}: {
  line: Line;
  most: number;
  onPick: (id: string) => void;
}) {
  const { sheet, totals } = line;

  // Год, которого ещё не было, — прочерки, а не нули: ноль в колонке
  // «Норма» читается как «норма нулевая», и это неправда.
  if (!totals.any) {
    return (
      <tr className="text-ink-faint">
        <ProfileName sheet={sheet} onPick={onPick} />
        {Array.from({ length: 6 }, (_, index) => (
          <td key={index} className="px-3 py-1.5 text-right font-mono tabular-nums last:pr-0">
            —
          </td>
        ))}
      </tr>
    );
  }

  return (
    <tr>
      <ProfileName sheet={sheet} onPick={onPick} />
      <Cell>{hoursTrim(totals.total.normHours)}</Cell>
      <Cell>{hoursTrim(totals.total.actualHours)}</Cell>
      <BalanceCell value={totals.balance} most={most} />
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
    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
      <button
        type="button"
        onClick={() => onPick(sheet.id)}
        title={`Статистика графика «${sheet.name}»`}
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

/**
 * Баланс в таблице: число со знаком и цветом итога, а слева от него — полоска.
 *
 * Число остаётся главным, и читается таблица без цвета и без полоски. Полоска
 * добавляет то, чего в столбце цифр не видно с первого взгляда: у кого переработка
 * больше всех и кто ушёл в минус. Знак передан и ею: цветом, и тем, что число
 * рядом начинается с «+» или «−».
 */
function BalanceCell({ value, most }: { value: Decimal; most: number }) {
  const balance = value.toNumber();
  return (
    <Cell tone={balance > 0 ? "over" : balance < 0 ? "under" : undefined}>
      <span className="inline-flex items-center justify-end gap-2">
        <span
          aria-hidden
          className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-paper-sunken"
        >
          <span
            className={cn(
              "block h-full rounded-full",
              balance < 0 ? "bg-signal" : "bg-verify",
            )}
            style={{ width: `${balance === 0 ? 0 : Math.max(4, Math.round((Math.abs(balance) / most) * 100))}%` }}
          />
        </span>
        {signed(balance)}
      </span>
    </Cell>
  );
}

