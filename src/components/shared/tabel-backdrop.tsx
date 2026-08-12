/**
 * Табель, который чертится и заполняется на фоне первого экрана.
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
 * Четыре действия, и порядок у них тот же, что у настоящего бланка: сначала
 * его чертят (контур, сетка, гребёнка дней), потом подписывают столбцы, и
 * только потом заполняют. Заполнение — отдельная фаза после того, как
 * таблица построена: сначала документ, потом записи в нём.
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
 * только `stroke-dashoffset` и `opacity`.
 *
 * --- Почему это не мешает ------------------------------------------------
 *
 * Слой абсолютный, не влияет на поток и обрезается правым краем окна (за
 * это отвечает `overflow-x: clip` на `body`), поэтому не сдвигает ничего и
 * не создаёт горизонтальной прокрутки. `aria-hidden` и `pointer-events:
 * none` — он декоративен и не должен ни попадать в озвучку, ни ловить
 * щелчки. Прозрачность держится в переменных темы: на тёмном фоне тонкая
 * линия при той же альфе читается слабее, и значения там другие.
 */

/* Геометрия. Числа — координаты в системе `viewBox`, а не пиксели экрана:
   слой масштабируется целиком, и подгонять их под ширину окна не нужно.

   Правая граница таблицы совпадает с краем `viewBox`: слой доводится до
   края окна, и документ должен упираться в него, а не заканчиваться
   раньше с пустым полем справа. */
const VIEW = { w: 980, h: 620 };
const TABLE = { x0: 40, x1: 979, y0: 120, y1: 560 };

/** Низ первой полосы шапки и низ шапки целиком. */
const HEAD = { band: 176, bottom: 224 };

/**
 * Границы столбцов.
 *
 * Порядок повторяет форму: кто → когда → сколько → сверх нормы → подпись.
 * Он же — порядок спора: разговор всегда упирается в предпоследний столбец.
 */
const COLS = {
  num: 92,
  name: 300,
  days: 620,
  split: 700,
  total: 780,
  over: 880,
};

/** Вертикали во всю высоту таблицы. */
const VERTICALS: readonly number[] = [
  COLS.num,
  COLS.name,
  COLS.days,
  COLS.total,
  COLS.over,
];

