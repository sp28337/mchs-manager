/**
 * Табель, который чертится на фоне первого экрана.
 *
 * --- Что это и почему именно табель --------------------------------------
 *
 * Форма учёта служебного времени сотрудников ФПС — тот самый документ, из-за
 * ошибок в котором сайт и существует. Фон не «украшает первый экран», а
 * называет предмет разговора раньше, чем человек дочитает заголовок.
 *
 * --- Почему рисуется, а не появляется ------------------------------------
 *
 * Готовая картинка читается как иллюстрация — что-то, что положили сверху.
 * Линия, которую ведут, читается как документ, который заполняют: это ровно
 * то действие, о котором страница. Поэтому рисование, а не `opacity: 1`.
 *
 * --- Как это сделано без единой строки JS --------------------------------
 *
 * Каждому пути задан `pathLength="1"`. Атрибут нормирует длину ЛЮБОГО пути
 * к единице, поэтому `stroke-dasharray: 1` и `stroke-dashoffset: 1 → 0`
 * рисуют его целиком, не зная настоящей длины. Без него пришлось бы мерить
 * пути в браузере через `getTotalLength()` — то есть тащить сюда эффект,
 * гидратацию и мигание неотрисованной графики до его выполнения.
 *
 * Задержка каждого элемента — инлайновая переменная `--d`. Анимируются
 * только `stroke-dashoffset`, `opacity` и `transform`.
 *
 * --- Почему это не мешает ------------------------------------------------
 *
 * Слой абсолютный и обрезается границами секции, поэтому не сдвигает ничего
 * и не создаёт горизонтальной прокрутки. `aria-hidden` и `pointer-events:
 * none` — он декоративен и не должен ни попадать в озвучку, ни ловить
 * щелчки. Прозрачность держится в переменных темы: на тёмном фоне тонкая
 * линия при той же альфе читается слабее, и значения там другие.
 */

/* Геометрия. Числа — координаты в системе `viewBox`, а не пиксели экрана:
   слой масштабируется целиком, и подгонять их под ширину окна не нужно. */
const VIEW = { w: 1000, h: 620 };
const TABLE = { x0: 40, x1: 960, y0: 120, y1: 560 };

/** Низ первой полосы шапки и низ шапки целиком. */
const HEAD = { band: 176, bottom: 224 };

/**
 * Границы столбцов.
 *
 * Порядок повторяет форму: кто → когда → сколько → сверх нормы → подпись.
 * Он же — порядок спора: разговор всегда упирается в предпоследний столбец.
 */
const COLS = { num: 92, name: 300, days: 620, split: 700, total: 780, over: 880 };

/** Вертикали во всю высоту таблицы. */
const VERTICALS: readonly number[] = [
  COLS.num,
  COLS.name,
  COLS.days,
  COLS.total,
  COLS.over,
];

/** Горизонтали: две полосы шапки и строки под записи. */
const HORIZONTALS: readonly number[] = [
  HEAD.band,
  HEAD.bottom,
  266,
  308,
  350,
  392,
  434,
  476,
  518,
];

/**
 * Узкие столбцы под числа месяца.
 *
 * Именно они делают табель табелем: гребёнка из полутора десятков клеток в
 * строку не встречается больше нигде в делопроизводстве.
 */
const DAY_COLUMN = 20;
const DAY_COUNT = 16;
const DAY_TICKS: readonly number[] = Array.from(
  { length: DAY_COUNT - 1 },
  (_, index) => COLS.name + (index + 1) * DAY_COLUMN,
);

/** Подписи полей над таблицей: «Подразделение ____ Месяц ____ Год ____». */
const FIELDS: readonly { label: string; x: number; lineFrom: number; lineTo: number }[] = [
  { label: "Подразделение", x: 40, lineFrom: 136, lineTo: 330 },
  { label: "Месяц", x: 360, lineFrom: 402, lineTo: 520 },
  { label: "Год", x: 560, lineFrom: 590, lineTo: 700 },
];

/**
 * Заголовки столбцов.
 *
 * Текст настоящий: узнаётся именно форма, а не абстрактная сетка. Ширина
 * каждой подписи проверена по её столбцу — подпись, вылезшая в соседнюю
 * клетку, читается как брак вёрстки, а не как документ.
 */
