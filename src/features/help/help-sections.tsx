"use client";

import {
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  ChartColumn,
  Check,
  FolderOpen,
  FolderPlus,
  Grid3x3,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Sigma,
  Upload,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { BalanceCaption } from "@/components/ui/balance-caption";
import type { LayoutSection } from "@/components/ui/section-layout";
import { Figure } from "@/components/ui/summary-figure";
import { PeriodIcon } from "@/features/shift/components/grid-icons";
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
 * --- Как написана справка ------------------------------------------------------
 *
 * Человек приходит в справку с вопросом «что мне нажать», а не «как устроен
 * экран». Поэтому:
 *
 * * заголовок строки — задача, а не часть интерфейса: «Как отметить событие», а
 *   не «Правка дня»; «Изменение настроек», а не «Потом поправить»;
 * * текст — инструкция в одно-два предложения: «нажмите», «выберите», «укажите»,
 *   с названиями кнопок в кавычках ровно так, как они подписаны на экране;
 * * вводных абзацев над разделом нет: всё нужное — в строках, и первая из них
 *   сразу говорит, что делать.
 *
 * Чего в справке нет: описания каждого знака и каждой клетки (расшифровку цветов
 * и букв держит «Легенда» самого приложения, а справка на неё ссылается),
 * оговорки о справочном характере расчёта (она в подвале каждой страницы, в том
 * числе этой), темы и масштаба — видно и без объяснений.
 *
 * Что в справке есть, кроме инструкций, — то, чего с экрана не видно и что
 * влияет на число: как отметка меняет расчёт (отпуск уменьшает норму, отгул — нет,
 * вызов прибавляется к отработанному), каким день считается по закону.
 *
 * --- Как устроена строка ----------------------------------------------------
 *
 * Слева — сам элемент, крупнее, чем в приложении; справа — заголовок и текст. Так
 * устроены и показы «Как работает» на главной странице, но там элемент оживает,
 * а здесь он стоит: справка нужна, чтобы остановиться и рассмотреть, и движение
 * этому мешает.
 *
 * Слово из справки должно находиться на экране буквально: названия кнопок,
 * разделов и полей — как в приложении («Начало отсчёта», а не «дата начала
 * учёта»).
 */

export type HelpSectionId = "create" | "schedule" | "calendar" | "events" | "stats" | "graphs";

export const HELP_SECTIONS: readonly LayoutSection<HelpSectionId>[] = [
  { id: "create", title: "Настройка графика", icon: CalendarPlus },
  { id: "schedule", title: "График", icon: Grid3x3 },
  { id: "calendar", title: "Производственный календарь", icon: CalendarDays },
  { id: "events", title: "События", icon: CalendarRange },
  { id: "stats", title: "Статистика", icon: ChartColumn },
  { id: "graphs", title: "Управление графиками", icon: FolderOpen },
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

/** Строки раздела, разделённые линией. Вводной над ними нет — см. шапку файла. */
function Rows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-rule">{children}</div>;
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

/**
 * Название кнопки со значком — тем же, что на самой кнопке.
 *
 * Для тех, кого в тексте легко не найти: «Графики», «График» и «Загрузить из
 * файла» стоят знаками без подписи или внутри окна, и по одному слову человек
 * ищет глазами, а по знаку — находит. Значок строчный, в цвет слова, и не
 * отрывается от него при переносе строки.
 */
function QI({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap align-bottom text-ink">
      <Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />«{children}»
    </span>
  );
}

/** Первая буква строчная — чтобы фраза из словаря встала после тире. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// --- Настройка графика ------------------------------------------------------

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
    <Rows>
      <Row picture={<CyclePills />} title="Как настроить график">
        <p>
          При создании профиля укажите график смен, дату одной из смен, время начала и
          продолжительность работы, а также недельную норму часов. По этим данным приложение
          построит календарь на весь год. Если вы устроились на работу не с начала года, укажите
          дату в поле <Q>Начало отсчёта</Q>.
        </p>
      </Row>
      <Row picture={<Big icon={CalendarPlus} />} title="Добавление графика">
        <p>
          Чтобы создать ещё один график, нажмите <Q>Построить график</Q> на главной странице или
          откройте <QI icon={FolderOpen}>Графики</QI> → <QI icon={Plus}>График</QI>. Если у вас уже
          есть сохранённый файл, выберите <QI icon={Upload}>Загрузить из файла</QI>.
        </p>
      </Row>
      <Row picture={<Big icon={Settings} />} title="Изменение настроек">
        <p>
          Изменить график, норму часов и другие параметры можно в разделе <Q>Настройки</Q> →{" "}
          <Q>График</Q>. Там же доступны настройки отображения расчётов, оформление событий и
          удаление графика.
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
    <Rows>
      <Row
        picture={
          <PictureGroup>
            <PeriodIcon kind="year" index={0} className="size-11" />
            <PeriodIcon kind="half_year" index={0} className="size-11" />
            <PeriodIcon kind="quarter" index={1} className="size-11" />
          </PictureGroup>
        }
        title="Как выбрать период"
      >
        <p>
          Нажмите на часы вверху и выберите год, полугодие или квартал. Переработку считают по итогу
          учётного периода (ст. 104 ТК РФ), поэтому выбирайте тот, что принят у вас. Другой год
          выбирается знаком <Q>Год</Q> внизу.
        </p>
        <p>
          Чтобы увидеть, сколько набежало к сегодняшнему дню, включите <Q>Онлайн</Q> внизу: итог
          посчитается только до сегодняшних суток.
        </p>
      </Row>
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
        title="Как читать итог"
      >
        <p>
          Над сеткой три числа: норма на период, сколько вы отработали и разница между ними.
          Зелёная разница — переработка, красная — недоработка.
        </p>
        <p>
          Слева и справа — смены, ночные и праздничные часы. Итог пересчитывается после каждой
          правки: над клеткой на миг всплывает, на сколько он изменился.
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
        title="Что значат клетки"
      >
        <p>
          Зелёная — вы заступили на смену, под числом часы. Бледно-зелёная — продолжение смены
          после полуночи. Серая — выходной. Пунктирная рамка с буквой — отпуск, больничный или
          другое отсутствие, <Q>Р</Q> — вызов, красная обводка — сегодня.
        </p>
        <p>
          Все обозначения — в <Q>Легенде</Q> внизу.
        </p>
      </Row>
      <Row picture={<DayList />} title="Как отметить событие">
        <p>
          Нажмите на день и выберите в списке: отпуск, больничный, отгул, вызов, <Q>Сделать
          выходным</Q> или заметку. Отпуск и всё, что длится, спросят, по какое число, а вызов — ещё
          и сколько часов.
        </p>
        <p>
          Чтобы убрать отметку, нажмите на неё в списке ещё раз: рядом с ней стоит галочка.
        </p>
      </Row>
      <Row
        picture={
          <CellPicture
            tone={SHIFT_TONE}
            date="12"
            mark="смена"
            className="rotate-6 shadow-lg"
          />
        }
        title="Как перенести смену"
      >
        <p>
          Перетащите клетку со сменой на другой день. На телефоне сначала подержите палец на
          клетке, пока она не приподнимется.
        </p>
        <p>
          Можно и без перетаскивания: нажмите на день и выберите <Q>Сделать выходным</Q> или{" "}
          <Q>Поставить смену</Q>.
        </p>
      </Row>
    </Rows>
  );
}

// --- Производственный календарь ---------------------------------------------

function CalendarHelp() {
  return (
    <Rows>
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
        title="Как календарь влияет на норму"
      >
        <p>
          Нажмите <Q>Календарь</Q> внизу: сетка покажет, каким день считается по закону. От этого
          зависит норма.
        </p>
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
        title="Как учесть перенос выходных"
      >
        <p>
          Праздники (ст. 112 ТК РФ) и предпраздничные дни (ст. 95) размечены сами. Переносы
          выходных Правительство утверждает отдельным постановлением на каждый год: если приложение
          его ещё не знает, нажмите на день и выберите, каким он считается.
        </p>
        <p>
          Точка в углу — день, который изменили вы. Чтобы отменить все свои правки, откройте{" "}
          <Q>Легенду</Q> и нажмите <Q>Вернуть календарь по закону</Q>.
        </p>
      </Row>
    </Rows>
  );
}

// --- События ----------------------------------------------------------------

function Events() {
  return (
    <Rows>
      <Row picture={<Big icon={CalendarRange} />} title="Где посмотреть события">
        <p>
          Откройте <Q>События</Q> в меню справа: там всё, что вы отметили в графике, по месяцам.
          Линия <Q>Сегодня</Q> отделяет прошедшее от предстоящего, идущее помечено <Q>Идёт</Q>.
          Кнопки над списком оставляют только отсутствия, вызовы, правки графика или заметки.
        </p>
      </Row>
      <Row picture={<Big icon={RotateCcw} />} title="Как изменить или убрать событие">
        <p>
          Нажмите на строку, чтобы изменить срок или текст. Крестик убирает событие, и несколько
          секунд на его месте стоит <Q>Вернуть</Q>. <Q>Сбросить календарь</Q> внизу стирает всё
          отмеченное сразу, без возврата.
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
        title="Как события влияют на расчёт"
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
    <Rows>
      <Row picture={<Big icon={ChartColumn} />} title="Как открыть статистику">
        <p>
          Откройте <Q>Статистика</Q> в меню справа: она посчитана за выбранный период. Если графиков
          несколько, вверху выберите один график, папку или все сразу — по папке и по всем получится
          общий свод.
        </p>
      </Row>
      <Row picture={<Big icon={Sigma} />} title="Как сверить расчёт с табелем">
        <p>
          Смотрите таблицу по месяцам, а ниже — отсутствия и вызовы с датами и заметками. Рисунки
          показывают норму и факт по месяцам, как копится баланс и сколько часов отработано ночью.
        </p>
      </Row>
    </Rows>
  );
}

// --- Управление графиками ---------------------------------------------------

function Graphs() {
  return (
    <Rows>
      <Row picture={<Big icon={FolderOpen} />} title="Как открыть другой график">
        <p>
          Откройте <Q>Графики</Q> в меню справа и нажмите на нужный. Он заменит график на экране, но
          тот не сотрётся.
        </p>
      </Row>
      <Row picture={<Big icon={FolderPlus} />} title="Как навести порядок">
        <p>
          <Q>График</Q> создаёт новый график, <Q>Папка</Q> — папку. Графики можно переименовать,
          переложить в папку и удалить.
        </p>
      </Row>
      <Row picture={<Big icon={Save} />} title="Как сохранить график в файл">
        {SYNC_ENABLED ? (
          <p>
            Нажмите <Q>Сохранить</Q> в меню справа и при желании измените имя файла. В файл попадает
            график вместе с папками. На другом устройстве откройте его кнопкой{" "}
            <Q>Загрузить из файла</Q> в окне создания графика. Файл — ещё и копия на случай, если
            браузер почистят.
          </p>
        ) : (
          <p>
            Нажмите <Q>Сохранить</Q> в меню справа и при желании измените имя файла. В файл попадает
            график вместе с папками. Графики лежат только в вашем браузере и никуда не отправляются,
            поэтому файл — и способ перенести график на другое устройство (<Q>Загрузить из файла</Q>{" "}
            в окне создания графика), и копия на случай, если браузер почистят.
          </p>
        )}
      </Row>
      {SYNC_ENABLED ? (
        <Row picture={<Big icon={UserRound} />} title="Как держать графики на всех устройствах">
          <p>
            Заведите учётную запись (она в меню справа): графики будут сами появляться на всех ваших
            устройствах. Копия на сервере зашифрована, и прочитать её нельзя.
          </p>
          <p>
            Запишите ключ восстановления, который выдадут при регистрации: без него и без пароля
            данные не вернуть. При выходе графики убираются с устройства и вернутся, когда вы
            войдёте снова.
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
