"use client";

import {
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  ChartColumn,
  Check,
  Folder,
  FolderOpen,
  Grid3x3,
  RotateCcw,
  Save,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { LegendMark } from "@/components/shared/header-action";
import { BalanceCaption } from "@/components/ui/balance-caption";
import type { LayoutSection } from "@/components/ui/section-layout";
import { Figure } from "@/components/ui/summary-figure";
import { CalendarIcon, PeriodIcon, ShiftsIcon } from "@/features/shift/components/grid-icons";
import { TODAY_MARK } from "@/features/shift/components/month-grid";
import {
  ABSENCE_MARK,
  ABSENCE_TONE,
  CALLOUT_MARK,
  CALLOUT_TONE,
  DAY_OFF_MARK,
  DAY_OFF_TONE,
  SHIFT_TAIL_TONE,
  SHIFT_TONE,
} from "@/features/shift/components/day-marks";
import {
  ABSENCE_EFFECT,
  DAY_TYPES,
  DAY_TYPE_EFFECT,
  DAY_TYPE_LABELS,
  DAY_TYPE_MARK,
  DAY_TYPE_TONE,
} from "@/features/shift/schemas";
import { SYNC_ENABLED } from "@/features/sync/ui/enabled";
import { cn } from "@/lib/utils/cn";

import { CellPicture, PictureGroup } from "./help-pictures";

/**
 * Разделы справки и их содержимое.
 *
 * --- Что в справке и чего в ней нет ---------------------------------------------
 *
 * Справка не пересказывает экран. Раньше в ней было восемь разделов и почти
 * полсотни строк — каждая клетка, каждый знак у кромки, тема, масштаб, строка
 * подсказок, — и большая часть читалась как подпись «кнопка называется кнопкой»:
 * то, что видно глазом и подсказано наведением, в справке не нужно, а нужное в
 * этой куче терялось.
 *
 * Теперь шесть разделов по тому, что человек делает в приложении, — создаёт
 * профиль, смотрит график, сверяется с календарём, отмечает события, читает
 * статистику, ведёт несколько графиков. В каждом — то, чего с экрана не видно:
 *
 * * что именно спрашивают и зачем (цикл раскладывается от ЛЮБОЙ смены, а не от
 *   первой в году; «начало отсчёта» нужно тем, кто устроился посреди года);
 * * как отмеченное влияет на расчёт: отпуск уменьшает норму, отгул — нет, а
 *   вызов прибавляется к отработанному;
 * * где что искать и что исчезнет, если нажать (крестик в «Событиях», выход из
 *   учётной записи).
 *
 * Расшифровку цветов и букв клеток держит «Легенда» самого приложения; в
 * справке она не дублируется, а только названа. Оговорка «расчёт справочный» —
 * в подвале каждой страницы, в том числе этой, и здесь её повторять незачем.
 *
 * --- Как устроена строка ----------------------------------------------------
 *
 * Слева — сам элемент, крупнее, чем в приложении; справа — что это и зачем. Так
 * устроены и показы «Как работает» на главной странице, но там элемент оживает,
 * а здесь он стоит: справка нужна, чтобы остановиться и рассмотреть, и движение
 * этому мешает.
 *
 * Пояснения повторяют слова самого приложения — подписи, кнопки, пункты меню, —
 * а не пересказывают их своими: слово из справки должно находиться на экране
 * буквально.
 */

export type HelpSectionId = "create" | "schedule" | "calendar" | "events" | "stats" | "graphs";

export const HELP_SECTIONS: readonly LayoutSection<HelpSectionId>[] = [
  { id: "create", title: "Создание профиля", icon: CalendarPlus },
  { id: "schedule", title: "График", icon: Grid3x3 },
  { id: "calendar", title: "Производственный календарь", icon: CalendarDays },
  { id: "events", title: "События", icon: CalendarRange },
  { id: "stats", title: "Статистика", icon: ChartColumn },
  { id: "graphs", title: "Графики", icon: FolderOpen },
];

export const HELP_SECTION_IDS = HELP_SECTIONS.map((section) => section.id);

/** Значок из набора в рост строки справки. */
function Big({ icon: Icon, muted = true }: { icon: LucideIcon; muted?: boolean }) {
  return <Icon aria-hidden className={cn("size-14", muted ? "text-ink/70" : "text-ink")} />;
}

/** Строка справки: пиктограмма слева, пояснение справа. */
function Row({
  picture,
  title,
  children,
}: {
  picture: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    // В строку пиктограмма и текст встают там, где для текста остаётся ширина: на
    // широком экране (`lg`) и на среднем телефоне без списка разделов слева
    // (`sm`–`md`). На планшете (`md`–`lg`) список слева отнимает ширину, и текст
    // в полторы сотни точек читался бы столбиком — там пиктограмма стоит над ним.
    <div
      className={cn(
        "flex flex-col gap-4 py-6 first:pt-0 last:pb-0",
        "sm:max-md:flex-row sm:max-md:items-center sm:max-md:gap-10",
        "lg:flex-row lg:items-center lg:gap-10",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "flex min-h-20 shrink-0 items-center justify-start",
          "sm:max-md:w-48 sm:max-md:justify-center lg:w-48 lg:justify-center",
        )}
      >
        {picture}
      </div>
      <div className="min-w-0 space-y-1.5">
        <h3 className="text-md font-medium text-ink">{title}</h3>
        <div className="max-w-[58ch] space-y-2 text-sm leading-6 text-ink-muted">{children}</div>
      </div>
    </div>
  );
}

function Rows({ lead, children }: { lead: string; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <p className="max-w-[62ch] text-sm leading-6 text-ink-muted">{lead}</p>
      <div className="divide-y divide-rule">{children}</div>
    </div>
  );
}

/** Буква вида суток на плитке — как в легенде и в перечне у дня. */
function Letter({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex size-12 items-center justify-center rounded-md border bg-paper-raised font-mono text-lg",
        tone,
      )}
    >
      {children}
    </span>
  );
}