const CAPTIONS: readonly { text: string; x: number; y: number; size: number }[] = [
  { text: "№", x: 66, y: 178, size: 13 },
  { text: "Ф.И.О., звание, должность", x: 196, y: 178, size: 13 },
  { text: "Числа месяца", x: 460, y: 156, size: 12 },
  { text: "Отработано, ч", x: 700, y: 156, size: 12 },
  { text: "всего", x: 660, y: 206, size: 10 },
  { text: "ночных", x: 740, y: 206, size: 10 },
  { text: "Сверх нормы", x: 830, y: 178, size: 11 },
  { text: "Подпись", x: 920, y: 178, size: 11 },
];

/** Числа в шапке столбцов дней. */
const DAY_MARKS: readonly number[] = Array.from({ length: DAY_COUNT }, (_, i) => i + 1);

/**
 * Штрихи вместо данных в ячейках.
 *
 * Настоящих цифр здесь быть не должно: фон, в котором можно прочитать
 * чью-то норму, — это уже утверждение, а не украшение. Смены расставлены
 * через три клетки — тот самый график, ради которого всё написано.
 */
const ROWS: readonly number[] = [245, 287, 329, 371, 413, 455, 497, 539];

/** Столбец штрихов: ширина на строку, ноль — пустая клетка. */
const column = (x: number, widths: readonly number[]) =>
  ROWS.flatMap((y, row) => {
    const w = widths[row];
    return w ? [{ x, y, w }] : [];
  });

const STROKES: readonly { x: number; y: number; w: number }[] = [
  // Смены: в каждой следующей строке караул сдвинут на сутки — те самые
  // «сутки через трое», ради которых всё написано.
  ...ROWS.slice(0, 4).flatMap((y, guard) =>
    Array.from({ length: 4 }, (_, cycle) => ({
      x: COLS.name + (guard + cycle * 4) * DAY_COLUMN + 5,
      y,
      w: 10,
    })),
  ),
  ...column(106, [148, 122, 166, 134, 152]),
  ...column(636, [40, 34, 40, 28]),
  ...column(716, [30, 24, 30]),
  ...column(800, [44, 0, 36]),
];

/** Шаг между соседними элементами одной фазы, в секундах. */
const STEP = { line: 0.06, row: 0.05, tick: 0.022, text: 0.06, stroke: 0.024 };

/** Начало фаз. Они намеренно перекрываются: рисунок должен собираться, а
 *  не распадаться на отдельные вспышки. */
const PHASE = { frame: 0.25, grid: 0.85, rows: 1.05, ticks: 1.25, text: 1.5, strokes: 2.35 };

const delay = (seconds: number) => ({ "--d": `${seconds.toFixed(3)}s` }) as React.CSSProperties;

