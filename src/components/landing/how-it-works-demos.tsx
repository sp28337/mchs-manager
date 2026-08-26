import type { CSSProperties, ReactNode } from "react";

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
 * Значок при этом не показывал ничего: шесть серых пиктограмм подряд
 * читаются как оформление.
 *
 * Теперь у каждого раздела свой маленький показ — те же клетки, те же
 * цвета и те же буквы, что человек встретит внутри. Текст рядом объясняет,
 * зачем это, а показ отвечает на «как это выглядит».
 *
 * --- Почему разметкой, а не роликом ---------------------------------------
 *
 * По той же причине, по которой месяц первого экрана собран клетками, а не
 * снимком экрана: ролик не следует теме, не читается на узком экране, не
 * масштабируется и весит больше всей страницы. Здесь же всё нарисовано тем
 * же, чем нарисовано приложение, и в тёмной теме перекрашивается само.
 *
 * --- Что здесь общего у всех четырёх --------------------------------------
 *
 * Клетка суток (`Day`) — одна на все показы, и цвета у неё те же, что в
 * легенде расчёта: зелёная смена, бледное продолжение, «В» у свободных
 * суток, красный отпуск, синий вызов. Человек, дошедший до приложения,
 * узнаёт их без подписи.
 *
 * Указатель (`Pointer`) — тоже общий: это единственное, чего в приложении
 * нет, и потому он нарисован намеренно скупо — стрелка и кольцо нажатия.
 *
 * Сама анимация целиком лежит в `globals.css`: разметка отдаёт только
 * НОМЕРА — место клетки в волне, — а расписание и движение описаны там.
 */

/** Цвета клетки — те же, что в легенде расчёта. */
const TONE = {
  /** Начало смены. */
  shift: "border-verify/25 bg-verify/30 text-verify",
  /** Продолжение смены: те же сутки, но часы уже вчерашние. */
  tail: "border-verify/15 bg-verify/5 text-verify",
  /** Свободные сутки. */
  free: "border-transparent text-ink-faint",
  /** Отпуск. */
  leave: "border-dashed border-signal/50 bg-signal-soft text-signal",
  /** Работа помимо графика. */
  callout: "border-trace bg-trace-soft text-trace",
} as const;

type Tone = keyof typeof TONE;

function vars(style: Record<string, number | string>): CSSProperties {
  return style as CSSProperties;
}

/** Во что превращаются сутки и когда. */
interface Becomes {
  date: number;
  mark: string;
  tone: Tone;
  /** Миллисекунды от начала показа. */
  at: number;
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
 * и по контуру всё равно остаётся зелёная дужка в полпикселя. Гашение
 * снимает её вместе со всей клеткой.
 *
 * Срок один на оба слоя и живёт на самой клетке (`--at`): разъедься они —
 * и в кадре окажется либо пустое место, либо два вида суток разом.
 */
function Day({
  date,
  mark,
  tone,
  becomes,
  className,
  style,
}: {
  date: number;
  mark: string;
  tone: Tone;
  /** Во что эти сутки превращаются по ходу показа. */
  becomes?: Becomes;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn("relative", className)}
      style={{ ...style, ...(becomes ? vars({ "--at": becomes.at }) : null) }}
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
            TONE[becomes.tone],
          )}
        >
          <span className="font-mono text-[1em]">{becomes.date}</span>
          <span className="font-mono text-[0.7em]">{becomes.mark}</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * Указатель: стрелка и кольцо нажатия.
 *
 * Нарисован скупо намеренно. В приложении его нет — это единственная
 * деталь показа, которой в жизни не будет, — и подробный курсор с тенью
 * начал бы спорить за внимание с тем, на что он показывает.
 */
