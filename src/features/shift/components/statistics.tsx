"use client";

import { Users } from "lucide-react";
import { useMemo, useState } from "react";

import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";

import {
  formatHoursTrim as hoursTrim,
  numberWord,
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
        name: open.displayName.trim() === "" ? "Открытый профиль" : open.displayName,
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
}

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
      label: `${root ? "Все профили" : folder.name} (${inside.length})`,
      depth,
    });

    for (const sheet of inside.filter((it) => it.folderId === folder.id)) {
      out.push({
        value: encode({ kind: "one", id: sheet.id }),
        // «открыт» словом, а не точкой: раскрытый список рисует
        // операционная система, и ни цвета, ни значка в нём не поставить —
        // остаётся сам текст строки.
        label: `${sheet.name}${sheet.open ? " — открыт" : ""}`,
        depth: depth + 1,
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
      out.push({ value, label: sheet.name, depth: 1 });
    }
  }

  return out;
}

/** Отступ строки — её глубиной в дереве. */
function indent(depth: number): string {
  return "\u00a0".repeat(depth * 3);
}

/** Лежит ли папка внутри другой — она сама или любой её потомок. */
function within(library: Library, folderId: string, rootId: string): boolean {
  return folderPath(library, folderId).some((it) => it.id === rootId);
}

export function Statistics({
  profile,
  onShow,
}: {
  profile: StoredProfile;
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
    // Просвет между плашками — тот же, что между карточками настроек и
    // рядами проводника: разделы тут одного рода, и разводить их вдвое
    // шире значило бы сказать, что они с разных страниц.
    <div className="space-y-4">
      {/* Выбор — только когда выбирать есть из чего. При одном профиле
          список из «Все профили» и его же имени предлагал бы выбор из
          одного и обещал бы свод, которого нет. */}
      {sheets.length > 1 ? (
        <ScopePicker
          sheets={sheets}
          library={library}
          // Не `scope`, а то, что ПОКАЗАНО: выбора могло не быть вовсе
          // (тогда стоит открытый профиль), а выбранное могло исчезнуть
          // (тогда стоит то, чем его заменили). Список обязан показывать
          // строку, которая сейчас на экране, а не намерение человека.
          value={
            one !== null
              ? { kind: "one", id: one.id }
              : folder !== null
                ? { kind: "folder", id: folder.id }
                : { kind: "all" }
          }
          onChange={choose}
        />
      ) : null}

      {group !== null ? (
        <Summary sheets={group} onPick={(id) => choose({ kind: "one", id })} />
      ) : one === null ? (
        <Summary sheets={sheets} onPick={(id) => choose({ kind: "one", id })} />
      ) : (
        <OneProfile profile={one.profile} />
      )}
    </div>
  );
}

/**
 * Чья статистика показана.
 *
 * --- Почему выпадающий список, а не ряд плашек ------------------------------
 *
 * Ряд плашек тут и стоял, и при трёх профилях читался прекрасно. Но
 * профилей бывает не три: в карауле их два десятка, и ряд из двадцати имён
 * — это три строки поперёк экрана над статистикой, ради которой сюда и
 * пришли. Вдобавок плашки не умеют главного, что здесь нужно: показать,
 * что профили сложены в ПАПКИ, и дать выбрать папку целиком.
 *
 * Список это умеет родными средствами — `optgroup`, — и на телефоне
 * открывает системный барабан вместо трёх строк мелких плашек
 * (`ui/select.tsx`, там же остальные доводы за родной `select`).
 *
 * --- Что в нём стоит --------------------------------------------------------
 *
 * Сперва «Все профили», потом папки по порядку, у каждой — «вся папка» и
 * её профили. «Вся папка» не предлагается там, где она ничего не добавляет:
 * у корневой папки (это те же «все») и у папки с единственным профилем.
 * Папки без профилей не показаны вовсе — выбрать в них нечего.
 */
/**
 * Сколько всего может стоять в горячем ряду.
 *
 * Ряд — это сокращение пути, а не второй список: в нём столько, сколько
 * помещается в строку рядом с выбором, не переносясь второй раз. Остальное
 * никуда не девается — оно в списке, из которого ряд и собран.
 */
const QUICK_MAX = 8;

