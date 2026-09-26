import type { CSSProperties, ReactNode } from "react";
import {
  ChartColumn,
  ChevronDown,
  Folder,
  FolderOpen,
  Save,
  Settings,
  User,
  X,
} from "lucide-react";

import { MonthGrid } from "@/features/shift/components/month-grid";
import {
  addDays,
  datesOfMonth,
  dayOfMonth,
  daysBetween,
  type IsoDate,
} from "@/features/shift/domain/plain-date";
import { SHIFT_CYCLE_DAYS } from "@/features/shift/domain/value-objects";
import { cn } from "@/lib/utils/cn";

/**
 * Четыре показа к разделу «Как работает».
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
 * * шапка и окно выгрузки — те же кнопки и то же поле «Имя файла», что в
 *   `HeaderTools` и `SaveToFile`.
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
  leave: "border-dashed border-signal/50 bg-signal-soft text-signal",
  /** Освобождение от работы, «Б» в легенде расчёта. */
  sick: "border-dashed border-sick/50 bg-sick-soft text-sick",
  /** Отгул за переработку. */
  rest: "border-dashed border-rest/50 bg-rest-soft text-rest",
  /** Работа помимо графика. */
  callout: "border-trace bg-trace-soft text-trace",
  /** Дополнительный отпуск. */
  trip: "border-dashed border-trip/50 bg-trip-soft text-trip",
  /** Учебный отпуск. */
  study: "border-dashed border-study/50 bg-study-soft text-study",
} as const;

/**
 * Те же освобождения вполголоса — на сутках, где смены не было.
 *
 * Ровно то же правило, что в расчёте (`ABSENCE_TONE_QUIET` в
 * `shift-strip.tsx`): отпуск идёт подряд, и в свободные сутки внутри него
 * человек всё равно ничего не пропустил. Полным цветом такие сутки кричали
 * бы наравне с пропущенной сменой, и месяц читался бы как сплошная потеря.
 */