/** Выделение слова из подписи приложения. */
function Q({ children }: { children: ReactNode }) {
  return <span className="text-ink">«{children}»</span>;
}

/** Первая буква строчная — чтобы фраза из словаря встала после тире. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// --- Создание профиля -----------------------------------------------------

/** Три готовых цикла смен — как они подписаны в окне и в шапке. */
function CyclePills() {
  return (
    <span className="flex items-center gap-2">
      {["1|3", "2|2", "5|2"].map((cycle) => (
        <span
          key={cycle}
          className="rounded-md border border-rule bg-paper-raised px-2.5 py-1.5 font-mono text-sm text-ink"
        >
          {cycle}
        </span>
      ))}
    </span>
  );
}

function Create() {
  return (
    <Rows lead="Приложение считает норму рабочего времени по производственному календарю и сравнивает её с тем, что вы отработали. Всё начинается с профиля — вашего графика работы и правил расчёта.">
      <Row picture={<CyclePills />} title="Что спросит окно">
        <p>
          Цикл смен (1|3, 1|4, 2|2, 5|2 или свой), дату любой вашей смены, время её начала и
          длительность, недельную норму и имя. Цикл раскладывается от названной даты в обе стороны,
          поэтому подойдёт любая смена, а не обязательно первая в году.
        </p>
        <p>
          Слева сразу рисуется получившийся календарь — сверьте, что смены стоят там, где они у вас.{" "}
          <Q>Начало отсчёта</Q> нужно тем, кто устроился посреди года: до этой даты нет ни смен, ни
          нормы.
        </p>
      </Row>
      <Row picture={<Big icon={CalendarPlus} />} title="Добавление нового графика">
        <p>
          <Q>Построить график</Q> на главной странице. Ещё один график — <Q>Графики</Q> →{" "}
          <Q>График</Q>. В обоих случаях в окне есть <Q>Загрузить из файла</Q>: сохранённый график
          откроется со всеми отметками и папками.
        </p>
      </Row>
      <Row picture={<Big icon={Settings} />} title="Потом поправить">
        <p>
          Те же вопросы — в <Q>Настройках</Q> → <Q>График</Q>. Рядом: <Q>Показ расчёта</Q> (режим{" "}
          <Q>Онлайн</Q>, переработка сменами вместо часов), <Q>Оформление</Q> (свои цвета событий и
          света лампы — для вошедших в учётную запись) и <Q>Удаление</Q>.
        </p>
      </Row>
    </Rows>
  );
}

// --- График ---------------------------------------------------------------

