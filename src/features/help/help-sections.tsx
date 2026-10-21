"use client";

import {
  CalendarDays,
  CalendarRange,
  ChartColumn,
  Check,
  Columns3,
  Database,
  FolderOpen,
  Grid3x3,
  Info,
  Monitor,
  Moon,
  MousePointerClick,
  PanelBottom,
  PanelTop,
  Rocket,
  Save,
  Settings,
  Shrink,
  Sigma,
  Sun,
  UserRound,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  HEADER_WORD,
  LegendMark,
  MARK_EMPTY_CLASS,
  MARK_EMPTY_TEXT,
  MenuMark,
} from "@/components/shared/header-action";
import { BalanceCaption } from "@/components/ui/balance-caption";
import { Logo } from "@/components/ui/logo";
import type { LayoutSection } from "@/components/ui/section-layout";
import { Figure } from "@/components/ui/summary-figure";
import { CALENDAR_ON, SHIFTS_ON } from "@/features/shift/components/grid-dock";
import { CalendarIcon, PeriodIcon, ShiftsIcon, YearMark } from "@/features/shift/components/grid-icons";
import { LiveSignal } from "@/features/shift/components/live-mode";
import { META_FIGURE, META_UNIT, MetaSep, TODAY_MARK } from "@/features/shift/components/month-grid";
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
  ABSENCE_LABELS,
  DAY_TYPES,
  DAY_TYPE_EFFECT,
  DAY_TYPE_LABELS,
  DAY_TYPE_MARK,
  DAY_TYPE_TONE,
} from "@/features/shift/schemas";
import type { AbsenceKind } from "@/features/shift/domain/value-objects";
import { SYNC_ENABLED } from "@/features/sync/ui/enabled";
import { cn } from "@/lib/utils/cn";

import { CellPicture, HolidayCorner, NoteCorner, PictureGroup } from "./help-pictures";

/**
 * Разделы справки и их содержимое.
 *
 * --- Как устроена строка ----------------------------------------------------
 *
 * Слева — сам элемент, крупнее, чем в приложении, в рост текста рядом; справа —
 * что это и зачем. Так устроены и показы «Как работает» на главной странице, но
 * там элемент оживает, а здесь он стоит: справка нужна, чтобы остановиться и
 * рассмотреть, и движение этому мешает.
 *
 * --- Что в разделах -----------------------------------------------------------
 *
 * Порядок тот, в каком глаз идёт по рабочему экрану сверху вниз: шапка, итоги,
 * сетка, правка суток, знаки у нижней кромки. Первым стоит «С чего начать» —
 * для тех, кто пришёл впервые и не знает, с какого элемента начинать, — а
 * последним «Графики и данные»: то, что лежит за меню.
 *
 * Пояснения повторяют слова самого приложения — подписи клеток, строки
 * подсказок, легенду, — а не пересказывают их своими: слово из справки должно
 * находиться на экране буквально.
 */

export type HelpSectionId =
  | "start"
  | "header"
  | "totals"
  | "cells"
  | "edit"
  | "dock"
  | "calendar"
  | "data";