function ScopePicker({
  sheets,
  library,
  value,
  onChange,
}: {
  sheets: readonly Sheet[];
  library: Library;
  value: Scope;
  onChange: (scope: Scope) => void;
}) {
  const choices = choicesOf(library, sheets);

  /**
   * Горячий ряд: то же, что в списке, но в одно нажатие.
   *
   * Сперва «Все», потом папки — они и есть то, о чём спрашивают чаще
   * всего («сколько вышло у четвёртого караула»), — и только потом
   * профили, сколько влезет. Открытый профиль среди них первый: к нему
   * возвращаются чаще, чем к любому другому.
   */
  const quick: { key: string; label: string; scope: Scope }[] = [
    { key: "all", label: "Все", scope: { kind: "all" } },
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
    });
  }

  const now = encode(value);

  return (
    // Строка управления, а не плашка.
    // -----------------------------------------------------------------------
    // Подложки у неё нет — по той же причине, по какой её нет у строки над
    // сеткой (`year-view.tsx`): плашка цвета бумаги над разделами, которые
    // сами плашки, читается вторым слоем поверх первого. Управление держится
    // формой самих кнопок, а не фоном под ними.
    //
    // И форма эта — та же, что у соседей по приложению: выбор чьей-то
    // статистики стоит к выбору периода и режиму «Онлайн» ровно в том же
    // отношении, что они друг к другу, — все трое отвечают на вопрос «что я
    // сейчас вижу». Поэтому и мера одна (`h-9`), и скругление, и свет лампы
    // по верхней кромке, и просвет между ними.
    <div className="flex flex-wrap items-center gap-2">
      {/* Поле — той же поднятой кнопкой, что и период рядом с сеткой: знак
          слева, значение, стрелка справа. Знак не украшение: в строке из
          одинаковых пилюль он единственное, что отличает их, не читая.

          На узком экране поле занимает строку целиком — рядом с ним там
          ничего не стоит. С `lg` оно ужимается по самой длинной строке
          списка (так родной `select` считает ширину), но не шире двадцати
          рем: длинное имя профиля иначе съело бы весь горячий ряд.
          Обёртка нужна дважды: ширину флексового ряда задаёт она, а не
          поле внутри неё, и знак слева держится тоже на ней
          (`ui/select.tsx`). */}
      <div className="relative w-full min-w-56 lg:w-auto lg:max-w-80">
      {/* `z-10` — не прихоть: само поле лежит в разметке ПОСЛЕ знака и
          закрашивает его своей бумагой, как всякий позиционированный
          сосед, идущий следом. */}
      <Users
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 z-10 size-4.5 -translate-y-1/2 text-ink-muted"
      />
      <Select
        id="stats-scope"
        aria-label="Чья статистика"
        // `lit` и поднятая бумага — как у кнопки периода: та же высота, то
        // же скругление, тот же блик по кромке. Рамка остаётся прозрачной,
        // а не снимается совсем: снятая, она сдвинула бы содержимое поля
        // на точку в тот миг, когда на него наводят.
        className={cn(
          "lit rounded-xl border-transparent bg-paper-raised hover:border-transparent",
          "pl-10 font-medium",
        )}
        value={now}
        onChange={(event) => onChange(decode(event.target.value))}
      >
        {choices.map((it) => (
          <option key={it.value} value={it.value}>
            {indent(it.depth)}
            {it.label}
          </option>
        ))}
      </Select>
      </div>

      {/* Горячий ряд — с того порога, где рядом с выбором остаётся пустое
          место до правого края. Ниже его нет: там и сам список занимает
          строку целиком, а второй ряд плашек под ним был бы не
          сокращением пути, а лишним экраном перед статистикой. */}
      <Segmented
        label="Быстрый выбор"
        // Тот же переключатель, что выбирает вид сетки над календарём, и с
        // теми же мерами: ячейки во всю высоту дорожки, просвет в пол-единицы,
        // никаких своих полей. Разница одна — этот переносится по строкам:
        // видов сетки два, а профилей бывает сколько угодно.
        className="hidden h-auto min-w-0 flex-1 flex-wrap justify-start lg:inline-flex lg:justify-start"
      >
        {quick.map((it) => (
          <SegmentedItem
            key={it.key}
            active={encode(it.scope) === now}
            onClick={() => onChange(it.scope)}
            className="lg:flex-none"
          >
            <span className="min-w-0 max-w-40 truncate">{it.label}</span>
          </SegmentedItem>
        ))}
      </Segmented>
    </div>
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
      {/* Ночные — последними, ниже таблицы.
          -----------------------------------------------------------------
          Порядок разделов идёт от вопроса к вопросу: чем кончился год, как
          он шёл, из чего это вышло, и точные числа в таблице. Ночные часы
          ни на один из них не отвечают: это отдельная величина, нужная при
          разговоре о доплате, а не при счёте переработки. Стоя третьим
          рисунком, они разрывали ход — между «как копится баланс» и «из
          чего он вышел» вставал вопрос из другого разговора. */}
      <NightTrend stats={stats} />
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
 * Разница одна, и она в отрезке: полоса считает ВЫБРАННЫЙ период, а
 * статистика — год целиком. По умолчанию это одно и то же, а если человек
 * сузил период до месяца, годовые числа стоят в строке «За год» таблицы по
 * месяцам.
 */
function Figures({ stats }: { stats: Statistics }) {
  const { total } = stats;

  return (
    <section className={cn(PLATE, "space-y-2 lg:hidden")}>
      <h3 className="font-display text-sm font-bold uppercase tracking-wide">
        За {stats.year} год
      </h3>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
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
          columns={normFact}
          bar={{ name: "Отработано", colour: TONE.fact, shape: "bar" }}
          target={{ name: "Норма месяца", colour: TONE.norm, shape: "tick" }}
          format={axis}
        />
      </div>

      <div className={PLATE}>
        <BalanceChart
          title="Как копится баланс"
          columns={running}
          format={axis}
          over={TONE.over}
          under={TONE.under}
        />
      </div>
    </div>
  );
}

/**
 * Ночные часы по месяцам — отдельным рисунком и в самом низу.
 *
 * Отдельным — потому что величина другая: подсадить их к норме второй осью
 * значило бы выдумать связь, которой в данных нет. В самом низу — потому
 * что и вопрос другой: остальное на странице про переработку, а ночные про
 * доплату, и читают их, когда с переработкой уже разобрались.
 *
 * Рисунка нет вовсе, если ночных нет: пустое поле с осью от нуля до
 * единицы — это не «ночных не было», это «что-то сломалось».
 */
function NightTrend({ stats }: { stats: Statistics }) {
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

  if (!stats.months.some((it) => it.nightHours.greaterThan(0))) return null;

  return (
    <div className={PLATE}>
      <ColumnChart
        title="Ночные часы по месяцам"
        columns={night}
        bar={{ name: "Ночные", colour: TONE.night, shape: "bar" }}
        format={axis}
      />
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
  const { absences } = stats;
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
      <h3 className="font-display text-sm font-bold uppercase tracking-wide">
        Освобождения
      </h3>

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
function Summary({ sheets, onPick }: { sheets: readonly Sheet[]; onPick: (id: string) => void }) {
  // По расчёту на профиль, а не по тринадцать: месяцы в своде не показаны,
  // и считать их значило бы потратить дюжину вызовов на каждого ради
  // чисел, которых на экране нет (`totalsOf`).
  const lines = useMemo(
    () => sheets.map((sheet) => ({ sheet, totals: totalsOf(sheet.profile) })),
    [sheets],
  );

  return (
    <div className="space-y-4">
      <CalloutShares lines={lines.filter((line) => line.totals.any)} />
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
 * Сколько кого вызывали помимо графика — полосками.
 *
 * Это тот вопрос, ради которого свод чаще всего и открывают: часы сверх
 * своих смен распределены между людьми неравномерно, и увидеть это надо
 * не в столбце цифр, а глазом. Полоска здесь — доля от наибольшего, а не
 * от суммы: сравнивают людей друг с другом, а не с общим котлом.
 *
 * Пояснения под заголовком нет. Оно объясняло ровно то, что видно: что
 * полоски мерятся от самой длинной. Строка, пересказывающая рисунок,
 * отодвигает сам рисунок на строку вниз и больше ничего не делает.
 */
function CalloutShares({ lines }: { lines: readonly Line[] }) {
  const called = lines
    .filter((line) => line.totals.calloutHours.greaterThan(0))
    .sort((a, b) => b.totals.calloutHours.comparedTo(a.totals.calloutHours));

  if (called.length === 0) return null;

  const most = called[0]!.totals.calloutHours.toNumber();

  return (
    <section className={cn(PLATE, "space-y-2")}>
      <h3 className="font-display text-sm font-bold uppercase tracking-wide">
        Вызовы
      </h3>

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

