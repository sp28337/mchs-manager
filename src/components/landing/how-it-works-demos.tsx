import { Fragment, type CSSProperties, type ReactNode } from "react";
import {
  CalendarRange,
  Check,
  ChartColumn,
  FolderOpen,
  Save,
  Settings,
  X,
} from "lucide-react";

import { HEADER_WORD, MARK_EMPTY, MenuMark } from "@/components/shared/header-action";
import { BalanceCaption } from "@/components/ui/balance-caption";
import { FigureSep, FIGURE_TRIO } from "@/components/ui/figure-sep";
import { knobOption } from "@/components/ui/knob";
import { MENU_LIST } from "@/components/ui/menu-row";
import { Figure } from "@/components/ui/summary-figure";
import { PeriodIcon } from "@/features/shift/components/grid-icons";
import { MonthGrid } from "@/features/shift/components/month-grid";
import {
  addDays,
  datesOfMonth,
  dayOfMonth,
  daysBetween,
  weekday,
  type IsoDate,
} from "@/features/shift/domain/plain-date";
import { SHIFT_CYCLE_DAYS, type AccountingPeriodKind } from "@/features/shift/domain/value-objects";
import { SYNC_ENABLED } from "@/features/sync/ui/enabled";
import { cn } from "@/lib/utils/cn";

import { DEMO_LIST, rowOf } from "./demo-list";
import { HandIcon } from "./hand-icon";

/**
 * Пять показов к разделу «Как работает».
 *
 * --- Почему показ, а не список возможностей -------------------------------
 *
 * Раздел был шестью плитками со значком и строчкой текста. Строчка честно
 * называла возможность — «при нажатии на день можно указать событие», — но
 * назвать и показать не одно и то же: человек, не открывавший приложение,
 * из такой строчки не знает ни что нажимать, ни что он увидит в ответ.
 *
 * --- Главное правило: показывать ТО ЖЕ, что внутри -------------------------
 *
 * Показ, нарисованный «в общем виде», хуже отсутствия показа: человек
 * узнаёт по нему приложение, приходит внутрь и не находит того, что видел.
 * Поэтому здесь взяты настоящие детали, а не похожие на них:
 *
 * * месяц собран `MonthGrid` — той же деталью, что и календарь расчёта,
 *   со смыканием клеток, скруглением контура и скосом уступа;
 * * цвета и буквы суток — из легенды расчёта: «О» и «Б» — освобождение от
 *   работы, «Р» — работа помимо графика (тот же код, что в клетке и в
 *   легенде расчёта, `CALLOUT_MARK`), «В» — свободные сутки;
 * * несомая смена повторяет `renderGhost` из `use-shift-drag` вплоть до
 *   слова «смена» под числом, наклона и тени;
 * * шапка, меню и окно выгрузки — то же слово «Меню» и те же три полосы,
 *   что складываются в крестик, пока меню открыто, те же строки действий и
 *   то же поле «Имя файла», что в `HeaderMenu`, `WorkspaceMenuItems` и
 *   `SaveToFile`.
 *
 * --- Почему разметкой, а не роликом ---------------------------------------
 *
 * По той же причине, по которой месяц первого экрана собран клетками, а не
 * снимком экрана: ролик не следует теме, не читается на узком экране, не
 * масштабируется и весит больше всей страницы.
 *
 * --- Про указатель --------------------------------------------------------
 *
 * Он один на все показы и нарисован рукой — тем курсором, который браузер
 * ставит над кнопкой. Стрелка означала бы «здесь просто наведено»; рука
 * говорит «сюда нажимают», а показы все до одного про нажатие.
 *
 * --- Про время ------------------------------------------------------------
 *
 * Расписание целиком лежит в `globals.css` и считается долями ОДНОГО круга
 * в шесть секунд: три на историю, три на паузу. Разметка отдаёт сюда
 * только номера — место клетки в волне и порядок в череде.
 */

/** Цвета клетки — те же, что в легенде расчёта. */
const TONE = {
  /** Начало смены. */
  shift: "border-verify/25 bg-verify/30 text-verify",
  /** Продолжение смены: те же сутки, но часы уже вчерашние. */
  tail: "border-verify/15 bg-verify/5 text-verify",
  /** Свободные сутки. */
  free: "border-transparent text-ink-faint",
  /** Освобождение от работы, «О» в легенде расчёта. */
  leave: "border-dashed border-leave/50 bg-leave-soft text-leave",
  /** Освобождение от работы, «Б» в легенде расчёта. */
  sick: "border-dashed border-sick/50 bg-sick-soft text-sick",
  /** Отгул за переработку. */
  rest: "border-dashed border-rest/50 bg-rest-soft text-rest",
  /** Работа помимо графика. */
  callout: "border-callout bg-callout-soft text-callout",
  /** Дополнительный отпуск. */
  trip: "border-dashed border-trip/50 bg-trip-soft text-trip",
  /** Учебный отпуск. */
  study: "border-dashed border-study/50 bg-study-soft text-study",
} as const;

/**
 * Те же освобождения вполголоса — на продолжении смены и на сутках без смены.
 *
 * Ровно то же правило, что в расчёте (`ABSENCE_TONE_QUIET` в
 * `day-marks.ts`): в полную силу стоят лишь сутки заступления на смену, а
 * её продолжение и свободные сутки внутри отпуска показывают протяжённость,
 * и ничего сверх этого человек в них не пропустил. Полным цветом такие сутки
 * кричали бы наравне с пропущенной сменой, и месяц читался бы как сплошная
 * потеря.
 */
const TONE_QUIET: Partial<Record<Tone, string>> = {
  leave: "border-dashed border-leave/20 bg-leave-soft/40 text-leave/70",
  sick: "border-dashed border-sick/20 bg-sick-soft/40 text-sick/70",
  rest: "border-dashed border-rest/20 bg-rest-soft/40 text-rest/70",
  trip: "border-dashed border-trip/20 bg-trip-soft/40 text-trip/70",
  study: "border-dashed border-study/20 bg-study-soft/40 text-study/70",
};

type Tone = keyof typeof TONE;