export const HELP_SECTIONS: readonly LayoutSection<HelpSectionId>[] = [
  { id: "start", title: "С чего начать", icon: Rocket },
  { id: "header", title: "Шапка", icon: PanelTop },
  { id: "totals", title: "Итоги", icon: Sigma },
  { id: "cells", title: "Клетки сетки", icon: Grid3x3 },
  { id: "edit", title: "Правка дней", icon: MousePointerClick },
  { id: "dock", title: "Знаки у кромки", icon: PanelBottom },
  { id: "calendar", title: "Календарь", icon: CalendarDays },
  { id: "data", title: "Графики и данные", icon: Database },
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

// --- Начало ---------------------------------------------------------------

function Start() {
  return (
    <Rows lead="Приложение считает норму рабочего времени по производственному календарю и сравнивает её с тем, что вы отработали. От пустого экрана до готового расчёта — пять шагов.">
      <Row picture={<Big icon={Settings} />} title="Задайте свой график">
        <p>
          Окно <Q>Построить график</Q> на главной странице спрашивает, как вы работаете: цикл
          смен, недельную норму, дату одной из смен и её длительность. По этому приложение само
          расставляет смены по календарю. Потом всё это правится в разделе <Q>Настройки</Q> →{" "}
          <Q>График</Q>.
        </p>
      </Row>
      <Row
        picture={<PeriodIcon kind="half_year" index={0} className="size-14" />}
        title="Выберите учётный период"
      >
        <p>
          Часы по центру шапки показывают, какую часть года вы смотрите: весь год, полугодие или
          квартал. По итогу учётного периода определяется переработка (ст. 104 ТК РФ), поэтому
          выбирайте тот период, который принят у вас.
        </p>
      </Row>
      <Row picture={<Big icon={Sigma} />} title="Читайте итог">
        <p>
          Над сеткой — три числа: норма периода, отработано и разница между ними. Разница зелёная,
          если отработано больше нормы (переработка), и красная, если меньше (недоработка).
        </p>
      </Row>
      <Row picture={<Big icon={MousePointerClick} />} title="Отмечайте, что было не по графику">
        <p>
          Нажмите на день и выберите: отпуск, больничный, отгул, вызов и другое. Итог пересчитывается
          сразу, а над клеткой на мгновение всплывает, на сколько изменилась разница.
        </p>
      </Row>
      <Row picture={<Big icon={Save} />} title="Сохраните">
        {SYNC_ENABLED ? (
          <p>
            Графики лежат в вашем браузере. Чтобы не потерять их и перенести на другое устройство,
            сохраните график в файл (<Q>Сохранить</Q> под кнопкой меню) или заведите учётную запись: тогда
            зашифрованная копия синхронизируется сама.
          </p>
        ) : (
          <p>
            Графики лежат только в вашем браузере и никуда не отправляются. Чтобы сделать копию или
            перенести график на другое устройство, сохраните его в файл (<Q>Сохранить</Q> под кнопкой меню).
          </p>
        )}
      </Row>
    </Rows>
  );
}

// --- Шапка ----------------------------------------------------------------

function Header() {
  return (
    <Rows lead="Шапка одна на всех страницах. На расчёте в ней — всё, чтобы выбрать период и открыть остальное.">
      <Row
        picture={
          <span className="flex flex-col items-center gap-2">
            <Logo className="size-14 text-signal" />
            <span className={cn(HEADER_WORD, "text-3xl")}>
              График{" "}
              <span className={MARK_EMPTY_TEXT}>
                1
                <span
                  aria-hidden
                  className="mark-needle mx-[0.14em] inline-block h-[0.6em] w-[1.5px] bg-current align-[0.05em]"
                />
                3
              </span>
            </span>
          </span>
        }
        title="Знак сайта и цифры графика"
      >
        <p>
          Слева — знак сайта: нажатие ведёт на главную страницу. После слова «График» стоят цифры
          вашего цикла: в «1|3» одни рабочие сутки и трое выходных, в «2|2» — двое и двое. Они
          меняются сами, когда вы меняете график в настройках.
        </p>
      </Row>
      <Row
        picture={<span className="font-hand text-4xl text-ink/60">Мой график</span>}
        title="Имя графика"
      >
        <p>
          Название вашего графика, написанное от руки. На компьютере оно стоит в шапке за знаком
          сайта, на телефоне — над цифрами. Если графиков несколько, нажатие на имя открывает
          список, чтобы переключиться на другой. Переименовать можно в <Q>Настройках</Q>.
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
        title="Часы — учётный период"
      >
        <p>
          Закрашенная часть круга — выбранная доля года. Нажмите, чтобы выбрать: <Q>Весь год</Q>,
          одно из двух полугодий или один из четырёх кварталов. Норма, итоги и сетка пересчитываются
          под выбранный период.
        </p>
      </Row>
      <Row picture={<MenuMark className="size-14" />} title="Меню">
        <p>
          Три полосы справа. В меню — эта справка
          {SYNC_ENABLED ? " и учётная запись" : ""}. <Q>Настройки</Q>, <Q>События</Q>,{" "}
          <Q>Статистика</Q>, <Q>Графики</Q> и <Q>Сохранить</Q> на широком экране стоят значками
          колонкой под кнопкой меню — наведите, и выедет подпись; открытый раздел горит. На узком
          экране они строки самого меню. Пока на месте сетки открыт раздел, полосы складываются в
          крестик: нажатие закрывает раздел и возвращает график.
        </p>
      </Row>
    </Rows>
  );
}

// --- Итоги ----------------------------------------------------------------

function Totals() {
  return (
    <Rows lead="Полоса с числами остаётся наверху, пока вы листаете сетку: правка суток видна в итоге сразу.">
      <Row
        picture={
          <dl>
            <Figure size="hero" parts={[{ value: "1796", unit: "ч" }]} caption="Норма периода" />
          </dl>
        }
        title="Норма периода"
      >
        <p>
          Сколько часов нужно отработать за учётный период по производственному календарю. Отпуск и
          другие освобождения норму уменьшают.
        </p>
      </Row>
      <Row
        picture={
          <dl>
            <Figure size="hero" parts={[{ value: "1820", unit: "ч" }]} caption="Отработано" />
          </dl>
        }
        title="Отработано"
      >
        <p>
          Часы ваших смен и вызовов за период. Смены, пришедшиеся на отпуск и другие освобождения,
          не считаются.
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
        title="Переработка"
      >
        <p>
          Разница между отработанным и нормой, когда отработано больше. Зелёная. В настройках её
          можно показывать не часами, а сменами и часами (<Q>Переработка в сменах</Q>).
        </p>
      </Row>
      <Row
        picture={
          <dl>
            <Figure
              size="hero"
              parts={[{ value: "16", unit: "ч" }]}
              caption={<BalanceCaption under />}
              tone="signal"
            />
          </dl>
        }
        title="Недоработка"
      >
        <p>
          Та же разница, когда отработано меньше нормы. Это не второе число, а тот же знак с другим
          именем и красным цветом.
        </p>
      </Row>
      <Row
        picture={
          <dl>
            <Figure parts={[{ value: "92", unit: "см" }]} caption="По графику" />
          </dl>
        }
        title="Смены: по графику и отработано"
      >
        <p>
          Слева от главных чисел: сколько смен приходится на период по вашему графику, считая и
          те, что попали на отпуск, и сколько из них отработано. «см» — смены. Боковые числа
          появляются, когда хватает ширины экрана.
        </p>
      </Row>
      <Row
        picture={
          <dl>
            <Figure parts={[{ value: "734", unit: "ч" }]} caption="Ночные" />
          </dl>
        }
        title="Ночные и праздничные"
      >
        <p>
          Справа: часы, отработанные ночью, — с 22:00 до 06:00 (ст. 96 ТК РФ) — и в праздничные
          дни по производственному календарю. Они входят в отработанные, а не прибавляются к ним.
        </p>
      </Row>
      <Row
        picture={
          <span className="font-mono text-base whitespace-nowrap text-ink-muted">
            <span className={META_FIGURE}>168</span>
            <span className={META_UNIT}>ч</span>
            <MetaSep />
            <span className={META_FIGURE}>192</span>
            <span className={META_UNIT}>ч</span>
            <MetaSep />
            <span className={cn(META_FIGURE, "text-verify")}>24</span>
            <span className={META_UNIT}>ч</span>
          </span>
        }
        title="Подпись над месяцем"
      >
        <p>
          У каждого месяца сетки свои норма, отработанное и разница — в том же порядке, что и в
          полосе итога. Разница зелёная при переработке и красная при недоработке.
        </p>
      </Row>
    </Rows>
  );
}

// --- Клетки ---------------------------------------------------------------

const ABSENCE_ORDER: readonly AbsenceKind[] = [
  "annual_leave",
  "extra_leave",
  "study_leave",
  "business_trip",
  "sick_leave",
  "time_off_in_lieu",
];

function Cells() {
  return (
    <Rows lead="Каждая клетка — сутки. Вверху число месяца, под ним часы или буква. Цвет и буква говорят, что в эти сутки было.">
      <Row picture={<CellPicture tone={SHIFT_TONE} date="12" mark="16" />} title="Начало смены">
        <p>
          Зелёная клетка: в эти сутки вы заступили на смену. Число под датой — сколько часов смены
          приходится на эти календарные сутки.
        </p>
      </Row>
      <Row picture={<CellPicture tone={SHIFT_TAIL_TONE} date="13" mark="8" />} title="Продолжение смены">
        <p>
          Бледно-зелёная клетка: смена началась накануне и идёт за полночь. Здесь остаток её
          часов — без них вчерашний итог был бы неполным.
        </p>
      </Row>
      <Row
        picture={<CellPicture tone={DAY_OFF_TONE} date="14" mark={DAY_OFF_MARK} />}
        title="Выходной день"
      >
        <p>Сутки без смены по графику. Серая клетка с буквой «В».</p>
      </Row>
      <Row
        picture={
          <PictureGroup columns={3}>
            {ABSENCE_ORDER.map((kind) => (
              <Letter key={kind} tone={ABSENCE_TONE[kind]}>
                {ABSENCE_MARK[kind]}
              </Letter>
            ))}
          </PictureGroup>
        }
        title="Отсутствия"
      >
        <p>
          Шесть причин, по которым смены не было: {ABSENCE_ORDER.map((kind) => ABSENCE_LABELS[kind].toLowerCase()).join(", ")}.
          Клетка с пунктирной рамкой и буквой вида. Свободные по графику сутки внутри отпуска
          показаны бледнее: часов у них нет, но отпуск они продолжают.
        </p>
        <p>
          Что отсутствие делает с расчётом: {ABSENCE_EFFECT.annual_leave} — у отпусков,
          больничного и учебного отпуска; у командировки то же, но дни поездки идут по среднему
          заработку; у отгула норма не меняется, а пропущенная смена уменьшает переработку, потому
          что отгул и есть её погашение.
        </p>
      </Row>
      <Row picture={<CellPicture tone={CALLOUT_TONE} date="20" mark={CALLOUT_MARK} />} title="Вызов">
        <p>
          Работа помимо графика: вы вышли, когда смены не было, или сверх неё. Её часы прибавляются к
          отработанным. Если в одних сутках несколько вызовов, на клетке стоит счётчик: «Р+1».
        </p>
      </Row>
      <Row
        picture={<CellPicture tone={DAY_OFF_TONE} date="21" mark={DAY_OFF_MARK} innerClassName={TODAY_MARK} />}
        title="Сегодня"
      >
        <p>
          Красная обводка внутри клетки — сегодняшние сутки. Она лежит поверх любого вида суток,
          поэтому найти себя в году можно всегда.
        </p>
      </Row>
      <Row
        picture={
          <CellPicture tone={DAY_OFF_TONE} date="1" mark={DAY_OFF_MARK}>
            <HolidayCorner />
          </CellPicture>
        }
        title="Праздник"
      >
        <p>
          Серый подарок в углу — праздничный день по производственному календарю (ст. 112 ТК РФ),
          а также выходной по постановлению о переносе. Какой именно праздник, написано в подписи
          клетки — она появляется при наведении. На мелком масштабе значок исчезает, чтобы не
          закрывать число.
        </p>
      </Row>
      <Row
        picture={
          <CellPicture tone={SHIFT_TONE} date="25" mark="16">
            <NoteCorner />
          </CellPicture>
        }
        title="Заметка"
      >
        <p>
          Маленький уголок в правом верхнем углу — к суткам добавлена заметка. Её текст виден в
          подписи клетки при наведении и внизу списка, когда вы открываете этот день.
        </p>
      </Row>
    </Rows>
  );
}

// --- Правка ---------------------------------------------------------------

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

function Edit() {
  return (
    <Rows lead="Любые сутки правятся прямо на сетке. Окон на весь экран нет: сетка остаётся на виду, и вы сразу видите, что изменилось.">
      <Row picture={<DayList />} title="Нажмите на день">
        <p>
          Рядом с днём раскрывается перечень. На графике смен: шесть видов отсутствия, вызов,{" "}
          <Q>Сделать выходным</Q> (на выходном — <Q>Поставить смену</Q>) и заметка. Остальная сетка
          размывается и не нажимается, пока перечень открыт: нажатие мимо закрывает его и не
          задевает соседний день.
        </p>
        <p>
          То, что в сутках уже стоит, отмечено галочкой. Нажатие по такой строке (над ней вместо
          буквы появляется крестик) <span className="text-ink">убирает</span> отметку.
        </p>
      </Row>
      <Row picture={<Big icon={CalendarRange} />} title="Срок и время">
        <p>
          Отпуск, больничный и всё, что длится, спросят срок — с какого по какое число; вызов ещё и
          время. Запись встаёт на сетку после того, как срок выбран. Закрыли окно срока, ничего не
          выбрав, — отметка остаётся на одних сутках.
        </p>
      </Row>
      <Row
        picture={
          <span className="flex flex-col items-center gap-1 font-mono text-2xl font-bold">
            <span className="text-verify">+24</span>
            <span className="text-signal">−24</span>
          </span>
        }
        title="Всплывающее «+24» и «−24»"
      >
        <p>
          После правки над клеткой на миг всплывает, как она сдвинула разницу: зелёным — переработка
          выросла, красным — упала. Это то же число, что в полосе итога, только там, куда вы
          смотрите. Считается за весь разговор о сутках целиком: поставили отпуск на неделю — одна
          надпись на итоговое изменение.
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
        title="Перенос смены"
      >
        <p>
          Потяните клетку со сменой на другой день — смена переедет. Мышью тяните сразу; на
          телефоне подержите палец около трети секунды, пока клетка не приподнимется, и тащите. У
          края экрана страница прокручивается сама. Тянуть не обязательно: то же делают{" "}
          <Q>Сделать выходным</Q> и <Q>Поставить смену</Q> в перечне.
        </p>
      </Row>
    </Rows>
  );
}

// --- Знаки у кромки -------------------------------------------------------

function Dock() {
  return (
    <Rows lead="Ряд знаков у нижней кромки окна. На телефоне это шесть знаков от края до края; на широком экране слева колонка знаков, справа — управление сеткой и тема. Подпись знака выезжает при наведении.">
      <Row picture={<LegendMark className="size-14" />} title="Легенда">
        <p>
          Что значат цвета и буквы клеток. У графика смен и у производственного календаря своя
          легенда — показана та, что соответствует открытой сетке. В легенде календаря видно, сколько
          у вас правок, и можно вернуть календарь по закону.
        </p>
      </Row>
      <Row
        picture={
          <span className={SHIFTS_ON}>
            <ShiftsIcon className="size-14" />
          </span>
        }
        title="График"
      >
        <p>
          Показать график смен. Выбранный вид отмечен цветом, а не плашкой: у графика загорается
          залитая зелёная клетка — как на знаке сайта.
        </p>
      </Row>
      <Row
        picture={
          <span className={CALENDAR_ON}>
            <CalendarIcon className="size-14" />
          </span>
        }
        title="Календарь"
      >
        <p>
          Показать производственный календарь: какие дни рабочие, предпраздничные, праздничные и
          выходные по закону. Загорается охрой.
        </p>
      </Row>
      <Row picture={<YearMark year={2026} className="size-14" />} title="Год">
        <p>
          Учётный год; на знаке — две последние цифры. Нажатие открывает список: шесть прошлых лет,
          нынешний и следующий. Год записывается в график, и завтра вы найдёте тот же расчёт.
        </p>
      </Row>
      <Row
        picture={
          <PictureGroup>
            <LiveSignal on className="size-14 text-verify" />
            <LiveSignal on={false} className={cn("size-14", MARK_EMPTY_CLASS)} />
          </PictureGroup>
        }
        title="Онлайн"
      >
        <p>
          Считать по сегодняшний день. Выключен (серая точка) — в расчёт входит весь выбранный
          период. Включён (зелёные волны) — норма и итоги считаются до сегодняшних суток
          включительно, а будущие сутки показаны бледнее и в расчёт не входят: видно, сколько
          набежало к сегодняшнему дню, а не в конце года.
        </p>
      </Row>
      <Row picture={<Big icon={Columns3} />} title="Столбцы">
        <p>
          Сколько месяцев стоит в ряду: от одного до шести, или <Q>Авто</Q>. Выбранное число
          закрепляется: лупы после этого меняют размер месяцев, а не число столбцов.
        </p>
      </Row>
      <Row picture={<Big icon={Shrink} />} title="Компактно">
        <p>
          Собирает месяцы в ровные ряды по середине рамки (шесть месяцев — два ряда по три).
          Повторное нажатие растягивает ряды на всю рамку.
        </p>
      </Row>
      <Row
        picture={
          <PictureGroup>
            <Big icon={ZoomIn} />
            <Big icon={ZoomOut} />
          </PictureGroup>
        }
        title="Крупнее и мельче"
      >
        <p>
          Размер месяцев. Крупнее трёх месяцев в ряду не бывает. Упёршись в предел, знак остаётся на
          месте, но бледнеет. Эти знаки, <Q>Столбцы</Q> и <Q>Компактно</Q> есть на экранах шире
          1024 точек; выбранная раскладка запоминается в этом браузере.
        </p>
      </Row>
      <Row
        picture={
          <PictureGroup>
            <Big icon={Sun} />
            <Big icon={Moon} />
            <Big icon={Monitor} />
          </PictureGroup>
        }
        title="Тема"
      >
        <p>Светлая, тёмная или как в системе. Выбор запоминается.</p>
      </Row>
      <Row
        picture={
          <span className="rounded-md border border-rule px-2.5 py-1.5 text-center font-mono text-xs leading-4">
            <span className={MARK_EMPTY_TEXT}>12 марта, чт — начало смены, 16 ч</span>
          </span>
        }
        title="Строка подсказок"
      >
        <p>
          На компьютере с мышью при наведении на сутки, число в полосе итога, знак или кнопку внизу
          окна тихим серым написано, что это и что будет, если нажать. На телефоне и в узком окне
          её нет: там подсказки остаются всплывающими.
        </p>
      </Row>
    </Rows>
  );
}

// --- Календарь ------------------------------------------------------------

function CalendarHelp() {
  return (
    <Rows lead="Производственный календарь — другая сетка тех же месяцев. Здесь размечено не то, что вы работаете, а то, каким день считается по закону: от этого зависит норма.">
      {DAY_TYPES.map((type) => (
        <Row
          key={type}
          picture={<CellPicture tone={DAY_TYPE_TONE[type]} date="12" mark={DAY_TYPE_MARK[type]} />}
          title={DAY_TYPE_LABELS[type]}
        >
          <p>{DAY_TYPE_EFFECT[type]}.</p>
        </Row>
      ))}
      <Row
        picture={
          <CellPicture tone={DAY_TYPE_TONE.working} date="12" mark={DAY_TYPE_MARK.working}>
            <span aria-hidden className="absolute -top-px -left-px size-3 rounded-full bg-ink" />
          </CellPicture>
        }
        title="Изменено вами"
      >
        <p>
          Точка в углу — день, который вы поменяли сами. Нажмите на день, чтобы выбрать, каким он
          считается: рабочий, предпраздничный, праздничный или выходной. Праздники (ст. 112 ТК РФ) и
          предпраздничные дни (ст. 95) размечены автоматически.
        </p>
        <p>
          Переносы выходных устанавливает Правительство отдельным постановлением на каждый год.
          Если приложение его ещё не знает, отметьте переносы сами; в легенде календаря есть
          кнопка <Q>Вернуть календарь по закону</Q>.
        </p>
      </Row>
      <Row
        picture={
          <CellPicture tone={DAY_TYPE_TONE.holiday} date="1" mark={DAY_TYPE_MARK.holiday}>
            <HolidayCorner />
          </CellPicture>
        }
        title="Праздничные дни"
      >
        <p>Те же серые подарки в углу, что и на графике смен, — в обеих сетках они стоят одинаково.</p>
      </Row>
    </Rows>
  );
}

// --- Данные ---------------------------------------------------------------

function Data() {
  return (
    <Rows lead="Всё, что открывается из шапки: настройки, списки внесённого, ваши графики и их сохранение.">
      <Row picture={<Big icon={Settings} />} title="Настройки">
        <p>
          Четыре раздела. <Q>График</Q> — имя, цикл смен, недельная норма, дата смены, начало и
          длительность. <Q>Показ расчёта</Q> — режим <Q>Онлайн</Q> и переработка в сменах вместо часов. <Q>Оформление</Q> — свои цвета
          событий и света лампы (для вошедших в учётную запись). <Q>Удаление</Q> — стереть график.
        </p>
      </Row>
      <Row picture={<Big icon={CalendarRange} />} title="События">
        <p>
          Всё, что вы внесли в график, одним списком по датам: что, когда, с какого по какое. Значок
          строки — тот же, что в клетке на сетке. Отсюда любую отметку можно убрать крестиком.
        </p>
      </Row>
      <Row picture={<Big icon={ChartColumn} />} title="Статистика">
        <p>
          Разбор выбранного учётного периода: как шли норма, факт, баланс и ночные часы по
          месяцам и точные числа таблицей. Смотрите, когда нужно сверить расчёт с табелем.
        </p>
      </Row>
      <Row picture={<Big icon={FolderOpen} />} title="Графики">
        <p>
          Проводник по сохранённым графикам: их может быть несколько. Можно создать график или
          папку, переименовать, переложить в папку, открыть из файла. Открытый график заменяет
          нынешний на экране, но не стирает его.
        </p>
      </Row>
      <Row picture={<Big icon={Save} />} title="Сохранить">
        <p>
          Выгружает график в файл (.json). Его можно открыть на другом устройстве через{" "}
          <Q>Графики</Q> → <Q>Из файла</Q>. Файл остаётся способом переноса и копией на случай,
          если браузер почистят.
        </p>
      </Row>
      {SYNC_ENABLED ? (
        <Row picture={<Big icon={UserRound} />} title="Учётная запись">
          <p>
            Необязательна: приложение работает и без неё. Она добавляет копию на сервере и перенос
            между устройствами: правка на телефоне оказывается на компьютере сама. Копия
            зашифрована, ключ выводится из вашего пароля в браузере, и сервер прочитать её не может.
            При регистрации выдаётся ключ восстановления — запишите его: без него и без пароля
            данные вернуть нельзя. При выходе графики уходят с этого устройства и возвращаются,
            когда вы входите снова; перед выходом приложение отправляет на сервер всё, что ещё
            не успело уехать, а если не получилось — предупреждает.
          </p>
        </Row>
      ) : null}
      <Row picture={<Big icon={Info} />} title="Расчёт справочный">
        <p>
          «График 1 3» не заменяет табель или другие документы работодателя. Приложение показывает,
          как норма и переработка получаются из производственного календаря и вашего графика.
          Точность зависит от введённого: даты смены, недельной нормы и периодов отсутствия.
        </p>
      </Row>
    </Rows>
  );
}

/** Содержимое открытого раздела. */
export function HelpSection({ id }: { id: HelpSectionId }) {
  switch (id) {
    case "start":
      return <Start />;
    case "header":
      return <Header />;
    case "totals":
      return <Totals />;
    case "cells":
      return <Cells />;
    case "edit":
      return <Edit />;
    case "dock":
      return <Dock />;
    case "calendar":
      return <CalendarHelp />;
    case "data":
      return <Data />;
  }
}
