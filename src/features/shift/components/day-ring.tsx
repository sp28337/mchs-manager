"use client";

import { Check, Pencil, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils/cn";

import { formatDayMonthRu } from "../domain/format";
import type { IsoDate } from "../domain/plain-date";
import { statutoryCalendar } from "../domain/production-calendar";
import {
  shiftOn,
  withAbsenceToggled,
  withAbsenceUntil,
  withCalloutToggled,
  withCalloutUntil,
  withDayTypeAt,
  withNoteAt,
  withShiftAt,
} from "../model/derive";
import {
  ABSENCE_LABELS,
  CALLOUT_LABELS,
  DAY_TYPE_LABELS,
  DAY_TYPE_MARK,
  DAY_TYPE_TONE,
  type AbsenceKind,
  type CalloutKind,
  type DayType,
} from "../schemas";
import type { StoredProfile } from "../storage/profile";
import {
  ABSENCE_MARK,
  ABSENCE_TONE,
  CALLOUT_MARK,
  CALLOUT_TONE,
  DAY_OFF_MARK,
  DAY_OFF_TONE,
  SHIFT_TONE,
} from "./day-marks";
import {
  DEFAULT_CALLOUT_HOURS,
  NoteModal,
  SpanModal,
} from "./day-event-modal";

/**
 * Перечень видов у клетки: чем эти сутки были на самом деле.
 *
 * Файл и компонент по-прежнему называются кольцом (`DayRing`): так они
 * звались, пока виды стояли кругом вокруг дня, и так их знают остальные
 * файлы. Сейчас это перечень.
 *
 * --- Почему у клетки, а не окном над ней ------------------------------------
 *
 * Прежде нажатие по дню открывало окно во весь экран: список из двенадцати
 * видов с флажками, поля времени, вторая дата. Обычная правка короткая —
 * «здесь был больничный», — и ради неё человек уходил с сетки, терял из
 * виду месяц и возвращался, чтобы взглядом искать следующий день.
 *
 * Теперь клетка остаётся на месте и на виду, а перечень раскрывается рядом
 * с ней. Отметка ложится в клетку тут же, у человека на глазах, и
 * подтверждать её нечем и незачем.
 *
 * --- Почему перечнем, а не кольцом -----------------------------------------
 *
 * Виды стояли кругом вокруг дня — квадратами с одной буквой, а рядом
 * отдельным столбцом висела легенда: что значат эти буквы. Глаз ходил
 * между ними туда и обратно: в кольце нажимают, в легенде читают. Перечень
 * сводит их в одно: знак и сразу за ним название, как в легенде, — и
 * нажимают по самой строке. Легенда у кольца при этом ушла: ей больше
 * нечего пояснять.
 *
 * Стоит перечень сбоку от дня, если там есть место на столбец, а нет —
 * под днём или над ним, в два столбца, если в один не помещается
 * (`placeList`). День он не закрывает никогда.
 *
 * --- Что в перечне и почему именно это --------------------------------------
 *
 * На графике смен: шесть причин, по которым смены не было (отпуск, доп.
 * отпуск, учебный, командировка, больничный, отгул), вызов,
 * смена-или-выходной и заметка. Это всё, что человек отмечает изо дня в
 * день. Пять остальных видов вызова — соревнования, сбор, резерв,
 * праздник, выборы — редки, требуют часов и встречаются только в прежних
 * профилях.
 *
 * На производственном календаре вопрос другой — каким этот день считается
 * по закону, — и ответов на него ровно четыре: рабочий, предпраздничный,
 * праздничный, выходной. Плюс заметка: она к виду дня не относится, но
 * нужна на обеих сетках одинаково.
 *
 * --- Почему в строке смены стоит ПРОТИВОПОЛОЖНОЕ ----------------------------
 *
 * Остальные строки — отметки: нажал, и в сутках появилось то, чего не
 * было. Эта не отмечает ничего нового, она правит сам график, и у неё есть
 * только два значения: смена или выходной. Показывать в ней то, что и так
 * стоит в клетке, значило бы предлагать нажать на «уже так»; поэтому она
 * называет второе — «Сделать выходным» на рабочем дне, «Поставить смену» на
 * выходном. Нажатие делает ровно то, что в ней написано.
 *
 * --- Почему знак выглядит ровно так, как выглядел бы день -------------------
 *
 * Человек нажимает в перечне на то, что потом будет смотреть в клетке, и
 * если «больничный» в перечне и «больничный» на сетке — два разных оттенка,
 * он учит два языка вместо одного. Поэтому цвет, рамка и буква знака
 * берутся из общего словаря (`day-marks.ts`, `DAY_TYPE_TONE`) — те же,
 * какими вид суток нарисован в клетке.
 *
 * --- Почему размытое нельзя нажать -------------------------------------------
 *
 * Сетка вокруг дня размывается: пока перечень открыт, разговор идёт об
 * одном дне. Значит, и нажиматься она не должна — размытое ловит нажатие
 * само и не пропускает его дальше: перечень закрывается, а соседний день
 * под пальцем не срабатывает.
 *
 * Размывается именно сетка, а не вся страница: шапка, полоса цифр и нижний
 * ряд знаков остаются чёткими и живыми — в полосе видно, что стало с
 * нормой после отметки (`Scrim`).
 *
 * --- Почему перечень уходит сразу после выбора -------------------------------
 *
 * Выбор один, и после него разговор окончен: отметка уже в клетке, смотреть
 * на неё надо на сетке, а не сквозь размытие.
 *
 * У того, что ДЛИТСЯ (отпуска, больничный, вызов), следом открывается окно
 * срока, и перечня за ним уже нет. То же с заметкой: ей нужна строка
 * ввода.
 */

/**
 * Знак заметки в перечне — обычная клетка с уголком.
 *
 * На сетке заметку показывает не цвет, а маленький треугольник в углу
 * клетки: цвет там занят видом суток. В перечне занимать нечего, и всё
 * равно уголок остаётся — по нему заметку и узнают, когда она уже стоит.
 */
const RING_NOTE_TONE = "border-rule bg-paper-raised text-ink-muted";

/**
 * Знак заметки — тот же, что в показе на главной: ✎ (U+270E).
 *
 * Был значок из набора `lucide` — карандаш, нарисованный линиями той же
 * толщины, что значки шапки. Среди видов он оказывался единственной
 * КАРТИНКОЙ среди семи букв: у всех соседей знак нарисован шрифтом, и
 * тонкие линии значка среди них читались как значок кнопки, а не как вид
 * суток.
 *
 * Знак из шрифта берёт кегль, начертание и цвет у своей клетки сам —
 * ровно как «О» или «Р», — и в показе на главной, где всё нарисовано
 * буквами, стоит он же. Два места, где человек видит этот выбор, теперь
 * показывают заметку одинаково.
 */
const NOTE_MARK = "\u270e";

/** Как выглядит и называется один вид суток в перечне. */
interface Face {
  mark: ReactNode;
  tone: string;
  label: string;
  /**
   * Короткое имя для строки перечня.
   *
   * Подпись самой кнопки для программы чтения остаётся полной: «Заметка»
   * без продолжения там ничего не говорит. А в строке длинное название на
   * узком экране обрывалось бы многоточием.
   */
  short?: string;
  /** Уголок заметки: цвет у знака занят видом суток, как и в клетке. */
  corner?: boolean;
}

/** С какой сетки открыт перечень — от этого зависит, о чём он спрашивает. */
export type DayRingKind = "shifts" | "calendar";

type Slot =
  | { kind: "absence"; absence: AbsenceKind }
  | { kind: "callout"; callout: CalloutKind }
  | { kind: "shift" }
  | { kind: "dayType"; type: DayType }
  | { kind: "note" };

/**
 * Девять видов графика в порядке чтения — сверху вниз.
 *
 * Сперва идут причины, по которым смены не было, — от самой частой и
 * самой «своей» к самой редкой: отпуск, дополнительный, учебный,
 * командировка, больничный. Следом то, что к ним не относится: работа
 * помимо графика, сам график и заметка. Заметка — дальше всех от
 * отпусков: она ничего не меняет в расчёте, это память о дне, а не его
 * вид.
 *
 * Место в перечне считает `placeList`.
 */
const SHIFT_RING: readonly Slot[] = [
  { kind: "absence", absence: "annual_leave" },
  { kind: "absence", absence: "extra_leave" },
  { kind: "absence", absence: "study_leave" },
  // Командировка — рядом с отпусками, хотя человек в ней работает: перечень
  // отвечает на вопрос «почему своей смены не было», и у неё ответ той же
  // семьи. Чем она отличается от отпуска, сказано в расчёте
  // (`domain/value-objects.ts`), а не в порядке строк.
  { kind: "absence", absence: "business_trip" },
  { kind: "absence", absence: "sick_leave" },
  { kind: "callout", callout: "callout" },
  { kind: "shift" },
  { kind: "note" },
  // Отгул — последним, хотя по смыслу он у отпусков и больничного.
  // -------------------------------------------------------------------
  // Он единственный, кого в перечне иногда нет: отгул берут ВМЕСТО смены,
  // и на свободных по графику сутках отмечать им нечего. Последним — чтобы
  // его отсутствие не сдвигало остальные строки: рука помнит, где
  // «больничный», и помнит одинаково на любом дне.
  { kind: "absence", absence: "time_off_in_lieu" },
];

/** Четыре вида дня по закону и заметка — перечень производственного календаря. */
const CALENDAR_RING: readonly Slot[] = [
  { kind: "dayType", type: "working" },
  { kind: "dayType", type: "pre_holiday" },
  { kind: "dayType", type: "holiday" },
  { kind: "dayType", type: "weekend" },
  { kind: "note" },
];

/** Поле до кромки окна: перечень не упирается в край. */
const SCREEN_EDGE = 8;

/** Просвет между днём и перечнем. */
const LIST_GAP = 8;

/** Строка перечня: знак и название, с полями — по высоте пальца. */
const ROW = 40;

/** Просвет между строками (`gap-0.5`). */
const ROW_GAP = 2;

/** Поля плашки перечня (`p-1.5`). */
const PAD = 6;

/** Ширина перечня в один столбец: самое длинное название целиком. */
const ONE_COLUMN = 232;

/** Ширина столбца, когда их два, — на телефоне, где высоты не хватило. */
const HALF_COLUMN = 176;

/** Запас высоты под заметку дня внизу перечня: до трёх строк текста. */
const NOTE_ROOM = 64;

/** Где и в сколько столбцов встанет перечень видов. */
interface ListPlace {
  style: CSSProperties;
  columns: 1 | 2;
}

/**
 * Куда положить перечень видов, чтобы он не закрыл день.
 *
 * Сбоку от дня — если сбоку есть место на столбец: так перечень не спорит
 * с днём ни за одну строку, и глаз идёт от дня вправо (или влево) прямо к
 * названиям. Сторона — та, где места больше: у дня в январе правая, у дня
 * в декабре левая. По высоте перечень встаёт серединой против дня, а у
 * края окна прижимается к нему.
 *
 * Сбоку места нет (телефон: день посередине, по сторонам по полторы сотни
 * точек) — значит под днём или над ним, где места больше, и по оси дня. Не
 * помещается столбцом — встаёт в два, как вставала легенда у кольца. Не
 * помещается и в два — прокручивается внутри себя: закрывать день он не
 * должен ни при какой высоте.
 *
 * По высоте перечень держится в пределах видимой части сетки (`area`, без
 * закреплённого над ней — см. `clearOf`): размыта только она, и перечень,
 * вылезший за её край на чёткую шапку, читался бы чем-то чужим, к дню не
 * относящимся. За край сетки он выходит,
 * только когда внутри не помещается, — тогда держится в пределах окна.
 */
function placeList(cell: Box, area: Box, count: number, withNote: boolean): ListPlace {
  const extra = withNote ? NOTE_ROOM : 0;
  const tall = (rows: number) => rows * ROW + (rows - 1) * ROW_GAP + PAD * 2 + extra;
  const one = tall(count);
  const middleY = cell.top + cell.height / 2;
  const middleX = cell.left + cell.width / 2;

  const screenTop = SCREEN_EDGE;
  const screenBottom = window.innerHeight - SCREEN_EDGE;
  const areaTop = Math.max(area.top, screenTop);
  const areaBottom = Math.min(area.top + area.height, screenBottom);

  const roomRight = window.innerWidth - (cell.left + cell.width) - LIST_GAP - SCREEN_EDGE;
  const roomLeft = cell.left - LIST_GAP - SCREEN_EDGE;
  if (Math.max(roomRight, roomLeft) >= ONE_COLUMN && one <= screenBottom - screenTop) {
    const onRight = roomRight >= roomLeft;
    const [low, high] =
      one <= areaBottom - areaTop ? [areaTop, areaBottom] : [screenTop, screenBottom];
    const top = Math.min(Math.max(middleY - one / 2, low), high - one);
    return {
      columns: 1,
      style: {
        top,
        width: ONE_COLUMN,
        left: onRight ? cell.left + cell.width + LIST_GAP : cell.left - LIST_GAP - ONE_COLUMN,
      },
    };
  }

  // Места меряются от краёв сетки, а если там не встать и в два столбца —
  // от краёв окна.
  const roomWithin = (low: number, high: number) => ({
    under: high - (cell.top + cell.height) - LIST_GAP,
    over: cell.top - LIST_GAP - low,
  });
  let { under, over } = roomWithin(areaTop, areaBottom);
  if (Math.max(under, over) < tall(Math.ceil(count / 2))) {
    ({ under, over } = roomWithin(screenTop, screenBottom));
  }
  const below = under >= over;
  const room = below ? under : over;
  const columns = one <= room ? 1 : 2;
  const width = Math.min(
    columns === 1 ? ONE_COLUMN : HALF_COLUMN * 2,
    window.innerWidth - SCREEN_EDGE * 2,
  );
  const left = Math.min(
    Math.max(middleX - width / 2, SCREEN_EDGE),
    window.innerWidth - SCREEN_EDGE - width,
  );
  return {
    columns,
    style: {
      left,
      width,
      maxHeight: room,
      ...(below
        ? { top: cell.top + cell.height + LIST_GAP }
        : { bottom: window.innerHeight - cell.top + LIST_GAP }),
    },
  };
}

export function DayRing({
  day,
  kind,
  profile,
  onChange,
  onClose,
}: {
  /** Сутки, у которых открыт перечень. `null` — перечня нет. */
  day: IsoDate | null;
  kind: DayRingKind;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onClose: () => void;
}) {
  // Перечень живёт только по нажатию, то есть заведомо в браузере: при сборке
  // страницы `day` пуст, и до портала дело не доходит. Проверка на документ
  // — не перестраховка, а условие статической сборки: `document.body` там
  // не существует вовсе.
  if (day === null || typeof document === "undefined") return null;

  // Через портал, а не на месте: раздел с сеткой поднят сдвигом
  // (`-translate-y-2` в `workspace.tsx`), а любой `transform` у предка
  // заводит новую систему отсчёта для `position: fixed` — перечень уехал бы
  // вместе со страницей. В теле документа предков у него нет.
  return createPortal(
    <Ring
      key={day}
      day={day}
      kind={kind}
      profile={profile}
      onChange={onChange}
      onClose={onClose}
    />,
    document.body,
  );
}

/** Прямоугольник на экране. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Скругления углов клетки: левый верхний, правый верхний, правый нижний, левый нижний. */
type Radii = readonly [number, number, number, number];

/** Где стоит день и что вокруг него размыть. */
interface Spot {
  /** Сама клетка — ровно её рамка, без запаса. */
  cell: Box;
  /** Её скругления: окошко в размытии повторяет их, а не режет углы. */
  radii: Radii;
  /** Видимая часть сетки года — то, что размывается. */
  grid: Box;
  /**
   * Та же часть без шапки, полосы с числами и нижнего ряда знаков: они
   * стоят над размытием и остаются чёткими, а перечень над ними закрыл
   * бы их. Ему отведена эта часть.
   */
  clear: Box;
}

/** Скругления клетки — у неё самой, а если их нет, у её содержимого. */
function radiiOf(cell: HTMLElement): Radii {
  const read = (element: Element): Radii => {
    const style = getComputedStyle(element);
    return [
      parseFloat(style.borderTopLeftRadius) || 0,
      parseFloat(style.borderTopRightRadius) || 0,
      parseFloat(style.borderBottomRightRadius) || 0,
      parseFloat(style.borderBottomLeftRadius) || 0,
    ];
  };
  const own = read(cell);
  if (own.some((radius) => radius > 0)) return own;
  const inner = cell.firstElementChild;
  return inner === null ? own : read(inner);
}

/** Прямоугольник, обрезанный кромками окна. */
function onScreen(box: DOMRect): Box {
  const left = Math.max(0, box.left);
  const top = Math.max(0, box.top);
  return {
    left,
    top,
    width: Math.max(0, Math.min(window.innerWidth, box.right) - left),
    height: Math.max(0, Math.min(window.innerHeight, box.bottom) - top),
  };
}

/**
 * Видимая часть сетки за вычетом того, что над ней закреплено.
 *
 * Сверху — шапка и полоса с числами (`data-summary`): на телефоне при
 * прокрутке они стоят прямо над сеткой. Снизу — ряд знаков (`data-dock`).
 * Вычитается только то, что действительно заходит на сетку: на широком
 * экране полоса стоит над ней, и сетка остаётся целой.
 */
function clearOf(grid: Box): Box {
  let top = grid.top;
  let bottom = grid.top + grid.height;
  const overlaps = (box: DOMRect) => box.bottom > top && box.top < bottom;
  for (const element of document.querySelectorAll("header, [data-summary]")) {
    const box = element.getBoundingClientRect();
    if (overlaps(box)) top = Math.max(top, box.bottom);
  }
  // Сами знаки, а не полоса ряда: с `md` знаки стоят колонкой у левого
  // края, а полоса остаётся во всю ширину окна и в высоту колонки, — по ней
  // низ сетки уехал бы вверх на двести с лишним точек по всей ширине.
  // Знак вычитается, только если он и правда стоит над сеткой: колонка
  // слева в поле страницы, мимо неё, а на телефоне знаки лежат на сетке.
  for (const knob of document.querySelectorAll("[data-dock] button")) {
    const box = knob.getBoundingClientRect();
    const across = box.right > grid.left && box.left < grid.left + grid.width;
    if (across && overlaps(box)) bottom = Math.min(bottom, box.top);
  }
  return { left: grid.left, top, width: grid.width, height: Math.max(0, bottom - top) };
}

function Ring({
  day,
  kind,
  profile,
  onChange,
  onClose,
}: {
  day: IsoDate;
  kind: DayRingKind;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onClose: () => void;
}) {
  const [spot, setSpot] = useState<Spot | null>(null);
  /** Строка под курсором — у отмеченного вида знак сменяется крестиком. */
  const [hovered, setHovered] = useState<number | null>(null);
  /** Правка заметки: окно вместо перечня — строка в строку перечня не встаёт. */
  const [noting, setNoting] = useState(false);
  /**
   * Отметка, у которой спрашивают срок.
   *
   * Отпуска, больничный и вызов ДЛЯТСЯ, и одним днём дело кончается редко.
   * Отметка ложится сразу — человек видит её в клетке, — а следом окно
   * спрашивает, по какое число, и у вызова ещё и часы в сутки. Закрыть его,
   * ничего не назвав, — это согласиться на один день.
   */
  const [asking, setAsking] = useState<
    { slot: Slot; endsOn: IsoDate; hours: string } | null
  >(null);

  /**
   * Перечень стоит у самой клетки — и остаётся у неё при прокрутке.
   *
   * Клетка ищется по примете `data-day`, той же, которой её находит перенос
   * смены (`use-shift-drag.ts`). Уехала за край окна — перечню не за что
   * держаться, и он закрывается.
   *
   * Вместе с клеткой меряется и сетка года (`.year-grid`): размывается
   * только она, а не вся страница.
   *
   * --- Первый замер — особый --------------------------------------------
   *
   * Почти всегда день открывают нажатием по клетке, то есть по тому, что
   * человек видит. Но есть и второй путь: строка в перечне внесённых
   * изменений («12 марта, больничный»), и оттуда сутки могут оказаться в
   * любом конце года — за нижним краем страницы, а то и в ещё не
   * отрисованной сетке, которая в этот миг только проявляется.
   *
   * Поэтому в первый раз перечень не закрывается, а ждёт клетку кадр за
   * кадром и, дождавшись, подводит её к середине экрана. Закрываться из-за
   * того, что день оказался не в поле зрения, он начинает потом — когда
   * человек сам уводит страницу прокруткой.
   */
  useLayoutEffect(() => {
    // Сколько кадров ждать клетку: сетка года собирается за несколько,
    // а проявление раздела занимает около двух десятых секунды.
    let waiting = 60;
    let frame = 0;
    let settled = false;

    function place() {
      const cell = document.querySelector<HTMLElement>(`[data-day="${day}"]`);
      if (cell === null) {
        // Сетки ещё нет. Ждём её, пока есть терпение: без клетки перечню
        // негде стоять, и рисовать он ничего не станет.
        if (!settled && waiting-- > 0) frame = requestAnimationFrame(place);
        return;
      }
      const box = cell.getBoundingClientRect();
      const away = box.bottom < 0 || box.top > window.innerHeight;
      if (away && settled) {
        onClose();
        return;
      }
      if (away) {
        // Первый замер: день не виден — значит, пришли не с сетки.
        // Подводим его к глазам и меряем на следующем кадре.
        cell.scrollIntoView({ block: "center" });
        if (waiting-- > 0) frame = requestAnimationFrame(place);
        return;
      }
      settled = true;
      const grid = onScreen((cell.closest(".year-grid") ?? cell).getBoundingClientRect());
      setSpot({
        cell: { left: box.left, top: box.top, width: box.width, height: box.height },
        radii: radiiOf(cell),
        grid,
        clear: clearOf(grid),
      });
    }

    place();
    window.addEventListener("resize", place);
    // Третьим доводом `true`: прокручивается не окно, а страница внутри
    // него, и всплытия у события прокрутки нет — ловить его можно только на
    // погружении.
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [day, onClose]);

  /**
   * Esc закрывает перечень.
   *
   * Нажатия по размытой сетке ловит сам слой размытия (`Scrim`) — своим
   * слоем, а не слушателем на документе: размытая сетка обязана быть
   * неактивной, а слушатель только ДОБАВЛЯЛ бы закрытие к чужому нажатию,
   * не отменяя его.
   *
   * Пока открыто окно срока или заметки, перечня нет, и Esc принадлежит
   * окну: закрывает его оно само.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && asking === null && !noting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, asking, noting]);

  /**
   * Нажатие по НЕразмытому — шапке, полосе цифр, нижнему ряду — тоже
   * закрывает перечень.
   *
   * Размывается только сетка, и всё вокруг неё остаётся живым: человек
   * может, не закрывая дня, сменить период или тему. Но перечень при этом
   * остался бы висеть над сеткой, которая уже о другом. Поэтому нажатие
   * вне перечня и вне размытия закрывает его — и делает своё: кнопка под
   * пальцем срабатывает, ведь её ничто не накрывает.
   */
  useEffect(() => {
    if (asking !== null || noting) return;
    function onDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (target?.closest("[data-day-ring], [data-day-ring-scrim]")) return;
      onClose();
    }
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose, asking, noting]);

  const shift = shiftOn(profile, day);
  const lawful = statutoryCalendar(profile.accountingYear).get(day) ?? "working";
  const effective = profile.calendarOverrides[day] ?? lawful;
  const hasAbsence = (absence: AbsenceKind) =>
    profile.absences.some(
      (item) => item.kind === absence && item.startsOn <= day && day <= item.endsOn,
    );
  // Вид здесь не спрашивается нарочно: выход сверх графика в перечне один, а
  // пять старых видов (соревнования, сбор, резерв, праздник, выборы)
  // встречаются только в прежних профилях. Строка «Вызов» обязана видеть и
  // их — иначе на таком дне она предложила бы поставить второй выход поверх
  // первого (см. `withCalloutToggled`).
  const hasCallout = () =>
    profile.callouts.some(
      (item) => item.startsOn <= day && day <= item.endsOn,
    );

  /**
   * Выбор сделан — перечень уходит.
   *
   * Кроме того, что длится: там перечень тоже уходит, но следом открывается
   * окно срока, и закрыть его нельзя — окно рисуется отсюда и ушло бы
   * вместе с ним. Уходит он с виду: строки не рисуются, пока окно открыто.
   */
  function act(slot: Slot) {
    if (slot.kind === "absence") {
      const on = hasAbsence(slot.absence);
      onChange((previous) => withAbsenceToggled(previous, day, slot.absence));
      // Снятое не спрашивает ни о чём: срок у того, чего в сутках больше
      // нет, назначать не по чему. И отгул не спрашивает никогда: он не
      // длится — его берут за одну конкретную смену, и «отгул по такое-то
      // число» означало бы череду отгулов, каждый за свою смену. Их и
      // отмечают по одному, в тех сутках, где смена была.
      if (on || slot.absence === "time_off_in_lieu") {
        onClose();
        return;
      }
      setAsking({ slot, endsOn: day, hours: DEFAULT_CALLOUT_HOURS });
      return;
    }
    if (slot.kind === "callout") {
      const on = hasCallout();
      onChange((previous) =>
        withCalloutToggled(previous, day, slot.callout, DEFAULT_CALLOUT_HOURS),
      );
      if (on) {
        onClose();
        return;
      }
      setAsking({ slot, endsOn: day, hours: DEFAULT_CALLOUT_HOURS });
      return;
    }
    if (slot.kind === "shift") {
      onChange((previous) => withShiftAt(previous, day, !shift));
      onClose();
      return;
    }
    if (slot.kind === "dayType") {
      onChange((previous) => withDayTypeAt(previous, day, slot.type));
      onClose();
      return;
    }
    setNoting(true);
  }

  function commitNote(text: string) {
    onChange((previous) => withNoteAt(previous, day, text));
    onClose();
  }

  /** Срок назван: продлить ту же запись, а не завести вторую. */
  function commitSpan(endsOn: IsoDate, hours: string | null) {
    if (asking === null) return;
    const { slot } = asking;
    if (slot.kind === "absence") {
      onChange((previous) => withAbsenceUntil(previous, day, slot.absence, endsOn));
    }
    if (slot.kind === "callout" && hours !== null) {
      onChange((previous) =>
        withCalloutUntil(previous, day, slot.callout, endsOn, hours),
      );
    }
    onClose();
  }

  if (spot === null) {
    // Первый кадр: место клетки ещё не измерено. Рисовать нечего — но и
    // мигать нечем, замер идёт до отрисовки (`useLayoutEffect`).
    return null;
  }

  // Отгул берут вместо смены: на свободных по графику сутках его в перечне
  // нет — отмечать им там нечего.
  const ring = (kind === "calendar" ? CALENDAR_RING : SHIFT_RING).filter(
    (slot) => shift || !(slot.kind === "absence" && slot.absence === "time_off_in_lieu"),
  );

  // Пока спрашивают срок или пишут заметку, перечня нет: его место занял
  // разговор, который начался нажатием в нём.
  const picking = asking === null && !noting;
  const face = asking === null ? null : faceOf(asking.slot, shift);
  // Записанная заметка, а не та, что человек сейчас набирает: черновик
  // живёт в окне заметки, и перечня в этот миг всё равно нет.
  const storedNote = profile.dayNotes[day] ?? "";
  const list = placeList(spot.cell, spot.clear, ring.length, storedNote !== "");
  const [tl, tr, br, bl] = spot.radii;

  return (
    <div
      data-day-ring
      role="group"
      aria-label={`Что было ${formatDayMonthRu(day)}`}
    >
      {/* Размывается только сетка, кроме самого дня, и размытое нажатий
          дальше не пускает: нажал мимо — вернулся к сетке.

          Тот же слой стоит и под окном срока или времени (`asking`): разговор
          о сутках один от нажатия по ним до «Готово», и фон у него один —
          сетка размыта, день резок, затемнения нет. Слой стоит ВНЕ перечня,
          на одном месте разметки, и при смене перечня на окно не
          пересоздаётся: размытие не мигает и не проступает заново.

          Окну заметки этот слой не достался: заметка не срок и не время, и её
          окно гасит страницу общим затемнением, как любое окно приложения. */}
      {picking || asking !== null ? (
        <Scrim area={spot.grid} hole={spot.cell} radii={spot.radii} onDismiss={onClose} />
      ) : null}

      {picking ? (
        <>

          {/* Окошко в размытии — сам день, и нажатие по нему закрывает
              перечень: нажал по дню — раскрылся перечень, нажал ещё раз —
              закрылся. Накладка нужна потому, что слой размытия лежит
              поверх сетки: вырезанное маской окошко видно насквозь, но нажатию
              через него не пройти. */}
          <button
            type="button"
            data-day-ring
            onClick={onClose}
            title="Закрыть"
            aria-label={`Закрыть выбор для ${formatDayMonthRu(day)}`}
            style={{
              ...spot.cell,
              borderRadius: `${tl}px ${tr}px ${br}px ${bl}px`,
            }}
            className={cn(
              "fixed z-[115] cursor-pointer bg-transparent",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
            )}
          />

          {/* Перечень видов — знак и название рядом, как в легенде, только
              нажимаемый. Плашка та же, что у окошек меню и легенды
              (`lit modal-lift`): это такое же окошко выбора, раскрытое из
              того, по чему нажали, — с той же каймой, что горит от лампы и
              разгорается под курсором. */}
          <div
            data-day-ring
            style={list.style}
            className={cn(
              "day-list lit modal-lift fixed z-[115] overflow-y-auto rounded-xl bg-paper-raised p-1.5",
            )}
          >
            <ul className={cn("grid gap-0.5", list.columns === 2 ? "grid-cols-2" : "grid-cols-1")}>
              {ring.map((slot, index) => {
                const rowFace = faceOf(slot, shift);
                const on =
                  slot.kind === "absence"
                    ? hasAbsence(slot.absence)
                    : slot.kind === "callout"
                      ? hasCallout()
                      : slot.kind === "dayType"
                        ? effective === slot.type
                        : slot.kind === "note"
                          ? storedNote !== ""
                          : false;
                /**
                 * То, что в сутках УЖЕ стоит: нажатие его уберёт.
                 *
                 * Так строка и называется («Убрать: Больничный») для
                 * программы чтения, а глазу это показывает крестик на
                 * месте знака — под курсором или в фокусе.
                 *
                 * Только у отсутствий и вызова: у видов дня по календарю
                 * снятия нет (день всегда какой-то), у смены нет отметки
                 * вовсе, а заметку нажатие открывает править, а не стирает.
                 */
                const marked = on && (slot.kind === "absence" || slot.kind === "callout");
                const erasing = marked && hovered === index;
                const name = marked ? `Убрать: ${rowFace.label}` : rowFace.label;
                return (
                  <li key={index}>
                    <button
                      type="button"
                      data-day-ring
                      onClick={() => act(slot)}
                      onPointerEnter={() => setHovered(index)}
                      onPointerLeave={() => setHovered(null)}
                      onFocus={() => setHovered(index)}
                      onBlur={() => setHovered(null)}
                      // У смены состояния нет: она не отметка, а сам график,
                      // и строка называет то, чего в сутках ещё НЕТ.
                      aria-pressed={slot.kind === "shift" ? undefined : on}
                      aria-label={name}
                      title={name}
                      className={cn(
                        "flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-1.5",
                        "text-left text-sm text-ink transition-colors hover:bg-paper-sunken",
                        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
                      )}
                    >
                      {/* Знак — ровно тот, каким вид суток нарисован в
                          клетке: цвет, рамка и буква из общего словаря
                          (`day-marks.ts`). Отмеченное обведено чернилами. */}
                      <span
                        aria-hidden
                        className={cn(
                          "relative flex size-7 shrink-0 items-center justify-center",
                          "rounded-md border font-mono text-xs leading-none",
                          rowFace.tone,
                          on && "outline-2 -outline-offset-2 outline-ink",
                        )}
                      >
                        {rowFace.corner ? (
                          <span
                            aria-hidden
                            className="absolute right-0 top-0 size-0 border-l-4 border-t-4 border-l-transparent border-t-trace"
                          />
                        ) : null}
                        {erasing ? <X aria-hidden className="size-3.5" /> : rowFace.mark}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {rowFace.short ?? rowFace.label}
                      </span>
                      {/* Галочка у того, что уже стоит, — как у выбранного в
                          любом окошке выбора приложения. */}
                      {on ? <Check aria-hidden className="size-4 shrink-0 text-ink" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {/* Заметка этих суток — внизу перечня, тем же негромким
                текстом. На сетке от неё виден только уголок клетки, а раз
                день открыт — она уже ответ на вопрос «а что тут было». */}
            {storedNote !== "" ? (
              <p className="mt-1 flex gap-2 border-t border-rule px-2 pt-2 pb-1 text-xs leading-4 text-ink-muted">
                <Pencil aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-faint" />
                <span className="line-clamp-3">{storedNote}</span>
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {/* Срок у того, что длится. Отметка уже стоит в клетке — окно
          спрашивает не «отмечать ли», а «по какое число», и закрыть его,
          ничего не назвав, значит согласиться на один день.
          Окно общее с перечнем внесённых изменений (`day-event-modal.tsx`):
          там тем же окном двигают границу уже поставленного. */}
      <SpanModal
        // Ключ — событие, о котором речь: с новым событием окно заводится
        // заново, с его собственными сроком и часами.
        key={asking === null ? "none" : `${asking.slot.kind}:${day}`}
        open={asking !== null}
        title={face?.label ?? ""}
        startsOn={day}
        endsOn={asking?.endsOn ?? day}
        hours={asking?.slot.kind === "callout" ? asking.hours : null}
        onCommit={commitSpan}
        onClose={onClose}
        // Страницу не гасит: под окном то же размытие сетки, что под
        // перечнем (`.modal-bare` в `globals.css`).
        className="modal-bare"
      />

      {/* Заметке нужна строка ввода, а в перечне её нет. Поэтому
          единственная строка перечня, за которой не отметка, а окно. */}
      <NoteModal
        open={noting}
        day={day}
        text={storedNote}
        onCommit={commitNote}
        onClose={onClose}
      />
    </div>
  );
}

/**
 * Размытие сетки с окошком на месте дня.
 *
 * --- Почему только размытие, без темноты -----------------------------------
 *
 * Пока открыт день, разговор идёт о нём, и сетка вокруг — триста шестьдесят
 * пять таких же клеток — только отвлекает. Размытая, она перестаёт читаться
 * сеткой — теми же квадратами в том же ритме столбцов — и становится
 * фоном, а резким на экране остаются ровно два предмета: день и перечень.
 * Этого достаточно, чтобы взгляд нашёл выбор.
 *
 * Темнота поверх размытия была лишней: она не добавляла акцента, а
 * опускала занавес — экран тяжелел, будто открылось окно, хотя человек
 * всего лишь нажал по дню и сетка осталась на месте. Радиус размытия
 * небольшой и проявляется оно плавно (`.day-scrim` в `globals.css`):
 * сетка отступает назад, а не исчезает.
 *
 * --- Почему размывается только сетка ---------------------------------------
 *
 * Шапка, полоса цифр и нижний ряд знаков к разговору о дне прямо
 * относятся: в полосе видно, что стало с нормой после отметки, а в шапке и
 * в ряду — за какой период и какая сетка. Поэтому слой лежит ровно на
 * видимой части сетки (`area`) и ниже шапки, полосы и ряда: у них слои
 * выше (`z-index` 100, 40 и 90 против 30 здесь).
 *
 * --- Почему маска, а не рамки вокруг --------------------------------------
 *
 * Четыре полосы вокруг клетки — это четыре слоя, которые надо держать
 * сведёнными при каждой прокрутке, а поднять клетку над размытием нельзя:
 * сетка лежит в сдвинутом разделе (`-translate-y-2` в `workspace.tsx`), и
 * весь он рисуется одним слоем — `z-index` внутри него наружу не действует.
 *
 * Поэтому слой один, сплошной, а окошко в нём ВЫРЕЗАНО маской: фигура
 * клетки вычитается из полного слоя (`exclude`). Фигура — не прямоугольник,
 * а рамка дня с его же скруглениями (`radii`): прямоугольное окошко вокруг
 * скруглённой клетки оставляло по углам светлые зубцы, и день стоял в
 * остроугольной рамке, которой у него нет. Размытие следует за маской само:
 * браузер размывает подложку там, где слой РИСУЕТ, а в окошке он не рисует
 * ничего — день остаётся резким.
 *
 * --- Почему слой ловит нажатия --------------------------------------------
 *
 * Маска — дело рисования, а не нажатий: вырезанное окошко видно насквозь,
 * но слой над ним остаётся. Здесь это кстати. Размытая сетка обязана быть
 * неактивной, и слой её такой и делает: нажатие достаётся ему, перечень
 * закрывается, а клетка под пальцем не срабатывает.
 */
function Scrim({
  area,
  hole,
  radii,
  onDismiss,
}: {
  /** Видимая часть сетки — то, что размывается. */
  area: Box;
  /** Окошко для выбранного дня: он и есть предмет разговора. */
  hole: Box;
  radii: Radii;
  onDismiss: () => void;
}) {
  // Окошко — в координатах самого слоя: он стоит на месте сетки, а не во
  // весь экран.
  const inside = { ...hole, left: hole.left - area.left, top: hole.top - area.top };
  const open =
    inside.left + inside.width > 0 &&
    inside.top + inside.height > 0 &&
    inside.left < area.width &&
    inside.top < area.height;

  const layer = "linear-gradient(#000 0 0)";
  const shape = `url("${holeShape(inside.width, inside.height, radii)}")`;
  const image = open ? `${shape}, ${layer}` : layer;
  const size = open ? `${inside.width}px ${inside.height}px, 100% 100%` : "100% 100%";
  const position = open ? `${inside.left}px ${inside.top}px, 0 0` : "0 0";

  return (
    <div
      aria-hidden
      data-day-ring-scrim
      // Закрывается по НАЖАТИЮ (`click`), а не по касанию пальца.
      // ---------------------------------------------------------------------
      // Было по `pointerdown` — и на телефоне это открывало день заново.
      // Порядок событий там такой: палец коснулся, слой закрыл перечень и
      // исчез вместе с ним, палец поднялся — и браузер шлёт `click` по тем
      // же точкам, но попадает уже в клетку под бывшим слоем: вокруг неё
      // раскрывался новый перечень. По `click` слой доживает до конца жеста
      // и получает нажатие сам — клетке под ним не достаётся ничего.
      onClick={onDismiss}
      // Только размытие, без заливки, — довод в шапке функции. Два
      // пикселя: сетка уже не читается клетками, но месяцы и цвета смен
      // узнаются — человек видит, где он, и не теряет места.
      className="day-scrim fixed z-[30] backdrop-blur-[2px]"
      style={{
        left: area.left,
        top: area.top,
        width: area.width,
        height: area.height,
        maskImage: image,
        WebkitMaskImage: image,
        maskSize: size,
        WebkitMaskSize: size,
        maskPosition: position,
        WebkitMaskPosition: position,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskComposite: open ? "exclude, add" : "add",
        // Старое написание для Safari: `xor` — то же, что `exclude`.
        WebkitMaskComposite: open ? "xor, source-over" : "source-over",
      }}
    />
  );
}

/**
 * Фигура окошка — рамка дня со скруглениями, картинкой SVG для маски.
 *
 * Скругления у каждого угла свои: у сомкнутого месяца клетки скруглены
 * все, но правило это задаёт сетка, а не окошко, и оно обязано повторить
 * то, что нарисовано, а не то, что ожидалось.
 */
function holeShape(width: number, height: number, [tl, tr, br, bl]: Radii): string {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const path =
    `M${tl} 0H${w - tr}A${tr} ${tr} 0 0 1 ${w} ${tr}` +
    `V${h - br}A${br} ${br} 0 0 1 ${w - br} ${h}` +
    `H${bl}A${bl} ${bl} 0 0 1 0 ${h - bl}` +
    `V${tl}A${tl} ${tl} 0 0 1 ${tl} 0Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${path}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Буква, цвет и название квадрата. */
function faceOf(slot: Slot, shift: boolean): Face {
  if (slot.kind === "absence") {
    return {
      mark: ABSENCE_MARK[slot.absence],
      tone: ABSENCE_TONE[slot.absence],
      label: ABSENCE_LABELS[slot.absence],
    };
  }
  if (slot.kind === "callout") {
    return {
      mark: CALLOUT_MARK,
      tone: CALLOUT_TONE,
      label: CALLOUT_LABELS[slot.callout],
    };
  }
  if (slot.kind === "dayType") {
    return {
      mark: DAY_TYPE_MARK[slot.type],
      tone: DAY_TYPE_TONE[slot.type],
      label: DAY_TYPE_LABELS[slot.type],
    };
  }
  if (slot.kind === "shift") {
    // Противоположное тому, что стоит в клетке: на рабочем дне предлагается
    // выходной, на выходном — смена. Довод целиком — в шапке файла.
    return shift
      ? { mark: DAY_OFF_MARK, tone: DAY_OFF_TONE, label: "Сделать выходным" }
      : // «С» — смена. На сетке у смены буквы нет (там в клетке часы), но в
        // перечне у каждого вида свой знак, и оставить его пустым значило
        // бы сделать единственным неподписанным.
        { mark: "С", tone: SHIFT_TONE, label: "Поставить смену" };
  }
  return {
    mark: NOTE_MARK,
    tone: RING_NOTE_TONE,
    label: "Заметка к этому дню",
    short: "Заметка",
    corner: true,
  };
}