/** Перечень видов у дня — тот, что раскрывается по нажатию на клетку. */
function DayList() {
  const rows: { tone: string; mark: string; label: string; on?: boolean }[] = [
    { tone: ABSENCE_TONE.annual_leave, mark: ABSENCE_MARK.annual_leave, label: "Отпуск", on: true },
    { tone: ABSENCE_TONE.sick_leave, mark: ABSENCE_MARK.sick_leave, label: "Больничный" },
    { tone: CALLOUT_TONE, mark: CALLOUT_MARK, label: "Вызов" },
  ];
  return (
    <span className="lit flex w-44 flex-col gap-1 rounded-xl bg-paper-raised p-1.5 text-left text-sm text-ink">
      {rows.map((row) => (
        <span key={row.label} className="flex h-9 items-center gap-2 px-1">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md border font-mono text-[11px]",
              row.tone,
              row.on && "outline-2 -outline-offset-2 outline-ink",
            )}
          >
            {row.mark}
          </span>
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          {row.on ? <Check aria-hidden className="size-4 shrink-0 text-ink" /> : null}
        </span>
      ))}
    </span>
  );
}

function Schedule() {
  return (
    <Rows lead="Основной экран: год по месяцам. Над сеткой — итог, в клетках — сутки.">
      <Row
        picture={
          <dl>
            <Figure
              size="hero"
              parts={[{ value: "24", unit: "ч" }]}
              caption={<BalanceCaption under={false} />}
              tone="verify"
            />
          </dl>
        }
        title="Итог над сеткой"
      >
        <p>
          <span className="text-ink">Норма периода</span> — сколько часов нужно отработать по
          производственному календарю. <span className="text-ink">Отработано</span> — часы ваших
          смен и вызовов. Разница между ними: зелёная переработка или красная недоработка.
        </p>
        <p>
          По бокам — смены, ночные и праздничные часы; они входят в отработанные, а не прибавляются
          к ним. Итог закреплён над сеткой, а после каждой правки над клеткой на миг всплывает, на
          сколько сдвинулась разница.
        </p>
      </Row>
      <Row
        picture={
          <PictureGroup>
            <PeriodIcon kind="year" index={0} className="size-11" />
            <PeriodIcon kind="half_year" index={0} className="size-11" />
            <PeriodIcon kind="quarter" index={1} className="size-11" />
          </PictureGroup>
        }
        title="Учётный период"
      >
        <p>
          Часы по центру шапки выбирают, какая часть года считается: год, полугодие или квартал.
          Переработку определяют по итогу учётного периода (ст. 104 ТК РФ) — выбирайте тот, что
          принят у вас.
        </p>
      </Row>
      <Row
        picture={
          <PictureGroup columns={2}>
            <CellPicture tone={SHIFT_TONE} date="12" mark="16" className="size-16" />
            <CellPicture tone={SHIFT_TAIL_TONE} date="13" mark="8" className="size-16" />
            <CellPicture tone={DAY_OFF_TONE} date="14" mark={DAY_OFF_MARK} className="size-16" />
            <CellPicture tone={ABSENCE_TONE.annual_leave} date="15" mark={ABSENCE_MARK.annual_leave} className="size-16" />
            <CellPicture tone={CALLOUT_TONE} date="20" mark={CALLOUT_MARK} className="size-16" />
            <CellPicture tone={DAY_OFF_TONE} date="21" mark={DAY_OFF_MARK} innerClassName={TODAY_MARK} className="size-16" />
          </PictureGroup>
        }
        title="Клетки"
      >
        <p>
          Зелёная — вы заступили на смену, под числом часы. Бледно-зелёная — продолжение смены за
          полночь. Серая — выходной. Пунктирная рамка с буквой — отсутствие, <Q>Р</Q> — вызов,
          красная обводка — сегодня.
        </p>
        <p>Что значит каждая буква и цвет, подскажет <Q>Легенда</Q> у нижней кромки.</p>
      </Row>
      <Row picture={<DayList />} title="Правка дня">
        <p>
          Нажмите на день: рядом раскроется перечень — отсутствия, вызов, <Q>Сделать выходным</Q>{" "}
          или <Q>Поставить смену</Q>, заметка. Что в сутках уже стоит, отмечено галочкой; нажатие по
          ней убирает отметку.
        </p>
        <p>
          Отпуск и всё, что длится, спросят, по какое число; вызов — ещё и сколько часов. Смену
          можно перетащить на другой день: мышью сразу, на телефоне — подержав палец около трети
          секунды.
        </p>
      </Row>
      <Row
        picture={
          <PictureGroup>
            <LegendMark className="size-10" />
            <ShiftsIcon className="size-10" />
            <CalendarIcon className="size-10" />
          </PictureGroup>
        }
        title="Знаки у нижней кромки"
      >
        <p>
          <Q>Легенда</Q> — расшифровка клеток. <Q>График</Q> и <Q>Календарь</Q> переключают сетку,{" "}
          <Q>Год</Q> меняет учётный год. <Q>Онлайн</Q> считает итог по сегодняшний день включительно,
          а не до конца периода: видно, сколько набежало к этому дню.
        </p>
        <p>
          На широких экранах рядом — число столбцов, <Q>Компактно</Q>, масштаб и тема.
        </p>
      </Row>
    </Rows>
  );
}