function vars(style: Record<string, number | string>): CSSProperties {
  return style as CSSProperties;
}

/** Во что превращаются сутки и в каком порядке. */
interface Becomes {
  mark: string;
  tone: Tone;
  /**
   * Место в череде отметок.
   *
   * Не миллисекунды, а НОМЕР: расписание считается кругом в `globals.css`,
   * и разметке знать о его длине незачем. Отметки одной группы приходят
   * почти разом, разные группы — по очереди.
   */
  step: number;
  /** Место внутри группы: период ложится днями подряд, а не разом. */
  order?: number;
  /** Не заступление на смену: отметка ложится вполголоса (`TONE_QUIET`). */
  quiet?: boolean;
}

/**
 * Клетка суток: число сверху, часы или буква снизу.
 *
 * Вторая строка есть всегда — как и в расчёте: без неё число в свободных
 * сутках стояло бы по центру, а в сутках со сменой выше, и ряд пошёл бы
 * волной.
 *
 * --- Как сутки становятся другими -----------------------------------------
 *
 * Двумя слоями: прежний вид гаснет, новый проявляется поверх. Подменить
 * содержимое нечем — страница отдаётся статикой, — а закрасить прежние
 * сутки непрозрачной накладкой не выходит: рамка рисуется по краю коробки,
 * и по контуру всё равно остаётся зелёная дужка в полпикселя.
 *
 * Срок один на оба слоя и живёт на самой клетке (`--step`, `--order`):
 * разъедься они — и в кадре окажется либо пустое место, либо два вида
 * суток разом.
 */
function Day({
  date,
  mark,
  tone,
  becomes,
  corners,
  lift,
  className,
  style,
  children,
}: {
  date: number;
  mark: string;
  tone: Tone;
  /** Во что эти сутки превращаются по ходу показа. */
  becomes?: Becomes;
  /** Внутри клетки: перечень видов и указатель, если нажимают по ней. */
  children?: ReactNode;
  /**
   * Номер записи, если по этой клетке нажимают (`DemoEvents`): пока для неё
   * раскрыт перечень, клетка стоит над размытием месяца.
   */
  lift?: number;
  /** Скругления по контуру месяца: их знает сетка, а не клетка. */
  corners?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      // Плашка месяца лежит под КАЖДОЙ клеткой, а не только под угловыми.
      // Скругления `corners` сетка отдаёт лишь тем клеткам, что стоят на
      // контуре, — у остальных приходит пустая строка, и проверка «есть ли
      // скругления» оставляла середину месяца без фона: свободные сутки
      // светились страницей насквозь, а плашка была только у последнего
      // столбца. Признак того, что клетка в сомкнутой сетке, — САМО
      // наличие `corners`, пусть и пустых.
      className={cn(
        "relative",
        // Над слоем размытия (`demo-scrim`, z-20): окошко на месте суток в
        // приложении вырезано в размытии, и сутки остаются чёткими. Только
        // на время своего перечня: у другой записи эти же сутки размыты
        // вместе с остальными.
        lift !== undefined && "demo-lift",
        corners !== undefined && "bg-paper-raised lit-tile",
        // Блик лампы гаснет на время, пока сутки показаны другими.
        //
        // Он лежит накладкой поверх содержимого клетки (`lit-tile` в
        // `globals.css`), новый вид полупрозрачен и на подскоке крупнее
        // клетки — и светлый контур блика оказывается ВНУТРИ него, будто
        // под новым видом лежат ещё одни сутки. Ровно то же, что на
        // первом экране, и лечится тем же.
        becomes && "demo-unlit",
        corners,
        className,
      )}
      style={{
        ...style,
        ...(becomes
          ? vars({ "--step": becomes.step, "--order": becomes.order ?? 0 })
          : null),
        ...(lift !== undefined ? vars({ "--round": lift }) : null),
      }}
    >
      <div
        className={cn(
          "flex aspect-square flex-col items-center justify-center rounded-md border leading-tight",
          TONE[tone],
          becomes && "demo-was",
        )}
      >
        <span className="font-mono text-[1em]">{date}</span>
        <span className="font-mono text-[0.7em]">{mark}</span>
      </div>

      {becomes ? (
        <span
          className={cn(
            "demo-became absolute inset-0 flex flex-col items-center justify-center",
            "rounded-md border leading-tight",
            // Вполголоса — на продолжении смены и на свободных сутках: в полную
            // силу стоят лишь сутки заступления (`TONE_QUIET`).
            (becomes.quiet ? TONE_QUIET[becomes.tone] : undefined) ?? TONE[becomes.tone],
          )}
        >
          <span className="font-mono text-[1em]">{date}</span>
          <span className="font-mono text-[0.7em]">{becomes.mark}</span>
        </span>
      ) : null}

      {children}
    </div>
  );
}

/**
 * Указатель — рука, а не стрелка.
 *
 * Браузер ставит руку над всем, по чему нажимают, и показы здесь все до
 * одного про нажатие. Стрелка сообщала бы «сюда просто наведено».
 *
 * Кольцо под ней — единственное, чем показано само нажатие: круг расходится
 * и гаснет, как по воде. Подпрыгивающий курсор читался бы мультфильмом.
 */
function Pointer({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span
      className={cn("demo-pointer pointer-events-none absolute z-20", className)}
      style={style}
    >
      <span className="demo-pointer__ring absolute -left-2 -top-2 size-10 rounded-full border-2 border-ink/25" />
      <HandIcon />
    </span>
  );
}

/** Общая рамка показа: кегль здесь задаёт размер всего, что внутри. */
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center",
        // Клетки и поля меряются в `em`, как и в расчёте, поэтому размер
        // показа задаётся одним кеглем — и растёт вместе с разделом.
        "text-sm sm:text-base lg:text-lg xl:text-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Месяц и неделя показов берутся из одного июля: год записан числом,
    потому что страница собирается заранее и раздаётся статикой. */
const MONTH_YEAR = 2028;
const MONTH_NUMBER = 7;
/** Смена, от которой отсчитывается цикл «сутки через трое» в месяце. */
const MONTH_SHIFT = `${MONTH_YEAR}-07-01` as IsoDate;