function Pointer({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={cn("demo-pointer pointer-events-none absolute", className)} style={style}>
      <span className="demo-pointer__ring absolute -left-3 -top-3 size-9 rounded-full border border-ink/30" />
      <svg viewBox="0 0 24 24" className="size-6 drop-shadow-sm" aria-hidden>
        <path
          d="M5 3l14 8.5-6.2 1.4L9.8 19z"
          className="fill-paper stroke-ink"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** Общая рамка показа: одна пропорция на все четыре, чтобы ряд не прыгал. */
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center",
        // Кегль задаёт размер клеток: они меряются в `em`, как и в расчёте.
        "text-sm sm:text-base lg:text-lg xl:text-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ========================================================================
   1. ГРАФИК И НОРМА — первый разговор с приложением.

   Два ответа, из которых получается всё остальное: какой у человека цикл
   и какая у него неделя. Показано это подменой значения в карточке
   настроек и перестройкой полосы дней под ней.

   Полос две, и обе настоящие. Верхняя — «сутки через трое»: смена
   начинается в восемь утра и длится сутки, поэтому первым суткам
   достаётся шестнадцать часов, вторым восемь, а дальше трое свободных.
   Нижняя — «два через два» с двенадцатичасовой сменой: она не переваливает
   за полночь, и обе рабочие клетки полные.

   Подменить содержимое нечем — страница отдаётся статикой, — поэтому
   полосы лежат друг на друге: верхняя уходит, нижняя собирается волной.
   ======================================================================== */

/** «Сутки через трое»: 16 часов в первых сутках, 8 во вторых, трое свободных. */
const STRIP_ONE_THREE: [date: number, mark: string, tone: Tone][] = [
  [5, "16", "shift"],
  [6, "8", "tail"],
  [7, "В", "free"],
  [8, "В", "free"],
  [9, "16", "shift"],
  [10, "8", "tail"],
  [11, "В", "free"],
  [12, "В", "free"],
];

/** «Два через два» по двенадцать часов: смена в полночь не переваливает. */
const STRIP_TWO_TWO: [date: number, mark: string, tone: Tone][] = [
  [5, "12", "shift"],
  [6, "12", "shift"],
  [7, "В", "free"],
  [8, "В", "free"],
  [9, "12", "shift"],
  [10, "12", "shift"],
  [11, "В", "free"],
  [12, "В", "free"],
];

export function DemoSchedule() {
  return (
    <Panel>
      <div className="w-full max-w-96 space-y-4">
        {/* Карточка настроек: два поля, которые спрашивают при заведении
            профиля. Второе не меняется — оно здесь, чтобы было видно, что
            норма это ОТВЕТ человека, а не что-то, взятое приложением с
            потолка. */}
        <div className="relative space-y-2.5 rounded-xl border border-rule bg-paper-raised p-4">
          <Field label="График">
            {/* Значение перегорает — тем же приёмом, что цифры в названии
                сайта при смене графика: старое истлевает и его сносит, новое
                занимается на его месте. */}
            <span className="relative inline-block">
              <span className="demo-swap-out font-mono">1/3</span>
              <span className="demo-swap-in absolute left-0 top-0 font-mono">2/2</span>
            </span>
          </Field>
          <Field label="Норма в неделю">
            <span className="font-mono">40 часов</span>
          </Field>

          <Pointer className="demo-tap-schedule right-6 top-3.5" />
        </div>

        {/* Две полосы на одном месте: нижняя задаёт размер, верхняя лежит
            поверх и уходит. */}
        <div className="relative">
          <div className="demo-strip-next grid grid-cols-8 gap-1">
            {STRIP_TWO_TWO.map(([date, mark, tone], index) => (
              <Day
                key={date}
                date={date}
                mark={mark}
                tone={tone}
                className="demo-cell-in"
                style={vars({ "--i": index })}
              />
            ))}
          </div>
          <div className="demo-strip-prev absolute inset-0 grid grid-cols-8 gap-1">
            {STRIP_ONE_THREE.map(([date, mark, tone]) => (
              <Day key={date} date={date} mark={mark} tone={tone} />
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-display text-[0.7em] font-bold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <span className="rounded-lg border border-rule-strong bg-paper px-3 py-1 text-[0.9em]">
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

   Переезжает ПАРА суток, а не одна клетка: суточная смена лежит в двух
   календарных днях, и хвост уезжает вместе с началом. Показать переезд
   одной клетки значило бы соврать о том, что человек увидит.
   ======================================================================== */

const MOVE_STRIP: [date: number, mark: string, tone: Tone][] = [
  [11, "В", "free"],
  [12, "16", "shift"],
  [13, "8", "tail"],
  [14, "В", "free"],
  [15, "В", "free"],
  [16, "В", "free"],
  [17, "В", "free"],
];

/** Что становится с каждыми сутками, когда смену донесли. */
const MOVE_AT = 1750;
const MOVE_BECOMES: (Becomes | undefined)[] = [
  undefined,
  { date: 12, mark: "В", tone: "free", at: MOVE_AT },
  { date: 13, mark: "В", tone: "free", at: MOVE_AT },
  undefined,
  undefined,
  { date: 16, mark: "16", tone: "shift", at: MOVE_AT },
  { date: 17, mark: "8", tone: "tail", at: MOVE_AT },
];

export function DemoMove() {
  return (
    <Panel>
      <div className="relative w-full max-w-96">
        <div className="grid grid-cols-7 gap-1">
          {/* Сутки, с которых смену унесли, становятся свободными, а те, на
              которые её положили, — сменой и её продолжением. Переезжает
              ПАРА: суточная смена лежит в двух календарных днях. */}
          {MOVE_STRIP.map(([date, mark, tone], index) => (
            <Day
              key={date}
              date={date}
              mark={mark}
              tone={tone}
              becomes={MOVE_BECOMES[index]}
            />
          ))}
        </div>

        {/* Каретка: несомая смена и указатель едут вместе, одним слоем.
            Порознь их не сдвинуть — проценты в `translate` считаются от
            ширины САМОГО элемента, а не полосы, и клетка шириной в седьмую
            часть уехала бы на седьмую часть клетки. Каретка же во всю
            ширину полосы, и шаг в колонку для неё выражается точно. */}
        <div className="demo-carriage pointer-events-none absolute inset-x-0 top-0">
          {/* Смена, которую несут: та же клетка, только оторванная от сетки
              и приподнятая. Она и есть то, что человек видит под пальцем. */}
          {/* Подложка цвета страницы обязательна: у смены заливка
              полупрозрачная, и без неё сквозь несомую клетку читались бы
              сутки, над которыми её проносят. */}
          <span className="demo-carried absolute left-0 top-0 w-[calc((100%-1.5rem)/7)] rounded-md bg-paper shadow-lg">
            <span
              className={cn(
                "flex aspect-square w-full flex-col items-center justify-center",
                "rounded-md border leading-tight",
                TONE.shift,
              )}
            >
              <span className="font-mono text-[1em]">12</span>
              <span className="font-mono text-[0.7em]">16</span>
            </span>
          </span>

          {/* Указатель стоит посреди несомой клетки — на полколонки правее
              её левого края. */}
          <Pointer className="demo-drag left-[calc((100%-1.5rem)/14)] top-[62%]" />
        </div>
      </div>
    </Panel>
  );
}

/* ========================================================================
   3. ОТПУСКА, БОЛЬНИЧНЫЕ И РАБОТА ПОМИМО ГРАФИКА.

   Два разных вида записи на трёх сутках подряд, и разница между ними — то,
   ради чего приложение написано.

   ВЫЗОВ ставится на сутки, где смена сдаётся: резерв после смены — самый
   обычный случай, и часы за него прибавляются к отработанному, а норму не
   трогают (ст. 54 ФЗ-141, ст. 91 ТК РФ).

   ОТПУСК ставится на свободные сутки, и он, наоборот, уменьшает НОРМУ, а
   не отработанное (письмо Роструда № 550-6-1).
   ======================================================================== */

const EVENT_STRIP: [date: number, mark: string, tone: Tone][] = [
  [5, "16", "shift"],
  [6, "8", "tail"],
  [7, "В", "free"],
  [8, "В", "free"],
];

/**
 * Вызов ставится на сутки сдачи смены, отпуск — на свободные, и они идут
 * по очереди: сперва человек видит, ЧТО отметили, потом — что отметили ещё.
 */
const EVENT_BECOMES: (Becomes | undefined)[] = [
  undefined,
  { date: 6, mark: "РЗ", tone: "callout", at: 600 },
  undefined,
  { date: 8, mark: "О", tone: "leave", at: 1500 },
];

export function DemoEvents() {
  return (
    <Panel>
      <div className="w-full max-w-72">
        <div className="grid grid-cols-4 gap-1">
          {EVENT_STRIP.map(([date, mark, tone], index) => (
            <Day
              key={date}
              date={date}
              mark={mark}
              tone={tone}
              becomes={EVENT_BECOMES[index]}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}

/* ========================================================================
   4. ДАННЫЕ НИКУДА НЕ УХОДЯТ.

   Утверждение это проверяемое, и показать его нужно так же — не замком с
   надписью «безопасно», а тем, что происходит на самом деле: профиль
   лежит в браузере, кнопка кладёт его копию в файл на то же устройство, и
   наружу не уходит ничего.

   Поэтому в показе две части, и вторая обязательна: без неё «сохранить в
   файл» читалось бы как «отправить». Перечёркнутая стрелка вверх —
   единственное место на странице, где сказано о том, чего НЕ происходит.
   ======================================================================== */

export function DemoStorage() {
  return (
    <Panel>
      <div className="w-full max-w-80 space-y-3">
        {/* Наверху — то, чего не происходит. */}
        <div className="flex items-center justify-center gap-2 text-ink-faint">
          <span className="demo-uplink font-display text-[0.7em] font-bold uppercase tracking-wide">
            в сеть не уходит
          </span>
          {/* Стрелка вверх, перечёркнутая. Перечёркивание сделано двумя
              линиями: под красной идёт линия цвета страницы вчетверо толще
              — она вырезает в стрелке просвет, и черта читается ЧЕРТОЙ, а
              не второй линией поверх. Без просвета в мелком размере всё
              сливалось в красную кляксу. */}
          <svg viewBox="0 0 24 24" className="demo-uplink size-8" aria-hidden fill="none">
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
        </div>

        {/* Устройство: всё, что ниже этой рамки, остаётся у человека. */}
        <div className="relative space-y-3 rounded-xl border border-rule bg-paper-raised p-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-rule-strong bg-paper px-3 py-2">
            <span className="text-[0.85em]">Профиль и смены</span>
            <span className="font-mono text-[0.75em] text-ink-muted">в браузере</span>
          </div>

          <span className="demo-save inline-flex items-center rounded-xl bg-ink px-3 py-1.5 text-[0.8em] font-medium text-paper">
            Сохранить
          </span>

          {/* Файл выпадает из кнопки и остаётся здесь же, под ней. */}
          <div className="demo-file flex items-center gap-2 rounded-lg border border-dashed border-rule-strong px-3 py-2">
            <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-ink-muted" aria-hidden fill="none">
              <path
                d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-mono text-[0.75em] text-ink-muted">график.json</span>
          </div>

          <Pointer className="demo-tap-save bottom-16 left-20" />
        </div>
      </div>
    </Panel>
  );
}