export function TabelBackdrop() {
  return (
    <div
      aria-hidden
      // Ниже `sm` слоя нет вовсе: на узком экране за текстом не остаётся
      // места, где документ не мешал бы его читать, а портить главное ради
      // фона нельзя.
      className="tabel-backdrop pointer-events-none absolute inset-y-0 right-[-14%] z-0 hidden w-[122%] select-none text-ink sm:block lg:right-[-8%] lg:w-[86%]"
    >
      <svg
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
        className="size-full"
        fill="none"
      >
        <g
          className="tabel-lines"
          stroke="currentColor"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        >
          {/* Внешний контур — один непрерывный путь: перо обходит рамку, а
              не выкладывает её из четырёх отрезков. */}
          <path
            pathLength={1}
            style={delay(PHASE.frame)}
            className="tabel-draw tabel-frame"
            d={`M${TABLE.x0} ${TABLE.y0} H${TABLE.x1} V${TABLE.y1} H${TABLE.x0} Z`}
          />

          {VERTICALS.map((x, index) => (
            <path
              key={`v${x}`}
              pathLength={1}
              style={delay(PHASE.grid + index * STEP.line)}
              className="tabel-draw"
              d={`M${x} ${TABLE.y0} V${TABLE.y1}`}
            />
          ))}

          {HORIZONTALS.map((y, index) => (
            <path
              key={`h${y}`}
              pathLength={1}
              style={delay(PHASE.rows + index * STEP.row)}
              className="tabel-draw"
              d={`M${TABLE.x0} ${y} H${TABLE.x1}`}
            />
          ))}

          {/* Столбец «всего/ночных» делится только ниже первой полосы. */}
          <path
            pathLength={1}
            style={delay(PHASE.grid + VERTICALS.length * STEP.line)}
            className="tabel-draw"
            d={`M${COLS.split} ${HEAD.band} V${TABLE.y1}`}
          />

          {/* Гребёнка дней идёт быстрым росчерком: шестнадцать отдельных
              линий с обычным шагом растянули бы фазу вдвое. */}
          {DAY_TICKS.map((x, index) => (
            <path
              key={`d${x}`}
              pathLength={1}
              style={delay(PHASE.ticks + index * STEP.tick)}
              className="tabel-draw"
              d={`M${x} ${HEAD.band} V${TABLE.y1}`}
            />
          ))}

          {FIELDS.map((field, index) => (
            <path
              key={field.label}
              pathLength={1}
              style={delay(PHASE.grid + index * STEP.line)}
              className="tabel-draw"
              d={`M${field.lineFrom} 104 H${field.lineTo}`}
            />
          ))}
        </g>

        <g className="tabel-ink" fill="currentColor">
          <text
            x={VIEW.w / 2}
            y={46}
            textAnchor="middle"
            style={delay(PHASE.text)}
            className="tabel-fade tabel-title"
          >
            ТАБЕЛЬ
          </text>
          <text
            x={VIEW.w / 2}
            y={70}
            textAnchor="middle"
            style={delay(PHASE.text + STEP.text)}
            className="tabel-fade tabel-subtitle"
          >
            учёта служебного времени сотрудников федеральной противопожарной службы
          </text>

          {FIELDS.map((field, index) => (
            <text
              key={field.label}
              x={field.x}
              y={100}
              style={delay(PHASE.text + (2 + index) * STEP.text)}
              className="tabel-fade tabel-field"
            >
              {field.label}
            </text>
          ))}

          {CAPTIONS.map((caption, index) => (
            <text
              key={caption.text}
              x={caption.x}
              y={caption.y}
              textAnchor="middle"
              fontSize={caption.size}
              style={delay(PHASE.text + (5 + index) * STEP.text)}
              className="tabel-fade tabel-caption"
            >
              {caption.text}
            </text>
          ))}

          {DAY_MARKS.map((day, index) => (
            <text
              key={day}
              x={COLS.name + index * DAY_COLUMN + DAY_COLUMN / 2}
              y={207}
              textAnchor="middle"
              fontSize={9}
              style={delay(PHASE.text + (5 + CAPTIONS.length) * STEP.text + index * STEP.tick)}
              className="tabel-fade tabel-caption"
            >
              {day}
            </text>
          ))}
        </g>

        {/* Штрихи вместо записей — последними и самыми бледными: документ
            заполняется уже после того, как вычерчен. */}
        <g stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="tabel-data">
          {STROKES.map((stroke, index) => (
            <path
              key={`${stroke.x}-${stroke.y}`}
              pathLength={1}
              style={delay(PHASE.strokes + index * STEP.stroke)}
              className="tabel-draw"
              d={`M${stroke.x} ${stroke.y} h${stroke.w}`}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

/**
 * Флаг «этот табель уже чертился в этой вкладке».
 *
 * Скрипт блокирующий и стоит до разметки намеренно: он обязан выставить
 * признак ДО первой отрисовки, иначе человек успеет увидеть начало
 * анимации, которую мы решили не проигрывать. Тот же приём, что у
 * переключателя тем.
 *
 * Именно `sessionStorage`, а не `localStorage`: возвращаясь на страницу
 * через неделю, увидеть, как документ чертится, приятно. Видеть это
 * четвёртый раз за пять минут, ходя туда-сюда с калькулятора, —
 * навязчиво.
 */
export function TabelBackdropSeenScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html:
          'try{if(sessionStorage.getItem("tabel-seen")){document.documentElement.dataset.tabelSeen="1"}else{sessionStorage.setItem("tabel-seen","1")}}catch(e){}',
      }}
    />
  );
}