/* ========================================================================
   1. ГРАФИК И НОРМА — первый разговор с приложением.

   Два ответа, из которых получается всё остальное: какой у человека цикл
   и какая у него неделя. Показано это подменой значения и перестройкой
   полосы дней под ним.

   Полосы обе настоящие. «Сутки через трое»: смена начинается в восемь
   утра и длится сутки, поэтому первым суткам достаётся шестнадцать часов,
   вторым восемь, а дальше трое свободных. «Два через два» по двенадцать:
   смена не переваливает за полночь, и обе рабочие клетки полные.

   Подменить содержимое нечем — страница отдаётся статикой, — поэтому
   полосы лежат друг на друге: верхняя уходит, нижняя собирается волной.
   ======================================================================== */

/**
 * Неделя, на которой показываются график и перенос.
 *
 * Понедельник — воскресенье: ровно одна строка сетки, без уступов и
 * пустых клеток по краям. Собирается она `MonthGrid` — той же деталью, что
 * и календарь расчёта, — поэтому клетки сомкнуты, контур скруглён, а над
 * ними стоят буквы дней недели. Полоса из семи отдельных квадратиков
 * похожа на календарь, но не является им, и человек, придя внутрь, увидел
 * бы не то, что ему показывали.
 */
const WEEK_START = `${MONTH_YEAR}-07-10` as IsoDate;
const WEEK = Array.from({ length: 7 }, (_, index) => addDays(WEEK_START, index));

/** «Сутки через трое»: 16 часов в первых сутках, 8 во вторых, трое свободных. */
const WEEK_ONE_THREE: [mark: string, tone: Tone][] = [
  ["16", "shift"],
  ["8", "tail"],
  ["В", "free"],
  ["В", "free"],
  ["16", "shift"],
  ["8", "tail"],
  ["В", "free"],
];

/** «Два через два» по двенадцать часов: смена в полночь не переваливает. */
const WEEK_TWO_TWO: [mark: string, tone: Tone][] = [
  ["12", "shift"],
  ["12", "shift"],
  ["В", "free"],
  ["В", "free"],
  ["12", "shift"],
  ["12", "shift"],
  ["В", "free"],
];

/**
 * «Пять через два» по восемь часов — обычная рабочая неделя.
 *
 * Третьей она стоит не для счёта, а потому что устроена ИНАЧЕ: у первых
 * двух смены задаёт скользящий цикл, и он ложится на неделю как придётся,
 * а здесь их задаёт производственный календарь — выходные всегда суббота с
 * воскресеньем. На полосе это видно без единого слова: рабочие клетки
 * впервые встают подряд и упираются в край недели.
 */
const WEEK_FIVE_TWO: [mark: string, tone: Tone][] = [
  ["8", "shift"],
  ["8", "shift"],
  ["8", "shift"],
  ["8", "shift"],
  ["8", "shift"],
  ["В", "free"],
  ["В", "free"],
];

/** Неделя одним рядом: подпись графика над ней задаёт, чем её заполнить. */
function WeekGrid({
  cells,
  cellClassName,
  cellStyle,
  becomes,
}: {
  cells: [mark: string, tone: Tone][];
  cellClassName?: (index: number) => string | undefined;
  cellStyle?: (index: number) => CSSProperties | undefined;
  becomes?: (index: number) => Becomes | undefined;
}) {
  return (
    <MonthGrid
      joined
      days={WEEK}
      renderDay={(day, corners) => {
        const index = daysBetween(WEEK_START, day);
        const [mark, tone] = cells[index] ?? ["В", "free"];
        return (
          <Day
            date={dayOfMonth(day)}
            mark={mark}
            tone={tone}
            corners={corners}
            becomes={becomes?.(index)}
            className={cellClassName?.(index)}
            style={cellStyle?.(index)}
          />
        );
      }}
    />
  );
}

export function DemoSchedule() {
  return (
    // Круг у этого показа длиннее общего: нажатий в нём два, а не одно, и
    // между ними человек должен успеть прочитать, что получилось с первого.
    // Длительность приходит переменной, поэтому хватает одного класса на
    // обёртке — все анимации внутри считают доли уже от него.
    <Panel className="demo-schedule">
      <div className="w-full max-w-104 space-y-5">
        {/* Карточка держится заливкой, а не рамкой — как и всё на этой
            странице. Рамка вокруг плашки, да ещё и вокруг каждого значения
            внутри, давала три вложенных контура на одну строку: настройки
            выглядели чертежом, а не настройками. Заливки хватает: карточка
            на тон выше страницы, значение на тон ниже карточки. */}
        <div className="lit relative space-y-3 rounded-xl bg-paper-raised p-4">
          <Field label="График">
            {/* Значение перегорает — тем же приёмом, что цифры в названии
                сайта при смене графика: старое истлевает и его сносит,
                новое занимается на его месте. Значений три, и лежат они
                друг на друге: подменить содержимое нечем, страница
                отдаётся статикой. */}
            <span className="relative inline-block">
              <span className="demo-swap-out">1|3</span>
              <span className="demo-swap-mid absolute left-0 top-0">2|2</span>
              <span className="demo-swap-in absolute left-0 top-0">5|2</span>

              {/* Указатель наезжает на ПРАВЫЙ НИЖНИЙ угол значения, а не
                  встаёт поверх него. Стоял он в углу карточки, и рука
                  накрывала собой сам график: на экране было видно «1» и
                  ладонь вместо «1|3» — то единственное, ради чего показ и
                  заведён.
                  Смещения — от кисти к кончику пальца: тот приходится
                  примерно на двенадцатую точку по горизонтали и шестую по
                  вертикали внутри значка, и вычитаются они, чтобы к углу
                  пришёл именно палец, а не левый верхний угол картинки.
                  Указателей два, по одному на нажатие: они не перекрываются
                  во времени, а каждому нужен свой срок. */}
              <Pointer className="demo-tap-schedule left-[calc(100%-12px)] top-[calc(100%-6px)]" />
              <Pointer className="demo-tap-schedule-again left-[calc(100%-12px)] top-[calc(100%-6px)]" />
            </span>
          </Field>
          <Field label="Норма в неделю">40 часов</Field>
        </div>

        {/* Три недели на одном месте: нижняя задаёт размер, две верхние
            лежат поверх и уходят по очереди. Порядок в разметке обратный
            порядку истории — та, что уйдёт первой, лежит выше всех. */}
        <div className="relative">
          <div>
            <WeekGrid
              cells={WEEK_FIVE_TWO}
              cellClassName={() => "demo-cell-last"}
              cellStyle={(index) => vars({ "--i": index })}
            />
          </div>
          <div className="demo-strip-mid absolute inset-0">
            <WeekGrid
              cells={WEEK_TWO_TWO}
              cellClassName={() => "demo-cell-mid"}
              cellStyle={(index) => vars({ "--i": index })}
            />
          </div>
          <div className="demo-strip-prev absolute inset-0">
            <WeekGrid cells={WEEK_ONE_THREE} />
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Строка настроек: подпись слева, значение справа. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-display text-[0.7em] font-bold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <span className="rounded-lg bg-paper px-3 py-1 font-mono text-[0.9em]">
        {children}
      </span>
    </div>
  );
}