// --- Производственный календарь ---------------------------------------------

function CalendarHelp() {
  return (
    <Rows lead="Другая сетка тех же месяцев: здесь размечено не то, что вы работаете, а то, каким день считается по закону. От этого зависит норма. Переключается знаком «Календарь» у нижней кромки.">
      <Row
        picture={
          <PictureGroup columns={2}>
            {DAY_TYPES.map((type) => (
              <CellPicture
                key={type}
                tone={DAY_TYPE_TONE[type]}
                date="12"
                mark={DAY_TYPE_MARK[type]}
                className="size-16"
              />
            ))}
          </PictureGroup>
        }
        title="Четыре вида дней"
      >
        <ul className="space-y-1">
          {DAY_TYPES.map((type) => (
            <li key={type}>
              <span className="text-ink">{DAY_TYPE_LABELS[type]}</span> —{" "}
              {lowerFirst(DAY_TYPE_EFFECT[type])}.
            </li>
          ))}
        </ul>
      </Row>
      <Row
        picture={
          <CellPicture tone={DAY_TYPE_TONE.working} date="12" mark={DAY_TYPE_MARK.working}>
            <span aria-hidden className="absolute -top-px -left-px size-3 rounded-full bg-ink" />
          </CellPicture>
        }
        title="Переносы и правки"
      >
        <p>
          Праздники (ст. 112 ТК РФ) и предпраздничные дни (ст. 95) размечены автоматически.
          Переносы выходных Правительство устанавливает отдельным постановлением на каждый год: если
          приложение его ещё не знает, нажмите на день и выберите, каким он считается.
        </p>
        <p>
          Точка в углу — день, изменённый вами. <Q>Вернуть календарь по закону</Q> в легенде
          сбрасывает все правки.
        </p>
      </Row>
    </Rows>
  );
}

// --- События ----------------------------------------------------------------

function Events() {
  return (
    <Rows lead="Всё, что вы отметили в графике, — одной лентой по времени. Открывается из меню или значком «События» под ним. Ставятся события нажатием на день в графике.">
      <Row picture={<Big icon={CalendarRange} />} title="Лента">
        <p>
          Месяцы подряд; у каждой записи даты и длительность, а значок тот же, что в клетке графика.
          Линия <Q>Сегодня</Q> отделяет начатое от предстоящего, идущее помечено <Q>Идёт</Q>. Кнопки
          над лентой оставляют только отсутствия, вызовы, правки графика или заметки.
        </p>
      </Row>
      <Row picture={<Big icon={RotateCcw} />} title="Правка и возврат">
        <p>
          Нажмите на строку, чтобы изменить срок или текст. Крестик убирает отметку, а на её месте
          несколько секунд стоит <Q>Вернуть</Q>. <Q>Сбросить календарь</Q> под лентой стирает всё
          отмеченное разом — без возврата.
        </p>
      </Row>
      <Row
        picture={
          <PictureGroup columns={3}>
            <Letter tone={ABSENCE_TONE.annual_leave}>{ABSENCE_MARK.annual_leave}</Letter>
            <Letter tone={ABSENCE_TONE.sick_leave}>{ABSENCE_MARK.sick_leave}</Letter>
            <Letter tone={ABSENCE_TONE.business_trip}>{ABSENCE_MARK.business_trip}</Letter>
            <Letter tone={ABSENCE_TONE.time_off_in_lieu}>{ABSENCE_MARK.time_off_in_lieu}</Letter>
            <Letter tone={CALLOUT_TONE}>{CALLOUT_MARK}</Letter>
          </PictureGroup>
        }
        title="Что событие делает с расчётом"
      >
        <ul className="space-y-1">
          <li>
            <span className="text-ink">Отпуск, больничный, учебный отпуск</span> —{" "}
            {ABSENCE_EFFECT.annual_leave}.
          </li>
          <li>
            <span className="text-ink">Командировка</span> — {ABSENCE_EFFECT.business_trip}.
          </li>
          <li>
            <span className="text-ink">Отгул</span> — {ABSENCE_EFFECT.time_off_in_lieu}.
          </li>
          <li>
            <span className="text-ink">Вызов</span> — работа помимо графика: её часы прибавляются к
            отработанным.
          </li>
        </ul>
      </Row>
    </Rows>
  );
}

