"use client";

import {
  CalendarDays,
  CalendarRange,
  ChartColumn,
  FolderOpen,
  Save,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";

import { HelpMenuItem, MenuItem } from "@/components/shared/header-menu";
import { RailKnob } from "@/components/shared/header-rail";

import { SECTION_HASH } from "./section-hash";

/**
 * Действия рабочего экрана — строками в меню шапки.
 *
 * --- Что это за действия ---------------------------------------------------
 *
 * Их пять, и они об одном — о профиле: настроить нынешний, посмотреть, что
 * в него внесено, посмотреть, что из всего этого вышло, открыть другой,
 * сохранить нынешний в файл. Порядок тот, в каком читается история
 * профиля. «Открыть» стоит четвёртым намеренно — это единственное
 * действие, уносящее нынешний профиль, и соседство с «Сохранить» тут
 * кстати.
 *
 * «События» — отдельной строкой, а не закладкой настроек, где перечень
 * жил прежде: на него смотрят куда чаще, чем правят анкету, и за другим
 * (`workspace.tsx`, `eventsOpen`). Значок — отрезок дат на календаре: в
 * перечне в основном то, что длится, — отпуска, больничные, вызовы.
 *
 * --- Почему в меню, а не кнопками в шапке ----------------------------------
 *
 * Кнопками они и были: четыре плашки со значками, подписи с 768 точек,
 * ширина каждого места под самое длинное слово. Строка сходилась ровно до
 * тех пор, пока в шапке не появилась учётная запись: на телефоне четыре
 * кнопки, знак и название сайта в одну строку не встают, и уступать
 * приходилось названию — от «ГРАФИК 1|3» оставался один логотип.
 *
 * Теперь в шапке один предмет на любом экране (`shared/header-menu.tsx`),
 * и вместе с рядом ушёл весь прежний механизм: мерки ширины, стопки слов в
 * одной ячейке грида, порог подписей, подмена значка на крестик. Плата
 * названа вслух: до настроек теперь два нажатия вместо одного.
 *
 * --- Почему здесь нет ни «закрыть», ни действий проводника -----------------
 *
 * Пока на месте расчёта показан раздел, меню не открывается вовсе: кнопка
 * в шапке в этот миг закрывает раздел, и полосы на ней сложены крестиком
 * (`shared/header-menu.tsx`). Значит, список видят только из расчёта, и
 * строка «Закрыть настройки» в нём никогда бы не появилась.
 *
 * По той же причине два действия проводника — папка и график — живут
 * не в меню, а в самом проводнике: знаками под колонкой меню и у нижней кромки
 * (`explorer-dock.tsx`). Из списка меню до них было бы не добраться.
 *
 * --- Почему выгрузка живёт не здесь ----------------------------------------
 *
 * Окно выгрузки (`save-to-file.tsx`) рисует рабочий экран, а сюда
 * приходит только `onSave`: меню закрывается нажатием, и окно,
 * нарисованное внутри него, закрылось бы вместе с ним.
 *
 * --- Почему с `lg` они не в списке -------------------------------------------
 *
 * На широком экране те же пять действий стоят колонкой знаков под кнопкой меню
 * (`WorkspaceRail` ниже), а из списка скрыты (`RAIL_ONLY`). Два нажатия до
 * настроек были платой за тесноту шапки, а на широком экране теснота кончается:
 * справа свободно поле, где в правом нижнем углу уже стоит такая же колонка
 * знаков управления сеткой. Скрыты они стилем, а не условием в разметке:
 * страница серверная, ширину окна она не знает, а `AccountMenuItems` обязан
 * вести себя так же.
 */

/**
 * Строка списка, у которой с `lg` есть знак в колонке под кнопкой меню.
 * Пара к `WorkspaceRail` и `AccountRail`: меняются вместе.
 */
const RAIL_ONLY = "lg:hidden";

export function WorkspaceMenuItems({
  onToggleSettings,
  onToggleEvents,
  onToggleStats,
  onToggleExplorer,
  onSave,
}: {
  onToggleSettings: () => void;
  onToggleEvents: () => void;
  onToggleStats: () => void;
  onToggleExplorer: () => void;
  /** Открыть окно выгрузки профиля в файл. */
  onSave: () => void;
}) {
  return (
    <>
      <MenuItem icon={Settings} onClick={onToggleSettings} className={RAIL_ONLY}>
        Настройки
      </MenuItem>
      <MenuItem icon={CalendarRange} onClick={onToggleEvents} className={RAIL_ONLY}>
        События
      </MenuItem>
      <MenuItem icon={ChartColumn} onClick={onToggleStats} className={RAIL_ONLY}>
        Статистика
      </MenuItem>
      <MenuItem icon={FolderOpen} onClick={onToggleExplorer} className={RAIL_ONLY}>
        Графики
      </MenuItem>
      <MenuItem icon={Save} onClick={onSave} className={RAIL_ONLY}>
        Сохранить
      </MenuItem>
      <HelpMenuItem />
    </>
  );
}

/** Раздел, показанный на месте расчёта, — знак этого раздела горит. */
export type OpenedSection = "settings" | "events" | "stats" | "graphs";

/**
 * Колонка знаков под кнопкой меню — те же пять действий, но знаками и с `lg`
 * (`shared/header-rail.tsx`).
 *
 * Колонка остаётся и пока раздел открыт, и тогда горит знак этого раздела:
 * из любого места можно перейти в соседний одним нажатием, не закрывая
 * нынешний, а нажатие по горящему закрывает его — как нажатие по кнопке
 * меню, сложенной крестиком.
 */
export function WorkspaceRail({
  opened,
  onToggleSettings,
  onToggleEvents,
  onToggleStats,
  onToggleExplorer,
  onSave,
  extra,
}: {
  opened?: OpenedSection;
  onToggleSettings: () => void;
  onToggleEvents: () => void;
  onToggleStats: () => void;
  onToggleExplorer: () => void;
  /** Открыть окно выгрузки профиля в файл. */
  onSave: () => void;
  /**
   * Знаки открытого раздела — группой под пятью основными, через клетку знака.
   *
   * Нужны проводнику: «Создать график» и «Создать папку» относятся к самому
   * списку графиков и стоят в той же колонке, что и меню, сразу под ним, а не
   * в отдельном углу окна. Пусто — на всех прочих разделах: у них действий
   * для колонки нет.
   */
  extra?: ReactNode;
}) {
  return (
    <>
      <RailKnob
        icon={Settings}
        label="Настройки"
        active={opened === "settings"}
        onClick={onToggleSettings}
      />
      <RailKnob
        icon={CalendarRange}
        label="События"
        active={opened === "events"}
        onClick={onToggleEvents}
      />
      <RailKnob
        icon={ChartColumn}
        label="Статистика"
        active={opened === "stats"}
        onClick={onToggleStats}
      />
      <RailKnob
        icon={FolderOpen}
        label="Графики"
        active={opened === "graphs"}
        onClick={onToggleExplorer}
      />
      {/* «Сохранить» не раздел, а окно: гореть ему нечем. */}
      <RailKnob icon={Save} label="Сохранить" onClick={onSave} />
      {/* `mt-11` — пусто на одну клетку знака (44 точки): столько же стояло
          между этими знаками и знаком темы, когда они были внизу окна, и
          та же клетка отделяет колонку масштаба от темы в календаре
          (`SCALE_KNOBS`). Группа отделена, потому что это не раздел меню, а
          действия внутри открытого раздела. */}
      {extra === undefined ? null : (
        <div
          role="group"
          aria-label="Действия со списком графиков"
          className="mt-11 flex flex-col items-end"
        >
          {extra}
        </div>
      )}
    </>
  );
}

/**
 * Те же пункты меню — со страницы учётной записи.
 *
 * --- Зачем ------------------------------------------------------------------
 *
 * Шапка одна на весь сайт, и меню в ней должно быть узнаваемым: человек,
 * который заходит на страницу учётной записи из расчёта, ищет в нём то же,
 * что и там, — настройки, события, статистику, графики, «Сохранить». Одной
 * строки «Открыть график», как было, мало: до настроек получалось два
 * перехода вместо одного нажатия.
 *
 * Строки здесь — ссылки, а не действия: раздела, который можно было бы
 * открыть, на этой странице нет. Каждая ведёт на расчёт с адресом раздела
 * (`SECTION_HASH`), и тот открывается сразу. «Открыть график» остаётся
 * первой: это единственный путь назад к расчёту без раздела, а название
 * сайта ведёт на посадочную.
 *
 * Отдельным компонентом без свойств — по той же причине, что
 * `OpenScheduleItem`: страница серверная, а значок пункта — функция, и
 * через границу сервера и клиента её не передать.
 */
export function AccountMenuItems({ help = true }: { help?: boolean }) {
  return (
    <>
      <MenuItem icon={CalendarDays} href="/calculator">
        Открыть график
      </MenuItem>
      <MenuItem icon={Settings} href={`/calculator#${SECTION_HASH.settings}`} className={RAIL_ONLY}>
        Настройки
      </MenuItem>
      <MenuItem icon={CalendarRange} href={`/calculator#${SECTION_HASH.events}`} className={RAIL_ONLY}>
        События
      </MenuItem>
      <MenuItem icon={ChartColumn} href={`/calculator#${SECTION_HASH.stats}`} className={RAIL_ONLY}>
        Статистика
      </MenuItem>
      <MenuItem icon={FolderOpen} href={`/calculator#${SECTION_HASH.graphs}`} className={RAIL_ONLY}>
        Графики
      </MenuItem>
      <MenuItem icon={Save} href={`/calculator#${SECTION_HASH.save}`} className={RAIL_ONLY}>
        Сохранить
      </MenuItem>
      {help ? <HelpMenuItem /> : null}
    </>
  );
}

/**
 * Те же знаки колонки — со страницы учётной записи и справки: ссылками на
 * расчёт с адресом раздела, как и строки `AccountMenuItems`, которые с `lg`
 * они заменяют. Отдельным компонентом без свойств — по той же причине, что и
 * остальные: страницы серверные, а значок пункта — функция.
 */
export function AccountRail() {
  return (
    <>
      <RailKnob icon={Settings} label="Настройки" href={`/calculator#${SECTION_HASH.settings}`} />
      <RailKnob icon={CalendarRange} label="События" href={`/calculator#${SECTION_HASH.events}`} />
      <RailKnob icon={ChartColumn} label="Статистика" href={`/calculator#${SECTION_HASH.stats}`} />
      <RailKnob icon={FolderOpen} label="Графики" href={`/calculator#${SECTION_HASH.graphs}`} />
      <RailKnob icon={Save} label="Сохранить" href={`/calculator#${SECTION_HASH.save}`} />
    </>
  );
}