/* ========================================================================
   УЧЁТНЫЙ ПЕРИОД — второй шаг, сразу за графиком.

   График задан, норма из него следует — и тут же возникает вопрос «за
   какой срок?». По итогу учётного периода определяется переработка
   (ч. 3 ст. 104 ТК РФ), а период бывает разным: год, полугодие, квартал.
   Показано это нажатием на часы посередине шапки: круг на них закрашен
   на выбранную долю, под ними окошко со списком долей, а числа полосы
   итога отвечают на выбор новыми значениями.

   Всё, что здесь видно, взято из настоящих деталей:

   * знак — `PeriodIcon`, тот же, что на кнопке и в строках списка: целый
     круг — год, четверть — квартал;
   * окошко повторяет `PeriodPicker`: те же семь долей тремя ступенями
     (год, два полугодия, четыре квартала), та же строка списка
     (`knobOption`) и галочка у выбранной;
   * числа — `Figure` и `FigureSep`, те же, что в полосе итога и на первом
     экране, а подпись третьего — `BalanceCaption`;
   * значения НАСТОЯЩИЕ: их выдал расчёт для графика «сутки через трое» со
     сменой в восемь утра и первой сменой 2 января 2026-го — за год норма
     1972 часа, отработано 2184, разница 212; за второй квартал — 493, 536
     и 43. Выдуманные числа были бы враньём о том, что человек увидит
     внутри, и ловились бы первым же сравнением.

   Порядок — как в приложении: нажали на часы, окошко открылось, выбрали
   строку, окошко закрылось само, часы и числа сменились. Пока окошко
   открыто, числа за ним приглушены: в приложении они лежат под окошком
   и видны сквозь пустые места, а показу нужно, чтобы ответ не прочли до
   того, как о нём спросили.
   ======================================================================== */

type PeriodPart = { kind: AccountingPeriodKind; index: number; label: string };

/** Доли года так, как их показывает окошко: три ступени, от широкой к узкой. */
const PERIOD_GROUPS: readonly (readonly PeriodPart[])[] = [
  [{ kind: "year", index: 0, label: "Весь год" }],
  [
    { kind: "half_year", index: 0, label: "1-е полугодие" },
    { kind: "half_year", index: 1, label: "2-е полугодие" },
  ],
  [
    { kind: "quarter", index: 0, label: "1-й квартал" },
    { kind: "quarter", index: 1, label: "2-й квартал" },
    { kind: "quarter", index: 2, label: "3-й квартал" },
    { kind: "quarter", index: 3, label: "4-й квартал" },
  ],
];

/** Стоит с самого начала — год — и та, на которую нажимают, — второй квартал. */
export const PERIOD_FROM = PERIOD_GROUPS[0]![0]!;
export const PERIOD_TO = PERIOD_GROUPS[2]![1]!;

/**
 * Числа полосы: норма, отработано, переработка. Из расчёта, см. выше; тест
 * (`period-demo.test.ts`) пересчитывает их тем же расчётом и падает, если
 * расчёт изменился, а показ нет.
 */
export const PERIOD_FIGURES = {
  year: { norm: "1972", actual: "2184", balance: "212" },
  quarter: { norm: "493", actual: "536", balance: "43" },
} as const;

function PeriodFigures({ values }: { values: (typeof PERIOD_FIGURES)[keyof typeof PERIOD_FIGURES] }) {
  return (
    <dl className={cn("min-w-0 gap-x-2.5 md:gap-x-3.5", FIGURE_TRIO)}>
      <Figure still parts={[{ value: values.norm, unit: "ч" }]} caption="Норма периода" />
      <FigureSep />
      <Figure still parts={[{ value: values.actual, unit: "ч" }]} caption="Отработано" />
      <FigureSep />
      <Figure
        still
        parts={[{ value: values.balance, unit: "ч" }]}
        caption={<BalanceCaption under={false} />}
        tone="verify"
      />
    </dl>
  );
}