/** Строки под записи. */
const HORIZONTALS: readonly number[] = [
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
 * Разделитель полос шапки — отрезками, а не сплошной линией.
 *
 * Он проходит только там, где столбец действительно делится надвое: под
 * «числами месяца» и под «отработано». Через «Ф.И.О.» или «Сверх нормы»
 * линии в бланке нет — там одна объединённая клетка, и подпись стоит по
 * центру всей шапки. Сплошная линия перечеркнула бы эти подписи ровно
 * посередине.
 */
const BANDS: readonly { x0: number; x1: number }[] = [
  { x0: COLS.name, x1: COLS.days },
  { x0: COLS.days, x1: COLS.total },
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

/** Середина столбца дня — по ней выравниваются и число, и отметка. */
const dayCenter = (day: number) => COLS.name + (day - 1) * DAY_COLUMN + DAY_COLUMN / 2;

/** Подписи полей над таблицей: «Подразделение ____ Месяц ____ Год ____». */
const FIELDS: readonly { label: string; x: number; lineFrom: number; lineTo: number }[] = [
  { label: "Подразделение", x: 40, lineFrom: 136, lineTo: 330 },
  { label: "Месяц", x: 360, lineFrom: 402, lineTo: 520 },
  { label: "Год", x: 560, lineFrom: 590, lineTo: 700 },
];

/**
 * Заголовки столбцов.
 *
 * Текст настоящий: узнаётся именно форма, а не абстрактная сетка. Подписи
 * объединённых клеток стоят по центру всей шапки (`y` 177), подписи
 * нижнего яруса — по центру своей полосы (`y` 204).
 */
const CAPTIONS: readonly { text: string; x: number; y: number; size: number }[] = [
  { text: "№", x: 66, y: 177, size: 13 },
  { text: "Ф.И.О., звание, должность", x: 196, y: 177, size: 13 },
  { text: "Числа месяца", x: 460, y: 153, size: 12 },
  { text: "Отработано, ч", x: 700, y: 153, size: 12 },
  { text: "всего", x: 660, y: 204, size: 10 },
  { text: "ночных", x: 740, y: 204, size: 10 },
  { text: "Сверх нормы", x: 830, y: 177, size: 11 },
  { text: "Подпись", x: (COLS.over + TABLE.x1) / 2, y: 177, size: 11 },
];

/** Числа в шапке столбцов дней. */
const DAY_MARKS: readonly number[] = Array.from({ length: DAY_COUNT }, (_, i) => i + 1);

/** Середины строк с записями. */
const ROWS: readonly number[] = [245, 287, 329, 371];

/**
 * Записи в табеле.
 *
 * Четыре караула, сутки через трое: у первого смены 1, 5, 9, 13-го, у
 * второго — 2, 6, 10, 14-го и так далее. Отсюда и остальные числа, а не
 * из головы: четыре суточных смены — это 96 часов, и в каждой ровно 8
 * ночных (окно 22:00—06:00 целиком внутри суток), значит 32.
 *
 * Столбец «Сверх нормы» пуст намеренно. Он и есть предмет разговора: в
 * выданном табеле там чаще всего либо пусто, либо не то. Заполнять его
 * здесь — значит ответить за человека на вопрос, ради которого он пришёл.
 *
 * Фамилии — общепринятые для образцов бланков. Ничьих настоящих данных на
 * фоне сайта, который обещает не собирать данные, быть не может.
 */
const GUARDS: readonly { name: string; firstShift: number }[] = [
  { name: "Иванов А. А., ком. отделения", firstShift: 1 },
  { name: "Петров С. В., пожарный", firstShift: 2 },
  { name: "Сидоров Н. П., водитель", firstShift: 3 },
  { name: "Кузнецов Д. И., пожарный", firstShift: 4 },
];

const SHIFT_HOURS = 24;
/** Окно 22:00—06:00 целиком помещается внутри суточной смены. */
const NIGHT_HOURS_PER_SHIFT = 8;
const CYCLE = 4;

/** Смены караула в пределах показанных суток. */
const shiftsOf = (firstShift: number) =>
  Array.from({ length: DAY_COUNT / CYCLE }, (_, index) => firstShift + index * CYCLE).filter(
    (day) => day <= DAY_COUNT,
  );

/** Шаг между соседними элементами одной фазы, в секундах. */
const STEP = { line: 0.06, row: 0.05, tick: 0.022, text: 0.06, day: 0.015 };

/** Заполнение: строка за строкой, внутри строки — слева направо. */
const FILL = { row: 0.22, cell: 0.03 };

/** Начало фаз. Они намеренно перекрываются: рисунок должен собираться, а
 *  не распадаться на отдельные вспышки. Заполнение — единственная фаза,
 *  которая начинается после предыдущей, а не внахлёст: сначала документ,
 *  потом записи в нём. */
const PHASE = {
  frame: 0.25,
  grid: 0.85,
  rows: 1.05,
  ticks: 1.25,
  text: 1.5,
  fill: 2.6,
};

const delay = (seconds: number) => ({ "--d": `${seconds.toFixed(3)}s` }) as React.CSSProperties;

/** Задержка ячейки: строка за строкой, внутри строки — по порядку. */
const fillDelay = (row: number, cell: number) =>
  delay(PHASE.fill + row * FILL.row + cell * FILL.cell);

export function TabelBackdrop() {
  return (
    <div
      aria-hidden
      // Ниже `sm` слоя нет вовсе: на узком экране за текстом не остаётся
      // места, где документ не мешал бы его читать, а портить главное ради
      // фона нельзя.
      //
      // `right: calc(50% - 51vw)` — правый край окна и ещё немного за него.
      // Секция центрирована, поэтому её середина совпадает с серединой
      // окна, и отсчёт от 50% выводит слой из колонки `main` наружу.
      // Лишнее срезает `overflow-x: clip` на `body`: документ уходит за
      // край экрана, а полосы прокрутки от этого не появляется.
      className="tabel-backdrop pointer-events-none absolute inset-y-0 right-[calc(50%-51vw)] z-0 hidden w-[92vw] select-none text-ink sm:block lg:w-[74vw]"
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

          {BANDS.map((band, index) => (
            <path
              key={`b${band.x0}`}
              pathLength={1}
              style={delay(PHASE.grid + (VERTICALS.length + index) * STEP.line)}
              className="tabel-draw"
              d={`M${band.x0} ${HEAD.band} H${band.x1}`}
            />
          ))}

          {/* Столбец «всего/ночных» делится только ниже первой полосы. */}
          <path
            pathLength={1}
            style={delay(PHASE.grid + (VERTICALS.length + BANDS.length) * STEP.line)}
            className="tabel-draw"
            d={`M${COLS.split} ${HEAD.band} V${TABLE.y1}`}
          />

          {/* Гребёнка дней идёт быстрым росчерком: пятнадцать отдельных
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
              x={dayCenter(day)}
              y={203}
              textAnchor="middle"
              fontSize={9}
              style={delay(PHASE.text + (5 + CAPTIONS.length) * STEP.text + index * STEP.day)}
              className="tabel-fade tabel-caption"
            >
              {day}
            </text>
          ))}
        </g>

        {/* Записи — последним действием: документ сначала чертят и
            подписывают, и только потом в нём появляются отметки. */}
        <g className="tabel-data" fill="currentColor">
          {GUARDS.map((guard, row) => {
            const y = ROWS[row] ?? 0;
            const shifts = shiftsOf(guard.firstShift);

            return (
              <g key={guard.name}>
                <text
                  x={(TABLE.x0 + COLS.num) / 2}
                  y={y + 4}
                  textAnchor="middle"
                  fontSize={11}
                  style={fillDelay(row, 0)}
                  className="tabel-fade"
                >
                  {row + 1}
                </text>

                <text
                  x={COLS.num + 14}
                  y={y + 4}
                  fontSize={11}
                  style={fillDelay(row, 1)}
                  className="tabel-fade"
                >
                  {guard.name}
                </text>

                {shifts.map((day, index) => (
                  <text
                    key={day}
                    x={dayCenter(day)}
                    y={y + 3}
                    textAnchor="middle"
                    fontSize={9}
                    style={fillDelay(row, 2 + index)}
                    className="tabel-fade"
                  >
                    {SHIFT_HOURS}
                  </text>
                ))}

                <text
                  x={(COLS.days + COLS.split) / 2}
                  y={y + 4}
                  textAnchor="middle"
                  fontSize={11}
                  style={fillDelay(row, 2 + shifts.length)}
                  className="tabel-fade"
                >
                  {shifts.length * SHIFT_HOURS}
                </text>

                <text
                  x={(COLS.split + COLS.total) / 2}
                  y={y + 4}
                  textAnchor="middle"
                  fontSize={11}
                  style={fillDelay(row, 3 + shifts.length)}
                  className="tabel-fade"
                >
                  {shifts.length * NIGHT_HOURS_PER_SHIFT}
                </text>
              </g>
            );
          })}
        </g>

        {/* Подписи от руки — единственное, что в заполненном табеле не
            печатают. Поэтому они не проступают, а дописываются штрихом. */}
        <g
          className="tabel-data"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          fill="none"
        >
          {GUARDS.map((guard, row) => {
            const y = ROWS[row] ?? 0;

            return (
              <path
                key={guard.name}
                pathLength={1}
                style={fillDelay(row, 6 + DAY_COUNT / CYCLE)}
                className="tabel-draw"
                d={`M${COLS.over + 16} ${y + 5} c5 -11 9 6 14 -4 s7 -8 12 1 s7 5 12 -3`}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