// --- Статистика -------------------------------------------------------------

function Stats() {
  return (
    <Rows lead="Разбор выбранного учётного периода — чтобы сверить расчёт с табелем и понять, откуда взялась переработка. Период тот же, что выбран часами в шапке.">
      <Row picture={<Big icon={Folder} />} title="Чья статистика">
        <p>
          Когда графиков несколько, вверху выбирают один график, папку или все сразу. По папке и по
          всем показан свод со сравнением графиков.
        </p>
      </Row>
      <Row picture={<Big icon={ChartColumn} />} title="Что в ней">
        <p>
          Смены по графику, отработанные и пропущенные, ночные и праздничные часы. Рисунки: норма и
          факт по месяцам, как копится баланс, ночные часы. Таблица по месяцам, а ниже — отсутствия
          и вызовы с датами и заметками.
        </p>
      </Row>
    </Rows>
  );
}

// --- Графики ----------------------------------------------------------------

function Graphs() {
  return (
    <Rows lead="Графиков можно завести несколько и разложить по папкам. Открывается из меню или значком «Графики» под ним.">
      <Row picture={<Big icon={FolderOpen} />} title="Проводник">
        <p>
          <Q>Папка</Q> и <Q>График</Q> создают папку и новый график. Графики можно переименовать,
          переложить в папку и удалить. Открытый график заменяет тот, что на экране, но не стирает
          его.
        </p>
      </Row>
      <Row picture={<Big icon={Save} />} title="Сохранить и перенести">
        {SYNC_ENABLED ? (
          <p>
            <Q>Сохранить</Q> выгружает график в файл .json вместе с папками. На другом устройстве
            его открывают кнопкой <Q>Загрузить из файла</Q> в окне создания графика. Графики лежат
            в браузере, и файл — копия на случай, если его почистят; без файла переносит учётная
            запись.
          </p>
        ) : (
          <p>
            Графики лежат только в вашем браузере и никуда не отправляются. <Q>Сохранить</Q>{" "}
            выгружает график в файл .json вместе с папками: это и перенос на другое устройство (
            <Q>Загрузить из файла</Q> в окне создания графика), и копия на случай, если браузер
            почистят.
          </p>
        )}
      </Row>
      {SYNC_ENABLED ? (
        <Row picture={<Big icon={UserRound} />} title="Учётная запись">
          <p>
            Необязательна. Добавляет зашифрованную копию на сервере и перенос между устройствами:
            правка на телефоне сама оказывается на компьютере. Ключ выводится из пароля в браузере,
            и сервер копию прочитать не может.
          </p>
          <p>
            При регистрации выдаётся ключ восстановления — запишите его: без него и без пароля
            данные не вернуть. При выходе графики уходят с устройства и возвращаются при следующем
            входе.
          </p>
        </Row>
      ) : null}
    </Rows>
  );
}

/** Содержимое открытого раздела. */
export function HelpSection({ id }: { id: HelpSectionId }) {
  switch (id) {
    case "create":
      return <Create />;
    case "schedule":
      return <Schedule />;
    case "calendar":
      return <CalendarHelp />;
    case "events":
      return <Events />;
    case "stats":
      return <Stats />;
    case "graphs":
      return <Graphs />;
  }
}