export function DemoPeriod() {
  return (
    // Круг длиннее общего: нажатий два, и между ними нужно успеть прочитать
    // список. Длительность приходит переменной, доли считаются от неё.
    <Panel className="demo-period">
      <div className="w-full max-w-104">
        {/* Шапка: только часы по середине — остальное в ней к показу не
            относится. Две копии знака лежат друг на друге: подменить
            содержимое нечем, страница отдаётся статикой. Нажимают на ту, что
            лежит в ячейке целиком: место под палец то же, что в приложении
            (44 точки), рисунок 28. */}
        <div className="flex justify-center">
          <span className="relative inline-flex size-11 items-center justify-center text-ink">
            <span className="demo-period-ring-year absolute inset-0 grid place-items-center">
              <PeriodIcon kind={PERIOD_FROM.kind} index={PERIOD_FROM.index} className="size-7" />
            </span>
            <span className="demo-period-ring-quarter absolute inset-0 grid place-items-center">
              <PeriodIcon kind={PERIOD_TO.kind} index={PERIOD_TO.index} className="size-7" />
            </span>
            <Pointer className="demo-tap-period-clock left-[calc(50%-12px)] top-[calc(50%-6px)]" />
          </span>
        </div>

        {/* Окошко и всё, что под ним, стоят в одной ячейке, как меню и окно в
            показе выгрузки: окошко открывается там, где лежат числа, и показу
            незачем подпрыгивать на высоту окошка. Высоту держит окошко, а числа
            и неделя под ними стоят у верха ячейки, вплотную под часами, — как
            полоса итога под шапкой в приложении. По середине они висели в
            пустоте: между часами и числами оставалась высота в полтора ряда
            списка.
            Неделя здесь — тот же ряд, что в первом показе (`WeekGrid`): в
            приложении под полосой итога лежит календарь, и числа без него
            висели бы в пустоте. Она не меняется от выбора — меняется набор
            месяцев, а одним рядом это не показать. */}
        <div className="mt-2 grid">
          <div className="demo-period-veil col-start-1 row-start-1 space-y-5 self-start">
            <div className="grid">
              <div className="demo-period-figures-year col-start-1 row-start-1">
                <PeriodFigures values={PERIOD_FIGURES.year} />
              </div>
              <div className="demo-period-figures-quarter col-start-1 row-start-1">
                <PeriodFigures values={PERIOD_FIGURES.quarter} />
              </div>
            </div>
            <WeekGrid cells={WEEK_ONE_THREE} />
          </div>

          {/* Окошко — то самое, что открывает кнопка (`PeriodPicker`): та же
              кайма, ширина и три ступени списка с чертой между ними. */}
          <div
            className={cn(
              "demo-period-list lit modal-lift col-start-1 row-start-1 w-64 max-w-full",
              "justify-self-center self-start rounded-xl bg-paper-raised p-1.5",
              MENU_LIST,
            )}
          >
            {PERIOD_GROUPS.map((group, at) => (
              <Fragment key={group[0]!.kind}>
                {at > 0 ? (
                  <div aria-hidden className="mx-2.5 my-0.5 border-t border-rule" />
                ) : null}
                {group.map((part) => {
                  const active = part === PERIOD_FROM;
                  const target = part === PERIOD_TO;
                  return (
                    <span
                      key={`${part.kind}:${part.index}`}
                      className={cn(
                        knobOption(active),
                        // Строка подсвечивается под нажатием и отпускает, как
                        // строка меню в показе выгрузки.
                        target && "demo-period-target relative",
                      )}
                    >
                      <PeriodIcon
                        kind={part.kind}
                        index={part.index}
                        className={active ? "text-ink" : undefined}
                      />
                      {part.label}
                      {active ? <Check aria-hidden className="ml-auto text-ink" /> : null}
                      {target ? (
                        <Pointer className="demo-tap-period-row left-[calc(100%-40px)] top-[calc(50%-4px)]" />
                      ) : null}
                    </span>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ========================================================================
   2. ПЕРЕНОС СМЕНЫ.

   Подмены и переносы случаются, и цикл о них не знает: смену отдали на
   другой день, и в табеле она стоит там. В приложении это делается тем же
   движением, каким переносят карточку, — нажать, подержать, перетащить.

   Всё, что здесь видно, взято из настоящего переноса:

   * несомая клетка повторяет `renderGhost` — число и слово «смена» под
     ним, наклон, увеличение и тень;
   * сутки, откуда смену унесли, гаснут до трети плотности, как в
     `DayCell`;
   * сутки под указателем обведены изнутри, как `target` там же.

   Переезжает ПАРА суток: суточная смена лежит в двух календарных днях, и
   хвост уезжает вместе с началом. Показать переезд одной клетки значило бы
   соврать о том, что человек увидит.

   Цикла эта неделя не показывает намеренно: перенос — это и есть
   ИСКЛЮЧЕНИЕ из цикла, и после него смена стоит там, где никакой цикл её
   не поставил бы.
   ======================================================================== */

const MOVE_WEEK: [mark: string, tone: Tone][] = [
  ["В", "free"],
  ["16", "shift"],
  ["8", "tail"],
  ["В", "free"],
  ["В", "free"],
  ["В", "free"],
  ["В", "free"],
];

/**
 * Что становится с каждыми сутками, когда смену донесли.
 *
 * Третья доля череды (`step: 2`) — это и есть та минута, когда смену
 * отпускают: путь каретки кончается на двадцать девятой сотой круга, и
 * сутки меняются ровно там, а не раньше.
 */
const MOVE_BECOMES: (Becomes | undefined)[] = [
  undefined,
  { mark: "В", tone: "free", step: 2 },
  { mark: "В", tone: "free", step: 2 },
  undefined,
  undefined,
  { mark: "16", tone: "shift", step: 2 },
  { mark: "8", tone: "tail", step: 2 },
];

export function DemoMove() {
  return (
    <Panel>
      <div className="relative w-full max-w-96">
        <WeekGrid
          cells={MOVE_WEEK}
          becomes={(index) => MOVE_BECOMES[index]}
          cellClassName={(index) =>
            cn(
              // Сутки, откуда несут, гаснут — обе, и начало и продолжение.
              (index === 1 || index === 2) && "demo-source",
              // А обводятся только те, что ПОД указателем. Обводка стояла
              // на паре — и на 15-м, и на 16-м, — а несомая клетка висела
              // над 15-м: выходило, что подсвечен ещё и следующий день,
              // которого человек не выбирал. В расчёте обведены ровно те
              // сутки, куда положат (`target` в `DayCell`), а продолжение
              // достроится само и заранее себя не объявляет.
              index === 5 && "demo-target",
            )
          }
        />

        {/* Каретка: несомая смена и указатель едут вместе, одним слоем.
            Порознь их не сдвинуть — проценты в `translate` считаются от
            ширины САМОГО элемента, а не сетки, и клетка шириной в седьмую
            часть уехала бы на седьмую часть клетки. Каретка же во всю
            ширину сетки, и шаг в колонку для неё выражается точно.

            Прижата к низу: над клетками стоит строка букв, и от верха
            отсчитывать пришлось бы её высоту. */}
        <div className="demo-carriage pointer-events-none absolute inset-x-0 bottom-0">
          {/* Та же клетка, что летит под указателем в расчёте: число, слово
              «смена», наклон, увеличение и тень — всё из `renderGhost`. */}
          <span className="demo-carried absolute bottom-0 left-0 w-1/7 rounded-md bg-paper">
            <span
              className={cn(
                "flex aspect-square w-full flex-col items-center justify-center",
                "rounded-md border leading-tight",
                TONE.shift,
              )}
            >
              <span className="font-mono text-[1em]">11</span>
              <span className="font-mono text-[0.55em]">смена</span>
            </span>
          </span>

          <Pointer className="demo-drag bottom-[18%] left-[9%]" />
        </div>
      </div>
    </Panel>
  );
}

/* ========================================================================
   3. ЧТО БЫЛО ПОМИМО ГРАФИКА — на целом месяце.

   Показывать это парой суток бессмысленно: освобождение от работы — это
   ПЕРИОД, и вся его суть в том, сколько смен он накрыл и что при этом
   стало с нормой. На двух клетках периода не видно вовсе.

   Поэтому здесь месяц целиком, собранный `MonthGrid` — той же деталью, что
   и календарь расчёта. По нему одна за другой ложатся три записи, и они
   намеренно РАЗНЫЕ по действию:

   * дни освобождения от работы уменьшают НОРМУ учётного периода (письмо
     Роструда № 550-6-1);
   * вызов в резерв прибавляется к ОТРАБОТАННОМУ и норму не трогает
     (ст. 91 ТК РФ).

   Резерв стоит на сутках, где смена сдаётся: после смены в резерв —
   обычное дело, и это тот случай, ради которого вызовы вообще заведены.
   ======================================================================== */

/** Сутки начала смены и её продолжения: 24 часа делятся полуночью. */
const SHIFT_START_HOURS = "16";
const SHIFT_TAIL_HOURS = "8";

function isShiftStart(day: IsoDate): boolean {
  const delta = daysBetween(MONTH_SHIFT, day);
  return ((delta % SHIFT_CYCLE_DAYS) + SHIFT_CYCLE_DAYS) % SHIFT_CYCLE_DAYS === 0;
}

/**
 * Перечень видов у клетки — то же окошко, что раскрывается в расчёте.
 *
 * --- Почему перечень, а не кольцо -------------------------------------------
 *
 * Кольцо из восьми квадратов с одной буквой в расчёте давно заменено:
 * вокруг дня раскрывается окошко со знаком и названием в строке, и нажимают
 * по самой строке (`day-ring.tsx`). Показ оставался на кольце — человек,
 * увидев на главной «восемь букв вокруг дня», внутри находил совсем другое.
 *
 * Здесь та же плашка (`lit modal-lift`), те же строки, те же знаки и
 * названия (`demo-list.ts`), и стоит она сбоку от дня, не закрывая его, —
 * как в приложении, где перечень уходит туда, где больше места.
 *
 * Меры заданы в `em` от кегля самого перечня, а не от кегля показа: в
 * приложении строка в сорок точек при кегле в шестнадцать, и пропорции
 * строки, знака и полей должны быть теми же при любом размере показа.
 * Кегль перечня — три четверти кегля показа, но не мельче двенадцати точек:
 * на телефоне название читается и мелким, а нечитаемым оно уже нет.
 */
const LIST_EM = "max(12px, 0.75em)";

/**
 * Перечень, раскрытый слева от суток.
 *
 * Слева, а не справа, потому что сутки, по которым нажимают, стоят в
 * правой половине недели (пятница, суббота), и места справа от них нет —
 * приложение в таком случае делает ровно то же: встаёт на ту сторону, где
 * места больше.
 *
 * Слоёв два: внешний ставит перечень на место (правый край — у левой
 * кромки суток, середина — против середины месяца: перечень почти во весь
 * его рост и в приложении прижимается к краям сетки) и ничего не
 * анимирует, внутренний — сама плашка, раскрывающаяся мягко. Место — в
 * `globals.css`, там же, где путь руки: обе меры выводятся из одних чисел.
 */
function DemoList({ round, pick, row }: { round: number; pick: number; row: number }) {
  return (
    <span
      className="demo-list-spot pointer-events-none absolute z-30"
      style={{ fontSize: LIST_EM, ...vars({ "--row": row }) }}
    >
      <span
        className="demo-list lit modal-lift block w-[14.5em] rounded-xl bg-paper-raised p-[0.375em]"
        style={vars({ "--round": round })}
      >
        <ul className="grid gap-[0.125em]">
          {DEMO_LIST.map((row, index) => (
            <li
              key={row.key}
              className={cn(
                "flex h-[2.5em] items-center gap-[0.625em] rounded-lg px-[0.375em] text-ink",
                index === pick && "demo-list-pick",
              )}
              style={index === pick ? vars({ "--round": round }) : undefined}
            >
              <span
                aria-hidden
                className={cn(
                  "relative flex size-[1.75em] shrink-0 items-center justify-center",
                  "rounded-md border font-mono text-[0.75em] leading-none",
                  row.tone,
                )}
              >
                {row.corner ? (
                  <span
                    aria-hidden
                    className="absolute right-0 top-0 size-0 border-l-4 border-t-4 border-l-transparent border-t-trace"
                  />
                ) : null}
                {row.mark}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.875em]">{row.label}</span>
            </li>
          ))}
        </ul>
      </span>
    </span>
  );
}

/**
 * Рука: сперва у самих суток, потом на выбранной строке перечня.
 *
 * Стоит она в центре суток и едет оттуда на строку — влево на ширину
 * половины клетки, просвет и часть перечня, и по высоте на разницу между
 * серединой суток и серединой строки. Обе меры выведены в `globals.css`
 * из тех же чисел, что и разметка: клетка — седьмая часть месяца
 * (`cqw`), строка — доля кегля перечня.
 */
function DemoListHand({ round, pick, row }: { round: number; pick: number; row: number }) {
  return (
    <span
      className="demo-hand pointer-events-none absolute left-1/2 top-1/2 z-30"
      style={{ fontSize: LIST_EM, ...vars({ "--round": round, "--pick": pick, "--row": row }) }}
    >
      <Pointer className="demo-hand-ring left-0 top-0" />
    </span>
  );
}

/**
 * Что ложится на месяц, в каком порядке и какой строкой перечня выбрано.
 *
 * Числа — настоящие сутки июля: больничный четырьмя днями, отпуск неделей,
 * вызов одними сутками. `pick` — место строки в перечне: по ней и щёлкает
 * рука, прежде чем отметка ляжет на сетку.
 *
 * Сутки, по которым нажимают (`from`), стоят в правой половине недели
 * нарочно: перечень раскрывается влево, на сетку, а не за её правый край.
 * В приложении он выбирает сторону сам, но показу негде брать запас —
 * справа от месяца поля нет.
 */
const MONTH_MARKS: {
  days: number[];
  mark: string;
  tone: Tone;
  step: number;
  /** Сутки, по которым нажимают: у них перечень и раскрывается. */
  from: number;
  /** Строка перечня, которую выбирают. */
  pick: number;
}[] = [
  { days: [13, 14, 15, 16], mark: "Б", tone: "sick", step: 0, from: 14, pick: rowOf("sick_leave") },
  { days: [19, 20, 21, 22, 23, 24, 25], mark: "О", tone: "leave", step: 1, from: 22, pick: rowOf("annual_leave") },
  // Тот же код, что и в самом приложении: в клетке любая работа сверх
  // графика помечается одной буквой (`CALLOUT_MARK`), а чем именно был
  // вызов — резервом, сбором, соревнованиями — говорит подпись.
  { days: [28], mark: "Р", tone: "callout", step: 2, from: 28, pick: rowOf("callout") },
];

function markFor(date: number, quiet: boolean): Becomes | undefined {
  for (const group of MONTH_MARKS) {
    const order = group.days.indexOf(date);
    if (order >= 0) {
      return { mark: group.mark, tone: group.tone, step: group.step, order, quiet };
    }
  }
  return undefined;
}

export function DemoEvents() {
  const days = datesOfMonth(MONTH_YEAR, MONTH_NUMBER);
  // Место суток в сетке: от строки в месяце зависит, где по высоте встанет
  // перечень и насколько вниз или вверх поедет рука.
  const offset = weekday(days[0]!);

  return (
    <Panel className="demo-events">
      {/* Мера в `cqw` — ширина самого месяца: клетка там седьмая часть, и
          рука едет на столько, на сколько он сейчас шириной. */}
      <div className="relative w-full max-w-88 [container-type:inline-size]">
        {/* Размытие под перечнем — по одному на каждую запись: они
            приходят по очереди, и общее на троих гасло бы и разгоралось
            трижды за круг одной и той же дорожкой. Только размытие, без
            затемнения — как в приложении (`Scrim`, `day-ring.tsx`). */}
        {MONTH_MARKS.map((group, index) => (
          <span
            key={group.mark}
            aria-hidden
            className="demo-scrim pointer-events-none absolute -inset-1 z-20 rounded-xl backdrop-blur-[2px]"
            style={vars({ "--round": index })}
          />
        ))}

        <MonthGrid
          joined
          days={days}
          renderDay={(day, corners) => {
            const date = dayOfMonth(day);
            const start = isShiftStart(day);
            const tail = isShiftStart(addDays(day, -1));
            // В полный голос — только сутки заступления на смену; продолжение
            // смены и свободные сутки вполголоса, как и в расчёте: там тоже
            // различаются заступление и продолжение — цвет тот же, плотность
            // меньше (`ABSENCE_TONE_QUIET`).
            const becomes = markFor(date, !start);
            const round = MONTH_MARKS.findIndex((group) => group.from === date);
            const slot = date - 1 + offset;

            return (
              <Day
                date={date}
                mark={start ? SHIFT_START_HOURS : tail ? SHIFT_TAIL_HOURS : "В"}
                tone={start ? "shift" : tail ? "tail" : "free"}
                becomes={becomes}
                corners={corners}
                // Сутки, по которым нажимают, остаются над размытием —
                // чёткими, как окошко на месте дня в приложении.
                lift={round >= 0 ? round : undefined}
              >
                {round >= 0 ? (
                  <>
                    <DemoList
                      round={round}
                      pick={MONTH_MARKS[round]!.pick}
                      row={Math.floor(slot / 7)}
                    />
                    <DemoListHand
                      round={round}
                      pick={MONTH_MARKS[round]!.pick}
                      row={Math.floor(slot / 7)}
                    />
                  </>
                ) : null}
              </Day>
            );
          }}
        />
      </div>
    </Panel>
  );
}

/* ========================================================================
   4. ВЫГРУЗКА В ФАЙЛ И ТО, ЧЕГО НЕ ПРОИСХОДИТ.

   Утверждение «данные никуда не уходят» проверяемое, и показать его нужно
   так же — не замком с надписью «безопасно», а тем, что происходит на
   самом деле: человек выбирает «Сохранить» в меню шапки, называет
   файл, и файл ложится на то же устройство.

   Шапка, меню и окно здесь настоящие: то же слово «Меню» и три полосы,
   которые, пока меню открыто, сложены крестиком, а когда оно закрылось,
   разошлись обратно (`MenuMark` и тот же ход, что у кнопки в шапке), те же
   пять строк действий, тот же заголовок «Сохранить график в файл» и то же
   поле «Имя файла».

   Перечёркнутая стрелка в конце обязательна: без неё «сохранить в файл»
   читалось бы как «отправить». Это единственное место на странице, где
   сказано о том, чего НЕ происходит.
   ======================================================================== */

export function DemoStorage() {
  return (
    <Panel>
      <div className="w-full max-w-104">
        {/* Шапка приложения: слово «Меню» и три полосы — то, что стоит в ней
            на самом деле (`shared/header-menu.tsx`). Плашки под ними нет: в
            приложении шапка прозрачна. Слово остаётся и при открытом меню,
            а полосы складываются в крестик, как у настоящей кнопки; ход
            задан в `globals.css` (`demo-bar-*`) долями круга показа, в такт
            меню ниже. `--bar-rest` — прозрачность покоя средней полосы,
            которую та получает назад, когда крестик расходится. */}
        <div className="flex items-center justify-end pb-3">
          <span
            className="demo-burger inline-flex items-center gap-2"
            style={{ "--bar-rest": MARK_EMPTY.opacity } as CSSProperties}
          >
            <span className={HEADER_WORD}>Меню</span>
            <MenuMark />
          </span>
        </div>

        {/* Меню и окно стоят в одной ячейке сетки: меню гаснет ровно
            тогда, когда открывается окно, и показу незачем подпрыгивать
            на высоту одного из них. Высоту держит большее из двух — с
            пятой строкой меню («События») на широком экране оно стало
            выше окна, и вынесенное из потока вылезало бы за ячейку. */}
        <div className="grid">
        {/* Меню — то самое, что открывает эта кнопка: пять действий
            рабочего экрана. Нажимают здесь по последнему. Кайма — та же
            живая, что у меню в приложении (`lit`). */}
        <div className="demo-menu lit modal-lift relative col-start-1 row-start-1 w-60 self-start justify-self-end rounded-xl bg-paper-raised p-1.5 grid gap-1">
          <MenuRow icon={Settings}>Настройки</MenuRow>
          <MenuRow icon={CalendarRange}>События</MenuRow>
          <MenuRow icon={ChartColumn}>Статистика</MenuRow>
          <MenuRow icon={FolderOpen}>Графики</MenuRow>
          <MenuRow icon={Save} className="demo-save-button">
            Сохранить
          </MenuRow>
          <Pointer className="demo-tap-save bottom-1 right-6" />
        </div>

        {/* Окно выгрузки — то самое, что открывается этой строкой, и
            собрано оно как настоящее (`save-to-file.tsx`): поднятая бумага
            со светом и тенью окна, заголовок прописными и крестик в углу,
            под ними вопрос с полем, а внизу две кнопки. */}
        <div className="demo-dialog lit modal-lift col-start-1 row-start-1 self-start rounded-xl bg-paper-raised">
          <div className="flex items-center gap-3 px-4 pt-3 pb-1">
            <p className="min-w-0 flex-1 font-display text-[0.8em] font-bold uppercase leading-6 tracking-wide">
              Сохранить график в файл
            </p>
            <span className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-muted">
              <X aria-hidden className="size-4" />
            </span>
          </div>

          <div className="px-4 pb-4">
            {/* Карточка внутри окна — одна линовка, без второй плашки:
                окно и ЕСТЬ поднятая бумага, и плашка в нём читалась бы
                коробкой в коробке (`ui/panel.tsx`). */}
            <div className="space-y-2 border-b border-rule py-3">
              <span className="block text-[0.8em] font-medium">Имя файла</span>
              {/* Имя набирается: полоса ширины раскрывает знак за знаком, а
                  каретка стоит у её края. Поле такое же, как в приложении:
                  заливка и невидимая рамка, которая проявляется только под
                  курсором. */}
              <span className="flex h-9 w-full items-center rounded-lg border border-paper bg-paper px-3">
                <span className="demo-typed font-mono text-[0.85em]">Мой график</span>
                <span className="demo-caret ml-px h-[1.1em] w-px bg-ink" />
              </span>
            </div>

            {/* Две кнопки во всю ширину поровну — как в окне: согласие
                залито чернилами, отказ держится одним словом. */}
            <div className="flex gap-2 pt-3">
              <span className="demo-confirm inline-flex h-9 flex-1 items-center justify-center rounded-xl bg-ink px-4 text-[0.8em] font-medium text-paper">
                Сохранить
              </span>
              <span className="inline-flex h-9 flex-1 items-center justify-center rounded-xl border border-transparent px-4 text-[0.8em] font-medium text-ink">
                Отмена
              </span>
            </div>
          </div>
        </div>
        </div>

        {/* Что вышло и чего не произошло — одной строкой под окном. */}
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="demo-file inline-flex items-center gap-2 rounded-lg border border-dashed border-rule-strong px-3 py-1.5">
            <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-ink-muted" aria-hidden fill="none">
              <path
                d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-mono text-[0.75em] text-ink-muted">мой-график.json</span>
          </span>

          <span className="flex items-center gap-1.5 text-ink-faint">
            <span className="demo-uplink font-display text-[0.7em] font-bold uppercase tracking-wide">
              {/* Показ — про выгрузку В ФАЙЛ, и подпись говорит о файле.
                  «В сеть не уходит» было правдой, пока сети не было вовсе;
                  рядом с шагом, где сказано про зашифрованную копию на
                  сервере, та же подпись читалась бы как спор с ним. Файл
                  при этом и правда остаётся на устройстве — в обеих
                  сборках. */}
              {SYNC_ENABLED ? "остаётся на устройстве" : "в сеть не уходит"}
            </span>
            {/* Перечёркивание двумя линиями: под красной идёт линия цвета
                страницы вчетверо толще — она вырезает в стрелке просвет, и
                черта читается ЧЕРТОЙ, а не второй линией поверх. */}
            <svg viewBox="0 0 24 24" className="demo-uplink size-7" aria-hidden fill="none">
              <path
                d="M12 21V5m0 0-5.5 5.5m5.5-5.5 5.5 5.5"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M4 20 20 4"
                className="demo-uplink__cross stroke-paper"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <path
                d="M4 20 20 4"
                className="demo-uplink__cross stroke-signal"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </div>
      </div>
    </Panel>
  );
}

function MenuRow({
  icon: Icon,
  className,
  children,
}: {
  icon: typeof Save;
  className?: string;
  children: string;
}) {
  return (
    // Та же строка, что в меню приложения (`shared/header-menu.tsx`):
    // значок слева, слово за ним, во всю ширину.
    <span
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.8em] text-ink",
        className,
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />
      {children}
    </span>
  );
}