const TONE_QUIET: Partial<Record<Tone, string>> = {
  leave: "border-dashed border-signal/20 bg-signal-soft/40 text-signal/70",
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
  /** Сутки без смены: отметка ложится вполголоса (`TONE_QUIET`). */
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
  className,
  style,
  children,
}: {
  date: number;
  mark: string;
  tone: Tone;
  /** Во что эти сутки превращаются по ходу показа. */
  becomes?: Becomes;
  /** Внутри клетки: кольцо видов и указатель, если нажимают по ней. */
  children?: ReactNode;
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
            // Вполголоса — на свободных сутках: там смены не было, и
            // терять человеку было нечего (`TONE_QUIET`).
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
      <svg viewBox="0 0 24 24" className="size-7 drop-shadow-md" aria-hidden fill="none">
        <path
          d="M9.2 12.4V5.1a1.35 1.35 0 0 1 2.7 0v5.2m0-1.1a1.35 1.35 0 0 1 2.7 0v1.3m0-0.9a1.35 1.35 0 0 1 2.7 0v1.2m0-0.5a1.35 1.35 0 0 1 2.7 0v3.9c0 3.2-2.1 5.8-5.4 5.8h-1.2c-2 0-3.2-.8-4.1-2.2l-2.6-4c-.5-.8-.2-1.7.6-2.1.7-.4 1.6-.2 2 .5z"
          className="fill-paper stroke-ink"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
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
 * Грани кольца — те же восемь, что в приложении, и в том же порядке.
 *
 * Кольцо расчёта (`day-ring.tsx`) раскрывает вокруг суток восемь видов:
 * три отпуска, больничный, работа сверх графика, смена, заметка, отгул.
 * Здесь они той же клеткой, теми же буквами и теми же цветами — иначе
 * человек, пришедший внутрь, не узнал бы того, что видел.
 *
 * Легенды при кольце нет: в приложении она объясняет восемь значков
 * словами, а показу объяснять некогда — он длится три четверти секунды, и
 * восемь подписей в нём читались бы мельтешением.
 */
const RING_FACES: { mark: string; tone: Tone }[] = [
  { mark: "О", tone: "leave" },
  { mark: "Д", tone: "trip" },
  { mark: "У", tone: "study" },
  { mark: "Б", tone: "sick" },
  { mark: "Р", tone: "callout" },
  { mark: "24", tone: "shift" },
  { mark: "В", tone: "rest" },
  { mark: "\u270e", tone: "free" },
];

/**
 * Место грани в кольце: восемь клеток вокруг девятой, пустой.
 *
 * Пустая середина — не украшение: сквозь неё видно ТЕ САМЫЕ сутки, вокруг
 * которых кольцо и раскрылось. Закрой её — и человек потеряет из виду
 * предмет разговора.
 */
const RING_PLACES: [col: number, row: number][] = [
  [1, 1],
  [2, 1],
  [3, 1],
  [1, 2],
  [3, 2],
  [1, 3],
  [2, 3],
  [3, 3],
];

/** Общая мера кольца: три клетки в поперечнике, середина — сами сутки. */
const RING_BOX = cn(
  "absolute left-1/2 top-1/2 z-30 aspect-square w-[300%]",
  "-translate-x-1/2 -translate-y-1/2 grid grid-cols-3 grid-rows-3 gap-0.5",
);

/** Кольцо видов вокруг суток. */
function DemoRing({ round }: { round: number }) {
  return (
    <span className={cn("demo-ring pointer-events-none", RING_BOX)} style={vars({ "--round": round })}>
      {RING_PLACES.map(([col, row], index) => {
        const face = RING_FACES[index]!;
        return (
          <span
            key={face.mark}
            style={{ gridColumn: col, gridRow: row }}
            className={cn(
              "flex flex-col items-center justify-center rounded-md border",
              "bg-paper-raised leading-tight",
              TONE[face.tone],
            )}
          >
            <span className="font-mono text-[0.72em]">{face.mark}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Рука над кольцом: сперва у самих суток, потом у выбранной грани.
 *
 * Стоит она в той же сетке три на три, что и кольцо, и в той же ячейке,
 * что выбранная грань. Отсюда и весь её путь: доехать до середины — это
 * сдвинуться ровно на свою же ширину, сколько бы ни было кольцо ростом.
 * Поэтому смещение задано долями самой руки (`--to-x`, `--to-y`), а не
 * точками: показ растёт вместе с разделом, и точки пришлось бы пересчитывать.
 */
function DemoRingHand({ round, pick }: { round: number; pick: number }) {
  const [col, row] = RING_PLACES[pick]!;
  return (
    <span className={cn("pointer-events-none", RING_BOX)}>
      <span
        className="demo-hand relative"
        style={{
          gridColumn: col,
          gridRow: row,
          ...vars({ "--round": round, "--to-x": `${(2 - col) * 100}%`, "--to-y": `${(2 - row) * 100}%` }),
        }}
      >
        <Pointer className="demo-hand-ring left-1/2 top-1/2" />
      </span>
    </span>
  );
}

/**
 * Что ложится на месяц, в каком порядке и какой гранью кольца выбрано.
 *
 * Числа — настоящие сутки июля: больничный четырьмя днями, отпуск неделей,
 * вызов одними сутками. `pick` — место грани в кольце: по ней и щёлкает
 * рука, прежде чем отметка ляжет на сетку.
 *
 * Сутки, по которым нажимают (`from`), взяты из середины месяца нарочно:
 * кольцо втрое шире клетки, и с краю сетки оно вылезало бы за показ — у
 * верхнего ряда за подписи дней недели, у правого столбца за поле. В
 * приложении такое кольцо просто сдвигается к краю окна, но там и места
 * целый экран.
 */
const MONTH_MARKS: {
  days: number[];
  mark: string;
  tone: Tone;
  step: number;
  /** Сутки, по которым нажимают: с них кольцо и раскрывается. */
  from: number;
  /** Грань кольца, которую выбирают (место в `RING_FACES`). */
  pick: number;
}[] = [
  { days: [13, 14, 15, 16], mark: "Б", tone: "sick", step: 0, from: 14, pick: 3 },
  { days: [19, 20, 21, 22, 23, 24, 25], mark: "О", tone: "leave", step: 1, from: 22, pick: 0 },
  // Тот же код, что и в самом приложении: в клетке любая работа сверх
  // графика помечается одной буквой (`CALLOUT_MARK`), а чем именно был
  // вызов — резервом, сбором, соревнованиями — говорит подпись.
  { days: [28], mark: "Р", tone: "callout", step: 2, from: 28, pick: 4 },
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

  return (
    <Panel className="demo-events">
      <div className="relative w-full max-w-88">
        {/* Затемнение под кольцом — по одному на каждую запись: они
            приходят по очереди, и общее на троих гасло бы и разгоралось
            трижды за круг одной и той же дорожкой. */}
        {MONTH_MARKS.map((group, index) => (
          <span
            key={group.mark}
            aria-hidden
            className="demo-ring-scrim pointer-events-none absolute -inset-1 z-20 rounded-xl bg-paper/70 backdrop-blur-[2px]"
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
            // Сутки без смены — те, где терять было нечего: отметка на них
            // ложится вполголоса, как и в расчёте.
            const becomes = markFor(date, !start && !tail);
            const round = MONTH_MARKS.findIndex((group) => group.from === date);

            return (
              <Day
                date={date}
                mark={start ? SHIFT_START_HOURS : tail ? SHIFT_TAIL_HOURS : "В"}
                tone={start ? "shift" : tail ? "tail" : "free"}
                becomes={becomes}
                corners={corners}
              >
                {round >= 0 ? (
                  <>
                    <DemoRing round={round} />
                    <DemoRingHand round={round} pick={MONTH_MARKS[round]!.pick} />
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
   самом деле: человек нажимает «Сохранить» в шапке, называет файл, и файл
   ложится на то же устройство.

   Шапка и окно здесь настоящие: те же две кнопки со значками, тот же
   заголовок «Сохранить профиль в файл», то же поле «Имя файла» с той же
   подсказкой про расширение.

   Перечёркнутая стрелка в конце обязательна: без неё «сохранить в файл»
   читалось бы как «отправить». Это единственное место на странице, где
   сказано о том, чего НЕ происходит.
   ======================================================================== */

export function DemoStorage() {
  return (
    <Panel>
      <div className="w-full max-w-104">
        {/* Шапка приложения: те же четыре кнопки, что стоят там на самом
            деле, и в том же порядке (`header-tools.tsx`). Подписей у них
            нет — ровно как в приложении на телефоне, где ширины на слово
            не хватает; показ здесь той же ширины.

            Полосы под кнопками нет: в приложении шапка прозрачна, а
            поднята каждая кнопка сама по себе. Плашка под ними делала бы
            из четырёх предметов один. */}
        <div className="relative flex items-center justify-end gap-2 pb-4">
          <HeaderButton icon={Settings} label="Настройки" />
          <HeaderButton icon={ChartColumn} label="Статистика" />
          <HeaderButton icon={FolderOpen} label="Открыть" />
          <HeaderButton icon={Save} label="Сохранить" className="demo-save-button" />
          <Pointer className="demo-tap-save right-2 top-6" />
        </div>

        {/* Окно выгрузки — то самое, что открывается по этой кнопке, и
            собрано оно как настоящее (`save-to-file.tsx`): поднятая бумага
            со светом и тенью окна, заголовок прописными и крестик в углу,
            под ними вопрос с полем, а внизу две кнопки. */}
        <div className="demo-dialog lit modal-lift rounded-xl bg-paper-raised">
          <div className="flex items-center gap-3 px-4 pt-3 pb-1">
            <p className="min-w-0 flex-1 font-display text-[0.8em] font-bold uppercase leading-6 tracking-wide">
              Сохранить профиль в файл
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
              <p className="text-[0.7em] leading-snug text-ink-muted">
                Расширение «.json» допишется само. Запрещённые в именах файлов
                знаки заменятся на дефис.
              </p>
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
              в сеть не уходит
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

function HeaderButton({
  icon: Icon,
  label,
  className,
}: {
  icon: typeof Save;
  label: string;
  className?: string;
}) {
  return (
    // Та же кнопка, что в шапке приложения: поднятая бумага, свет по
    // кромке, скругление в четырнадцать точек (`TOOL_BUTTON`). Подпись
    // остаётся программе чтения — на телефоне приложение прячет её так же.
    <span
      className={cn(
        "lit inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-paper-raised",
        className,
      )}
    >
      <Icon aria-hidden className="size-4.5 shrink-0 text-ink-muted" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/* ========================================================================
   5. СТАТИСТИКА ЗА ГОД, И НЕ ТОЛЬКО СВОЯ.

   Четыре показа выше отвечают на вопрос «как внести», а этот — на вопрос
   «что из этого видно». Год разложен по месяцам: столбец — отработано,
   черта поперёк — норма месяца. Тот же рисунок, те же цвета и та же
   черта, что в самой статистике (`statistics.tsx`, `charts.tsx`).

   Нажатие здесь одно и оно главное: человек переводит выбор с себя на
   папку караула, и рисунок пересобирается под весь караул. Это и есть то,
   чего нет ни в одном из четырёх предыдущих показов, — счёт не по одному
   графику, а по всем сразу.
   ======================================================================== */

/**
 * Месяцы рисунка: сколько отработано и какая норма — двумя наборами.
 *
 * Первый — один человек, второй — караул из трёх. Числа долями высоты
 * поля, а не часами: рисунок в показе мелкий, и подписей у оси нет —
 * сравнивают на нём столбец с чертой, а не с числом.
 */
const STAT_MONTHS: { fact: number; norm: number; factTwo: number; normTwo: number }[] = [
  { fact: 78, norm: 52, factTwo: 62, normTwo: 58 },
  { fact: 70, norm: 63, factTwo: 74, normTwo: 66 },
  { fact: 46, norm: 40, factTwo: 88, normTwo: 70 },
  { fact: 72, norm: 71, factTwo: 66, normTwo: 72 },
  { fact: 88, norm: 62, factTwo: 80, normTwo: 64 },
  { fact: 68, norm: 68, factTwo: 92, normTwo: 70 },
  { fact: 30, norm: 27, factTwo: 58, normTwo: 44 },
  { fact: 78, norm: 69, factTwo: 70, normTwo: 68 },
  { fact: 93, norm: 72, factTwo: 84, normTwo: 73 },
  { fact: 78, norm: 72, factTwo: 76, normTwo: 71 },
  { fact: 75, norm: 65, factTwo: 88, normTwo: 67 },
  { fact: 72, norm: 72, factTwo: 60, normTwo: 72 },
];

export function DemoStats() {
  return (
    <Panel className="demo-stats">
      <div className="w-full max-w-104 space-y-3">
        {/* Строка выбора — та же, что стоит над статистикой: поднятое поле
            со знаком того, что выбрано, и горячий ряд рядом с ним. */}
        <div className="relative flex items-center gap-2">
          <span className="lit relative flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl bg-paper-raised px-3 text-[0.8em] font-medium">
            {/* Знак меняется вместе с выбором: человек — у профиля, папка —
                у свода по караулу. Оба лежат в одной ячейке, и смена не
                двигает соседей. */}
            <span className="grid shrink-0 text-ink-muted">
              <User aria-hidden className="demo-stat-was col-start-1 row-start-1 size-4.5" />
              <Folder aria-hidden className="demo-stat-became col-start-1 row-start-1 size-4.5" />
            </span>
            <span className="grid min-w-0 flex-1">
              <span className="demo-stat-was col-start-1 row-start-1 truncate">Петров И. С.</span>
              <span className="demo-stat-became col-start-1 row-start-1 truncate">4-й караул (3)</span>
            </span>
            <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
          </span>

          <span className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-xl bg-paper-sunken">
            <StatChip>Все</StatChip>
            <StatChip picked>4-й караул</StatChip>
          </span>

          <Pointer className="demo-tap-stats right-6 top-7" />
        </div>

        {/* Рисунок. Плашка поднятой бумаги — как у всех разделов
            статистики; сам рисунок без осей и подписей: в показе величиной
            с ладонь они читались бы рябью, а сказать нужно одно — где
            столбец выше своей черты, а где ниже. */}
        <div className="lit rounded-xl bg-paper-raised p-3">
          <p className="font-display text-[0.7em] font-bold uppercase tracking-wide">
            Норма и факт по месяцам
          </p>

          <div className="mt-2 flex h-20 items-end gap-[0.35em] sm:h-24">
            {STAT_MONTHS.map((month, index) => (
              <span
                key={index}
                className="relative flex h-full min-w-0 flex-1 items-end"
                style={vars({
                  "--bar": index,
                  "--h": `${month.fact}%`,
                  "--h2": `${month.factTwo}%`,
                  "--n": `${month.norm}%`,
                  "--n2": `${month.normTwo}%`,
                })}
              >
                <span className="demo-bar block w-full rounded-t-[0.2em] bg-verify" />
                {/* Черта нормы — шире столбца, как в самом рисунке: вровень
                    с ним она сливалась бы с вершиной, когда факт равен
                    норме. */}
                <span className="demo-tick absolute -left-px -right-px h-[0.12em] rounded-full bg-ink-faint" />
              </span>
            ))}
          </div>
        </div>

        {/* Итог — тем же словом и тем же цветом, что в полосе наверху. */}
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-[0.7em] font-bold uppercase tracking-wide text-ink-muted">
            Переработка за год
          </span>
          <span className="grid text-right font-mono text-[1.1em] font-medium text-verify">
            <span className="demo-stat-was col-start-1 row-start-1">+302 ч</span>
            <span className="demo-stat-became col-start-1 row-start-1">+752 ч</span>
          </span>
        </div>
      </div>
    </Panel>
  );
}

/** Кнопка горячего ряда: занятая поднята, свободная утоплена вместе с дорожкой. */
function StatChip({ children, picked }: { children: ReactNode; picked?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center rounded-xl px-2.5 text-[0.7em] font-medium",
        picked
          ? "demo-stat-chip lit bg-paper-raised text-ink"
          : "text-ink-muted",
      )}
    >
      {children}
    </span>
  );
}
