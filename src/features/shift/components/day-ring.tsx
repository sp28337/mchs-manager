"use client";

import { Pencil, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Card, Field } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";

import { parseHours } from "../domain/decimal";
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
import { DateField } from "./date-field";

/**
 * Кольцо видов ВОКРУГ клетки: чем эти сутки были на самом деле.
 *
 * --- Почему вокруг клетки, а не окном над ней --------------------------------
 *
 * Прежде нажатие по дню открывало окно во весь экран: список из двенадцати
 * видов с флажками, поля времени, вторая дата. Всё это нужно — но не каждый
 * раз. Обычная правка короткая: «здесь был больничный», и ради неё человек
 * уходил с сетки, терял из виду месяц, отмечал галочку и возвращался, чтобы
 * взглядом искать следующий день.
 *
 * Потом на месте окна стояла плашка с девятью квадратами — она тоже
 * ЗАКРЫВАЛА собой клетку и соседей, и день, о котором шла речь, приходилось
 * рисовать в ней заново.
 *
 * Теперь клетка остаётся на месте и остаётся видимой: квадраты распускаются
 * вокруг неё, по соседним местам сетки, и каждый — размером с саму клетку.
 * Отметка ложится в клетку тут же, у человека на глазах, и подтверждать её
 * нечем и незачем: он видит, что день стал больничным.
 *
 * --- Почему они вылетают, а не появляются ------------------------------------
 *
 * Квадраты, возникшие разом, читаются новым слоем поверх сетки — тем же
 * окном, только без рамки. Вылетая из клетки, они читаются её
 * продолжением: это её собственные ответы, и вернутся они туда же.
 * Движение короткое (200 мс) и с небольшим запаздыванием друг за другом —
 * столько, чтобы глаз успел заметить, откуда они. При отключённой анимации
 * (`prefers-reduced-motion`) общее правило страницы сводит его к мгновению.
 *
 * --- Что в кольце и почему именно это ----------------------------------------
 *
 * На графике смен: пять освобождений от работы (отпуск, доп. отпуск,
 * больничный, отгул, учебный), вызов, смена-или-выходной и заметка. Это
 * всё, что человек отмечает изо дня в день. Пять остальных видов вызова —
 * соревнования, сбор, резерв, праздник, выборы — редки и требуют часов, и
 * живут там, где часы и спрашивают: в полном окне, которое открывается
 * нажатием по самому дню в середине кольца.
 *
 * На производственном календаре вопрос другой — каким этот день считается
 * по закону, — и ответов на него ровно четыре: рабочий, предпраздничный,
 * праздничный, выходной. Плюс заметка: она к виду дня не относится, но
 * нужна на обеих сетках одинаково. Кольцо там из пяти квадратов, а не из
 * восьми, но ведёт себя так же — и в этом весь смысл: человек не должен
 * узнавать способ правки заново, переключив вид сетки.
 *
 * --- Почему в квадрате смены стоит ПРОТИВОПОЛОЖНОЕ ---------------------------
 *
 * Остальные квадраты — отметки: нажал, и в сутках появилось то, чего не
 * было. Этот не отмечает ничего нового, он правит сам график, и у него есть
 * только два значения: смена или выходной. Показывать в нём то, что и так
 * стоит в клетке, значило бы предлагать нажать на «уже так»; поэтому он
 * показывает второе — на рабочем дне «В», на выходном «С». Нажатие делает
 * ровно то, что в нём написано.
 *
 * --- Почему на квадратах только буква ----------------------------------------
 *
 * Число назвало бы день, а день здесь один — тот, вокруг которого кольцо, и
 * он остался на своём месте, в середине. Восемь квадратов с одним и тем же
 * числом читались бы восемью днями.
 *
 * --- Почему квадрат выглядит ровно так, как выглядел бы день -----------------
 *
 * Свой набор цветов у кольца был, и был он ярче сеточного: квадрат — это
 * предложение, рассуждали мы, и читаться он должен первым. Но человек
 * нажимает в кольце на то, что потом будет смотреть в клетке, и если
 * «больничный» в кольце и «больничный» на сетке — два разных оттенка, он
 * учит два языка вместо одного.
 *
 * Поэтому цвет, рамка и буква берутся из общего словаря (`day-marks.ts`,
 * `DAY_TYPE_TONE`) — те же, какими вид суток нарисован в клетке, где есть
 * смена. Буква своего цвета, а не чернильная: на сетке она такая же.
 * Заметный квадрат делает не оттенок, а погасшая вокруг страница.
 *
 * --- Почему погасшее нельзя нажать -------------------------------------------
 *
 * Страница вокруг кольца гаснет и размывается, и не для красоты: пока
 * кольцо открыто, разговор идёт об одном дне, и всё остальное к нему
 * отношения не имеет. Значит, и нажиматься оно не должно. Погашенное ловит нажатие само
 * и не пропускает его дальше: кольцо закрывается, человек возвращается к
 * сетке — и ни соседний день, ни кнопка под пальцем при этом не
 * срабатывают. Нажатие мимо стоит ровно один шаг назад, а не шаг назад и
 * случайную правку заодно.
 *
 * Открытое место в затемнении одно — сам день. И он не просто виден: он
 * нажимается, за ним полное окно со всеми видами, временем и часами.
 *
 * --- Почему перечень видов стоит у кольца, а не внизу страницы ---------------
 *
 * Буквы в квадратах короткие («О», «Д», «ВЗ»), и человек, открывший кольцо
 * впервые, их не знает. Раньше ответ был внизу страницы, в легенде сетки, и
 * ради него затемнение оставляло легенду незатемнённой — но легенда лежит в
 * стороне, а на телефоне и вовсе за краем экрана: доводить до неё взгляд
 * (а то и прокрутку) значило уйти от дня, ради которого всё и открыли.
 *
 * Теперь перечень стоит вплотную к кольцу: тот же квадрат и рядом название.
 * Легенда страницы гаснет вместе со всем остальным — второй словарь в двух
 * концах экрана только раздваивал бы внимание.
 *
 * Наведение связывает половины: подведённый в кольце квадрат светлеет и
 * подаётся вперёд, а в перечне разгорается его строка — и гаснут соседние.
 * Знак и название называют одно и то же, и показать это лучше всего
 * одновременным движением с двух сторон.
 *
 * --- Почему кольцо уходит сразу после выбора ---------------------------------
 *
 * Выбор в кольце — один, и после него разговор окончен: отметка уже в
 * клетке, смотреть на неё надо на сетке, а не сквозь затемнение. Поэтому
 * кольцо и затемнение снимаются тем же нажатием, каким сделан выбор.
 *
 * У того, что ДЛИТСЯ (отпуска, больничный, вызов), следом открывается окно
 * срока — и кольца за ним уже нет: гасит страницу само окно, и второе
 * затемнение поверх первого было бы вдвое темнее. То же с заметкой: ей
 * нужна строка, а строка в квадрат со стороной в клетку не встаёт.
 */

/** Часы вызова по умолчанию: обычная смена. */
const DEFAULT_CALLOUT_HOURS = "8";

/**
 * Заметка в кольце — обычная клетка с уголком.
 *
 * На сетке заметку показывает не цвет, а маленький треугольник в углу
 * клетки: цвет там занят видом суток. В кольце занимать нечего, и всё
 * равно уголок остаётся — по нему заметку и узнают, когда она уже стоит.
 */
const RING_NOTE_TONE = "border-rule bg-paper-raised text-ink-muted";

/** Не мельче этого квадрат не бывает: в цель меньше пальца не попадают. */
const LEAST_CELL = 34;

/** Просвет между клеткой и кольцом — тот же, что между клетками сетки. */
const RING_GAP = 4;

/** С какой сетки открыто кольцо — от этого зависит, о чём оно спрашивает. */
export type DayRingKind = "shifts" | "calendar";

type Slot =
  | { kind: "absence"; absence: AbsenceKind }
  | { kind: "callout"; callout: CalloutKind }
  | { kind: "shift" }
  | { kind: "dayType"; type: DayType }
  | { kind: "note" };

/**
 * Восемь видов графика в порядке чтения: слева направо, сверху вниз.
 *
 * Сверху и по бокам — освобождения от работы, одной семьёй. Снизу то, что
 * к ней не относится: работа помимо графика, сам график и заметка. Заметка
 * — последней, дальше всех от отпусков: она ничего не меняет в расчёте,
 * это память о дне, а не его вид.
 *
 * Места здесь нет нарочно: его считает `placesAround` — по тому, сколько
 * бумаги осталось вокруг клетки до края окна.
 */
const SHIFT_RING: readonly Slot[] = [
  { kind: "absence", absence: "annual_leave" },
  { kind: "absence", absence: "extra_leave" },
  { kind: "absence", absence: "study_leave" },
  { kind: "absence", absence: "sick_leave" },
  { kind: "callout", callout: "callout" },
  { kind: "shift" },
  { kind: "note" },
  // Отгул — последним, хотя по смыслу он у отпусков и больничного.
  // -------------------------------------------------------------------
  // Он единственный, кого в кольце иногда нет: отгул берут ВМЕСТО смены, и
  // на свободных по графику сутках отмечать им нечего. Стой он в середине
  // ряда, его исчезновение сдвигало бы всё, что за ним, и один и тот же
  // вид оказывался бы то слева от дня, то справа — в зависимости от того,
  // рабочий он или нет. Последним же он просто пропадает, не трогая
  // остальных: места раздаются по порядку, и лишним оказывается последнее.
  { kind: "absence", absence: "time_off_in_lieu" },
];

/** Четыре вида дня по закону и заметка — кольцо производственного календаря. */
const CALENDAR_RING: readonly Slot[] = [
  { kind: "dayType", type: "working" },
  { kind: "dayType", type: "pre_holiday" },
  { kind: "dayType", type: "holiday" },
  { kind: "dayType", type: "weekend" },
  { kind: "note" },
];

/**
 * Места кольца из пяти: крест вокруг дня и один угол.
 *
 * Мест вокруг клетки восемь, а видов дня по календарю четыре. Разложить
 * четыре по восьми местам подряд значило бы собрать их в одну сторону и
 * оставить полкольца пустым. Крест — сверху, слева, справа, снизу —
 * окружает день ровно и не выделяет ни один из видов местом. Заметка
 * становится в угол: она не вид дня, и стоять с ними в одном ряду ей
 * незачем.
 */
const CROSS_AND_CORNER: readonly number[] = [1, 3, 4, 6, 7];

/**
 * Восемь мест вокруг клетки — и как они смещаются у края экрана.
 *
 * Обычно клетка стоит в середине квадрата три на три, а восемь видов — по
 * сторонам света от неё. У дня в первом столбце левая колонка кольца ушла
 * бы за край окна, и до неё было бы не дотянуться.
 *
 * Тогда квадрат три на три сдвигается целиком — на один шаг вправо, — и
 * клетка оказывается не в середине его, а с краю: виды встают справа от
 * неё, сверху и снизу. Сама клетка при этом остаётся на месте и остаётся
 * ОТКРЫТОЙ: кольцо вокруг дня, а не поверх него — в этом весь его смысл.
 * То же с правым краем и с верхом-низом окна.
 *
 * Порядок видов от сдвига не меняется: он читается по местам квадрата
 * слева направо и сверху вниз, а клетка просто занимает в нём другое
 * место.
 */
function placesAround(
  spot: Spot,
  step: number,
): readonly { col: number; row: number }[] {
  const edge = 6;
  const half = spot.size / 2;
  const shift = (middle: number, room: number) => {
    if (middle - step - half < edge) return 1;
    if (middle + step + half > room - edge) return -1;
    return 0;
  };
  const col = shift(spot.x, window.innerWidth);
  const row = shift(spot.y, window.innerHeight);

  const places: { col: number; row: number }[] = [];
  for (const y of [row - 1, row, row + 1]) {
    for (const x of [col - 1, col, col + 1]) {
      // Место самой клетки занято ею же — она и есть середина кольца.
      if (x === 0 && y === 0) continue;
      places.push({ col: x, row: y });
    }
  }
  return places;
}

/** Как выглядит и называется один вид суток в кольце. */
interface Face {
  mark: ReactNode;
  tone: string;
  label: string;
  /**
   * Короткое имя для перечня у кольца.
   *
   * Подпись самой кнопки остаётся полной — её читает вслух программа
   * чтения, и «Заметка» без продолжения там ничего не говорит. А в перечне
   * на телефоне длинное название обрывается многоточием, и обрывок
   * объясняет хуже, чем короткое слово целиком.
   */
  short?: string;
  /** Уголок заметки: цвет у квадрата занят видом суток, и здесь тоже. */
  corner?: boolean;
}

/** Где и в сколько столбцов встанет перечень видов у кольца. */
interface LegendPlace {
  style: CSSProperties;
  columns: 1 | 2;
}

/** Ширина перечня: столько занимает самое длинное название в один столбец. */
const LEGEND_WIDTH = 208;

/** Уже этого перечень сбоку не встанет — названия начнут рваться. */
const LEGEND_LEAST = 150;

/** Заметке хватает меньшего: это одна строка текста, а не восемь. */
const NOTE_LEAST = 96;

/** Просвет между кольцом и перечнем — заметно больше, чем внутри кольца. */
const LEGEND_GAP = 12;

/** Поле до кромки окна: перечень не должен упираться в край. */
const SCREEN_EDGE = 8;

/**
 * Куда положить перечень видов и заметку, чтобы они не закрыли кольцо.
 *
 * Перечень — сбоку, если сбоку есть место: он читается столбцом, а столбец
 * рядом с кольцом не спорит с ним ни за одну строку экрана. Какой стороной
 * — той, где места больше; у дня в январе это правая, у дня в декабре
 * левая.
 *
 * Заметка встаёт с ПРОТИВОПОЛОЖНОЙ стороны. Две подписи по одну руку
 * слиплись бы в один столбец текста, и стало бы непонятно, где кончается
 * словарь и начинаются слова самого человека. По разные стороны кольца
 * спутать их нельзя: слева читают, что значат буквы, справа — что было в
 * этот день. Не хватило места напротив — заметки в кольце просто нет: на
 * сетке о ней говорит уголок клетки, как и говорил.
 *
 * По высоте обе подписи держатся того края, к которому ближе день: у дня
 * вверху экрана — верха, внизу — низа, посередине — середины. Это вместо
 * подсчёта их собственной высоты: высоту пришлось бы мерить после
 * отрисовки, то есть рисовать дважды, и на второй раз подпись прыгала бы
 * на глазах.
 *
 * Не встал сбоку (телефон, где кольцо занимает половину ширины) — значит
 * под кольцом или над ним, во всю ширину и в два столбца: восемь строк
 * столбиком под кольцом на телефоне не помещаются. Заметка тогда уходит на
 * другую сторону по вертикали — над кольцом, если перечень под ним.
 */
function placeAside(
  spot: Spot,
  step: number,
  around: readonly { col: number; row: number }[],
): { legend: LegendPlace; note: LegendPlace | null } {
  const half = spot.size / 2;
  const cols = around.map((place) => place.col);
  const rows = around.map((place) => place.row);
  const left = spot.x - half + Math.min(...cols) * step;
  const right = spot.x + half + Math.max(...cols) * step;
  const top = spot.y - half + Math.min(...rows) * step;
  const bottom = spot.y + half + Math.max(...rows) * step;

  const third = window.innerHeight / 3;
  const align =
    spot.y < third
      ? "flex-start"
      : spot.y > window.innerHeight - third
        ? "flex-end"
        : "center";

  const roomLeft = left - LEGEND_GAP - SCREEN_EDGE;
  const roomRight = window.innerWidth - right - LEGEND_GAP - SCREEN_EDGE;

  if (Math.max(roomLeft, roomRight) >= LEGEND_LEAST) {
    const onRight = roomRight >= roomLeft;
    const room = onRight ? roomRight : roomLeft;
    const other = onRight ? roomLeft : roomRight;
    const width = Math.min(LEGEND_WIDTH, room);
    const noteWidth = Math.min(LEGEND_WIDTH, other);
    const column = (side: "left" | "right", size: number): CSSProperties => ({
      left: side === "right" ? right + LEGEND_GAP : left - LEGEND_GAP - size,
      top: SCREEN_EDGE,
      height: window.innerHeight - SCREEN_EDGE * 2,
      width: size,
      justifyContent: align,
    });
    return {
      legend: { columns: 1, style: column(onRight ? "right" : "left", width) },
      note:
        other >= NOTE_LEAST
          ? { columns: 1, style: column(onRight ? "left" : "right", noteWidth) }
          : null,
    };
  }

  const under = window.innerHeight - bottom - LEGEND_GAP - SCREEN_EDGE;
  const over = top - LEGEND_GAP - SCREEN_EDGE;
  const below = under >= over;
  const band = (side: "below" | "above"): CSSProperties => ({
    left: SCREEN_EDGE,
    width: window.innerWidth - SCREEN_EDGE * 2,
    ...(side === "below"
      ? { top: bottom + LEGEND_GAP, maxHeight: under }
      : { bottom: window.innerHeight - top + LEGEND_GAP, maxHeight: over }),
    justifyContent: side === "below" ? "flex-start" : "flex-end",
  });
  return {
    legend: { columns: 2, style: band(below ? "below" : "above") },
    note:
      (below ? over : under) >= NOTE_LEAST
        ? { columns: 1, style: band(below ? "above" : "below") }
        : null,
  };
}

export function DayRing({
  day,
  kind,
  profile,
  onChange,
  onClose,
}: {
  /** Сутки, вокруг которых стоит кольцо. `null` — кольца нет. */
  day: IsoDate | null;
  kind: DayRingKind;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onClose: () => void;
}) {
  // Кольцо живёт только по нажатию, то есть заведомо в браузере: при сборке
  // страницы `day` пуст, и до портала дело не доходит. Проверка на документ
  // — не перестраховка, а условие статической сборки: `document.body` там
  // не существует вовсе.
  if (day === null || typeof document === "undefined") return null;

  // Через портал, а не на месте: раздел с сеткой поднят сдвигом
  // (`-translate-y-2` в `workspace.tsx`), а любой `transform` у предка
  // заводит новую систему отсчёта для `position: fixed` — кольцо уехало бы
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

/** Где стоит клетка: её середина и сторона квадрата. */
interface Spot {
  x: number;
  y: number;
  size: number;
}

/** Прямоугольник на экране — то, что страница НЕ гасит. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
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
  /**
   * Квадрат под курсором — он же строка, горящая в перечне видов.
   *
   * Одно состояние на обе половины нарочно: знак и название — это один и
   * тот же ответ, и показывать их связь надо сразу с двух сторон. Ставится
   * оно и наведением на строку перечня: подвёл к названию — загорелся
   * квадрат в кольце.
   */
  const [hovered, setHovered] = useState<number | null>(null);
  /** Правка заметки: окно вместо кольца — строка в квадрат не встаёт. */
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(profile.dayNotes[day] ?? "");
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
   * Кольцо стоит ровно на клетке — и остаётся на ней при прокрутке.
   *
   * Клетка ищется по примете `data-day`, той же, которой её находит перенос
   * смены (`use-shift-drag.ts`). Уехала за край окна — кольцу не за что
   * держаться, и оно закрывается.
   *
   * Середина кольца — середина клетки, и другой она не бывает: у края окна
   * сдвигается не кольцо, а места в нём (`placesAround`).
   *
   * --- Первый замер — особый --------------------------------------------
   *
   * Почти всегда кольцо открывают нажатием по клетке, то есть по тому, что
   * человек видит. Но есть и второй путь: строка в перечне внесённых
   * изменений («12 марта, больничный»), и оттуда сутки могут оказаться в
   * любом конце года — за нижним краем страницы, а то и в ещё не
   * отрисованной сетке, которая в этот миг только проявляется.
   *
   * Поэтому в первый раз кольцо не закрывается, а ждёт клетку кадр за
   * кадром и, дождавшись, подводит её к середине экрана. Закрываться из-за
   * того, что день оказался не в поле зрения, оно начинает потом — когда
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
        // Сетки ещё нет. Ждём её, пока есть терпение: без клетки кольцу
        // негде стоять, и рисовать оно ничего не станет.
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
      setSpot({
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        size: Math.max(Math.round(box.width), LEAST_CELL),
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
   * Esc закрывает кольцо.
   *
   * Нажатия мимо ловит само затемнение (`Scrim`) — своим слоем, а не
   * слушателем на документе: погашенная страница обязана быть неактивной, а
   * слушатель только ДОБАВЛЯЛ бы закрытие к чужому нажатию, не отменяя его.
   *
   * Пока открыто окно срока или заметки, кольца нет, и Esc принадлежит
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
   * Фокус в поле заметки — после того, как окно открылось.
   *
   * `showModal()` уводит фокус на первое, за что в окне можно зацепиться,
   * то есть на крестик, и родной `autoFocus` до этого мига не доживает:
   * поле появляется раньше, чем окно открывают. Этот эффект стоит в
   * РОДИТЕЛЕ окна, а родительские эффекты выполняются после его
   * собственных — значит, последнее слово о фокусе остаётся за ним.
   */
  useEffect(() => {
    if (!noting) return;
    document.getElementById("day-ring-note")?.focus();
  }, [noting]);

  const shift = shiftOn(profile, day);
  const lawful = statutoryCalendar(profile.accountingYear).get(day) ?? "working";
  const effective = profile.calendarOverrides[day] ?? lawful;
  const hasAbsence = (absence: AbsenceKind) =>
    profile.absences.some(
      (item) => item.kind === absence && item.startsOn <= day && day <= item.endsOn,
    );
  // Вид здесь не спрашивается нарочно: выход сверх графика в кольце один, а
  // пять старых видов (соревнования, сбор, резерв, праздник, выборы)
  // встречаются только в прежних профилях. Квадрат «Вызов» обязан видеть и
  // их — иначе на таком дне он предложил бы поставить второй выход поверх
  // первого (см. `withCalloutToggled`).
  const hasCallout = () =>
    profile.callouts.some(
      (item) => item.startsOn <= day && day <= item.endsOn,
    );

  /**
   * Выбор сделан — кольцо уходит.
   *
   * Кроме того, что длится: там кольцо тоже уходит, но следом открывается
   * окно срока, и закрыть кольцо нельзя — окно рисуется отсюда и ушло бы
   * вместе с ним. Уходит оно с виду: квадраты и затемнение не рисуются,
   * пока окно открыто.
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

  function commitNote() {
    onChange((previous) => withNoteAt(previous, day, note));
    onClose();
  }

  /** Срок назван: продлить ту же запись, а не завести вторую. */
  function commitSpan() {
    if (asking === null) return;
    const { slot, endsOn, hours } = asking;
    if (slot.kind === "absence") {
      onChange((previous) => withAbsenceUntil(previous, day, slot.absence, endsOn));
      onClose();
      return;
    }
    if (slot.kind === "callout") {
      const parsed = parseHours(hours);
      // Больше суток в сутках не бывает, и ноль часов — это не вызов.
      if (parsed === null || parsed.lessThanOrEqualTo(0) || parsed.greaterThan(24)) {
        return;
      }
      onChange((previous) =>
        withCalloutUntil(previous, day, slot.callout, endsOn, parsed.toString()),
      );
    }
    onClose();
  }

  if (spot === null) {
    // Первый кадр: место клетки ещё не измерено. Рисовать нечего — но и
    // мигать нечем, замер идёт до отрисовки (`useLayoutEffect`).
    return null;
  }

  const step = spot.size + RING_GAP;
  // Отгул берут вместо смены: на свободных по графику сутках его в кольце
  // нет. Стоит он последним — и убыль никого не двигает с места.
  const ring = (
    kind === "calendar"
      ? CALENDAR_RING
      : shift
        ? SHIFT_RING
        : SHIFT_RING.filter(
            (slot) =>
              !(slot.kind === "absence" && slot.absence === "time_off_in_lieu"),
          )
  ) as readonly Slot[];
  const around = placesAround(spot, step);
  const places =
    ring.length === CROSS_AND_CORNER.length
      ? CROSS_AND_CORNER.map((index) => around[index]!)
      : around;

  // Пока спрашивают срок или пишут заметку, кольца с затемнением нет: их
  // место занял разговор, который начался нажатием в кольце.
  const picking = asking === null && !noting;
  const face = asking === null ? null : faceOf(asking.slot, shift);
  const cellBox = {
    left: spot.x - spot.size / 2,
    top: spot.y - spot.size / 2,
    width: spot.size,
    height: spot.size,
  };
  const faces = ring.map((slot) => faceOf(slot, shift));
  const aside = placeAside(spot, step, around);
  // Записанная заметка, а не та, что человек сейчас набирает: черновик
  // живёт в окне заметки, и кольца в этот миг всё равно нет.
  const storedNote = profile.dayNotes[day] ?? "";

  return (
    <div
      data-day-ring
      role="group"
      aria-label={`Что было ${formatDayMonthRu(day)}`}
    >
      {picking ? (
        <>
          {/* Страница гаснет и размывается, кроме самого дня, и погашенное
              нажатий дальше не пускает: нажал мимо — вернулся к сетке. */}
          <Scrim
            hole={{
              left: cellBox.left - 2,
              top: cellBox.top - 2,
              width: cellBox.width + 4,
              height: cellBox.height + 4,
            }}
            onDismiss={onClose}
          />
          {/* Окошко в затемнении — сам день, и нажатие по нему закрывает
              кольцо.
              -----------------------------------------------------------------
              Раньше за ним стояло полное окно суток: список из двенадцати
              видов, время смены, часы. Кольцо забрало у него всё, ради чего
              его открывали, и окно ушло — остался жест: нажал по дню,
              раскрылось кольцо; нажал по нему же ещё раз — закрылось.
              Погашенная страница закрывает кольцо отовсюду, и день, единственное
              незатемнённое место на ней, не должен быть исключением.

              Накладка нужна потому, что затемнение лежит поверх сетки:
              вырезанное маской окошко видно насквозь, но нажатию через него
              не пройти. */}
          <button
            type="button"
            data-day-ring
            onClick={onClose}
            title="Закрыть"
            aria-label={`Закрыть выбор для ${formatDayMonthRu(day)}`}
            style={cellBox}
            className={cn(
              "fixed z-[115] cursor-pointer rounded-md bg-transparent",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
            )}
          />
          {ring.map((slot, index) => {
            const { col, row } = places[index]!;
            const face = faces[index]!;
            const on =
              slot.kind === "absence"
                ? hasAbsence(slot.absence)
                : slot.kind === "callout"
                  ? hasCallout()
                  : slot.kind === "dayType"
                    ? effective === slot.type
                    : slot.kind === "note"
                      ? (profile.dayNotes[day] ?? "") !== ""
                      : false;
            /**
             * То, что в сутках УЖЕ стоит: нажатие его уберёт.
             *
             * Квадрат в кольце отвечает на вопрос «что сделать», и у
             * отмеченного вида ответ обратный — снять. Так он и называется
             * («Убрать: Больничный»), и так его объявляет программа чтения,
             * не дожидаясь курсора: у неё курсора нет.
             *
             * Только у отсутствий и вызова: у видов дня по календарю
             * снятия нет (день всегда какой-то), у смены нет отметки
             * вовсе, а заметку нажатие открывает править, а не стирает.
             */
            const marked =
              on && (slot.kind === "absence" || slot.kind === "callout");
            /**
             * Под курсором буква уступает место крестику.
             *
             * Буква называет вид, а не действие, и на отмеченном дне она
             * обещает не то, что случится. Крестик — тот же знак, каким
             * приложение убирает правки в перечне изменений, — говорит об
             * этом прямо, и только в тот миг, когда до нажатия остаётся
             * одно движение. Клавиатуре его показывает фокус.
             */
            const erasing = marked && hovered === index;
            return (
              <button
                key={index}
                type="button"
                data-day-ring
                onClick={() => act(slot)}
                // Наведение и отвод — вместе с подписью в перечне видов.
                // Клавиатуре то же самое даёт фокус: кольцо проходится
                // табуляцией так же, как мышью.
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                // У смены состояния нет: она не отметка, а сам график, и
                // квадрат называет то, чего в сутках ещё НЕТ.
                aria-pressed={slot.kind === "shift" ? undefined : on}
                aria-label={marked ? `Убрать: ${face.label}` : face.label}
                title={marked ? `Убрать: ${face.label}` : face.label}
                style={{
                  ...cellBox,
                  // Куда лететь и когда трогаться — считает разметка, а
                  // рисует правило `.day-ring-cell` в `globals.css`.
                  ["--dx" as string]: `${col * step}px`,
                  ["--dy" as string]: `${row * step}px`,
                  ["--delay" as string]: `${index * 16}ms`,
                }}
                className={cn(
                  // Слои страницы: шапка 100, нижняя панель 90, лампа 120.
                  // Кольцо стоит выше затемнения (110) и ниже лампы: гасится
                  // всё, кроме лампы — так же, как это делают окна
                  // (`.scrim` в `globals.css`).
                  "day-ring-cell fixed z-[115] flex cursor-pointer items-center justify-center",
                  "rounded-md border font-mono text-[13px] leading-none shadow-lg",
                  // Цвет, рамка и цвет буквы — из общего словаря сетки: в
                  // кольце вид суток выглядит ровно так, как он будет
                  // выглядеть в клетке, где есть смена.
                  face.tone,
                  // Отмеченное обведено изнутри — тем же чернильным контуром,
                  // каким приложение показывает выбранное. Не яркостью и не
                  // заливкой: и то и другое здесь занято видом суток.
                  on && "outline-2 -outline-offset-2 outline-ink",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                )}
              >
                {/* Уголок заметки — тот же, каким она помечает клетку на
                    сетке: цвет квадрата занят видом суток и там, и здесь. */}
                {face.corner ? (
                  <span
                    aria-hidden
                    className="absolute right-0 top-0 size-0 border-l-4 border-t-4 border-l-transparent border-t-trace"
                  />
                ) : null}
                {erasing ? <X aria-hidden className="size-4" /> : face.mark}
              </button>
            );
          })}
          {/* Словарь этих букв — здесь же, у кольца: легенда страницы под
              затемнением, и доводить до неё взгляд теперь незачем. */}
          <RingLegend
            faces={faces}
            hovered={hovered}
            onHover={setHovered}
            onDismiss={onClose}
            place={aside.legend}
            // Напротив кольца места не нашлось — заметка едет сюда, вниз
            // того же столбца.
            note={aside.note === null ? storedNote : undefined}
          />
          {/* Заметка этих суток — с другой стороны кольца, тем же
              негромким текстом. На сетке от неё виден только уголок в углу
              клетки, и прочесть её можно было, лишь открыв. Раз день
              открыт — она уже ответ на вопрос «а что тут было». */}
          {storedNote !== "" && aside.note !== null ? (
            <RingNote text={storedNote} onDismiss={onClose} place={aside.note} />
          ) : null}
        </>
      ) : null}

      {/* Срок у того, что длится. Отметка уже стоит в клетке — окно
          спрашивает не «отмечать ли», а «по какое число», и закрыть его,
          ничего не назвав, значит согласиться на один день. */}
      <Modal
        open={asking !== null}
        onClose={onClose}
        title={face?.label ?? ""}
        className="w-[min(30rem,calc(100vw-2rem))]"
      >
        {asking === null ? null : (
          <div className="flex flex-col items-center space-y-4">
            <Card>
              <Field id="day-ring-ends" label="По дату включительно">
                <DateField
                  id="day-ring-ends"
                  defaultValue={asking.endsOn}
                  min={day}
                  onChange={(next) =>
                    setAsking({ ...asking, endsOn: next ?? day })
                  }
                />
              </Field>

              {asking.slot.kind === "callout" ? (
                <Field id="day-ring-hours" label="Часов в сутки">
                  <Input
                    id="day-ring-hours"
                    inputMode="decimal"
                    value={asking.hours}
                    onChange={(event) =>
                      setAsking({ ...asking, hours: event.target.value })
                    }
                    className="w-28 font-mono"
                  />
                </Field>
              ) : null}
            </Card>

            <Button type="button" onClick={commitSpan}>
              Готово
            </Button>
          </div>
        )}
      </Modal>

      {/* Заметке нужна строка, а строка в квадрат со стороной в клетку не
          встаёт. Поэтому единственный квадрат кольца, за которым не отметка,
          а окно. */}
      <Modal
        open={noting}
        onClose={onClose}
        title={`Заметка · ${formatDayMonthRu(day)}`}
        className="w-[min(30rem,calc(100vw-2rem))]"
      >
        <div className="flex flex-col items-center space-y-4">
          <Card>
            <Field id="day-ring-note" label="Что было в этот день">
              <Input
                id="day-ring-note"
                value={note}
                maxLength={500}
                placeholder="Например: обещали отгул"
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitNote();
                }}
              />
            </Field>
          </Card>

          <Button type="button" onClick={commitNote}>
            Готово
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Затемнение страницы с окошком.
 *
 * --- Зачем оно кольцу ------------------------------------------------------
 *
 * Кольцо стоит не поверх страницы, а ВНУТРИ неё, между клетками своего же
 * месяца, и от соседних дней его отличает только то, что оно ярче. Пока
 * рядом горит триста шестьдесят пять таких же квадратов, выбор теряется
 * среди них. Погасшая и размытая страница оставляет на виду ровно то, о
 * чём сейчас речь: сам день и кольцо вокруг него. Словарь букв стоит тут
 * же, у кольца (`RingLegend`), и вырезать для него второе окошко больше не
 * нужно.
 *
 * --- Почему маска, а не рамки вокруг --------------------------------------
 *
 * Четыре полосы вокруг клетки — это четыре слоя, которые надо держать
 * сведёнными при каждой прокрутке, а поднять клетку над затемнением нельзя:
 * сетка лежит в сдвинутом разделе (`-translate-y-2` в `workspace.tsx`), и
 * весь он рисуется одним слоем — `z-index` внутри него наружу не действует.
 *
 * Поэтому затемнение одно, сплошное, а окошко в нём ВЫРЕЗАНО маской:
 * прямоугольник клетки вычитается из полного слоя (`exclude`). Тот же
 * приём, что у каймы `lit`, только там вычитается середина, а здесь —
 * место клетки. Размытие следует за маской само: браузер размывает
 * подложку там, где слой РИСУЕТ, а в окошке он не рисует ничего — день
 * остаётся резким.
 *
 * --- Почему слой ловит нажатия --------------------------------------------
 *
 * Маска — дело рисования, а не нажатий: вырезанное окошко видно насквозь,
 * но слой над ним остаётся. Здесь это кстати. Погашенная страница обязана
 * быть неактивной, и слой её такой и делает: нажатие достаётся ему, кольцо
 * закрывается, а кнопка под пальцем не срабатывает — человек возвращается
 * к сетке, не тронув её.
 *
 * Тем же слоем закрыт и день в окошке — но у него сверху своя прозрачная
 * накладка, за которой полное окно суток.
 */
function Scrim({ hole, onDismiss }: { hole: Box; onDismiss: () => void }) {
  // Окошко за краем экрана вырезается НЕ ТАМ, где просят.
  // ---------------------------------------------------------------------
  // Замечено на телефоне ещё когда окошек было два: второе, для легенды,
  // лежало внизу длинной страницы — четыре тысячи точек, то есть далеко за
  // нижней кромкой окна. Браузер такую подложку не отбрасывает, а рисует
  // её где-то у себя, и внизу экрана появлялось светлое пятно шириной с
  // легенду — дырка в затемнении там, где ничего нет.
  //
  // Окошко теперь одно и всегда на виду (кольцо закрывается, стоит клетке
  // уйти за кромку), но обрезка осталась: у самого края окна клетка видна
  // наполовину, и просить вырезать её целиком значит просить о том же
  // самом.
  const shown = {
    left: Math.max(0, hole.left),
    top: Math.max(0, hole.top),
    right: Math.min(window.innerWidth, hole.left + hole.width),
    bottom: Math.min(window.innerHeight, hole.top + hole.height),
  };
  const open = shown.right > shown.left && shown.bottom > shown.top;

  const layer = "linear-gradient(#000 0 0)";
  const image = open ? `${layer}, ${layer}` : layer;
  const size = open
    ? `${Math.ceil(shown.right - shown.left)}px ${Math.ceil(shown.bottom - shown.top)}px, 100% 100%`
    : "100% 100%";
  const position = open
    ? `${Math.floor(shown.left)}px ${Math.floor(shown.top)}px, 0 0`
    : "0 0";

  return (
    <div
      aria-hidden
      data-day-ring-scrim
      // На погружении и с отменой родного поведения: нажатие не должно ни
      // уйти под слой, ни увести фокус со страницы.
      onPointerDown={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      // Размытие вдобавок к темноте: одной темноты мало. Под ней сетка
      // года остаётся сеткой — те же триста шестьдесят пять квадратов, тот
      // же ритм столбцов, — и глаз продолжает её читать. Размытая, она
      // становится фоном: разобрать в ней нечего, и смотреть остаётся
      // только на кольцо. Радиус небольшой: это не занавес, а отступ
      // назад — человек должен видеть, что сетка на месте и он с неё
      // никуда не уходил.
      className="fixed inset-0 z-[110] bg-black/65 backdrop-blur-[3px]"
      style={{
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
 * Перечень видов у кольца: тот же квадрат и рядом его название.
 *
 * --- Почему он здесь, а не внизу страницы ---------------------------------
 *
 * Буквы в кольце короткие, и человек, открывший его впервые, их не знает.
 * Легенда сетки на этот вопрос отвечает — но лежит она в стороне от дня, а
 * на телефоне и вовсе за краем экрана. Ответ, до которого надо
 * прокручивать, не ответ: пока его ищут, забывается вопрос.
 *
 * --- Почему он гаснет, пока никуда не подведён -----------------------------
 *
 * Перечень — подсказка, а не второе кольцо. В полную силу он спорил бы с
 * квадратами за внимание, а нажимают всё-таки в них. Поэтому вполголоса, а
 * при наведении строка наведённого вида разгорается, и разом гаснут
 * остальные: в этот миг человек читает одно название, а не восемь.
 *
 * --- Почему у него нет ни плашки, ни рамки ---------------------------------
 *
 * Плашка была: бумага со светом по кромке, как у окна. И читалась она
 * ровно как окно — второй предмет на экране, у которого своя граница,
 * своя глубина и, значит, своя важность. Но перечень ничего не делает,
 * он подписывает; у подписи границ не бывает. Осталcя один текст на
 * погасшей странице — и на ней он виден без всякой бумаги.
 *
 * Строка под курсором тоже не заливается: она просто разгорается. Заливка
 * здесь означала бы, что в неё можно нажать, — а нажимают в кольцо.
 *
 * Наведение работает и с этой стороны: подвёл к названию — загорелся
 * квадрат в кольце. Связь двусторонняя, потому что и читают её с двух
 * сторон: «что это за буква» и «а где тут больничный».
 *
 * --- Почему нажатие по нему закрывает кольцо -------------------------------
 *
 * Отмечают в кольце, и своей отметки у строки перечня нет. Значит, для
 * нажатия она — такая же погасшая страница, как всё вокруг, и отвечать
 * должна тем же: шагом назад, к сетке.
 */
function RingLegend({
  faces,
  hovered,
  onHover,
  onDismiss,
  place,
  note,
}: {
  faces: readonly Face[];
  hovered: number | null;
  onHover: (index: number | null) => void;
  onDismiss: () => void;
  place: LegendPlace;
  /**
   * Заметка, которой не нашлось места напротив кольца.
   *
   * На телефоне кольцо занимает половину ширины экрана, и вторая сторона
   * — та, где заметке полагается стоять, — уже подписи. Прятать её из-за
   * этого нельзя: она и есть ответ на вопрос, ради которого день открыли.
   * Тогда она встаёт под перечнем, отделённая просветом: столбец один, но
   * читаются они по-прежнему как разные вещи — сверху словарь, снизу
   * слова самого человека.
   */
  note?: string;
}) {
  return (
    // Названия видов уже объявлены самими квадратами (`aria-label`), и
    // второй раз программе чтения они не нужны: для неё это украшение.
    <div
      aria-hidden
      style={place.style}
      className="pointer-events-none fixed z-[115] flex flex-col"
    >
      <div
        data-day-ring
        onPointerDown={(event) => {
          event.preventDefault();
          onDismiss();
        }}
        className="pointer-events-auto min-h-0 overflow-y-auto"
      >
        <ul
          className={cn(
            "grid gap-x-2 gap-y-0.5",
            place.columns === 2 ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {faces.map((face, index) => (
            <li
              key={index}
              onPointerEnter={() => onHover(index)}
              onPointerLeave={() => onHover(null)}
              className={cn(
                "flex items-center gap-2 py-1 transition-opacity duration-150",
                // Вполголоса, пока не спросили; в полный голос — строка,
                // на чей квадрат сейчас смотрят; остальные в этот миг
                // отступают ещё на шаг.
                hovered === null
                  ? "opacity-60"
                  : index === hovered
                    ? "opacity-100"
                    : "opacity-35",
              )}
            >
              <span
                className={cn(
                  "relative flex size-5 shrink-0 items-center justify-center",
                  "rounded-md border font-mono text-[10px] leading-none",
                  face.tone,
                )}
              >
                {face.corner ? (
                  <span
                    aria-hidden
                    className="absolute right-0 top-0 size-0 border-l-[3px] border-t-[3px] border-l-transparent border-t-trace"
                  />
                ) : null}
                {face.mark}
              </span>
              <span className="truncate text-[11px] leading-4 text-ink">
                {face.short ?? face.label}
              </span>
            </li>
          ))}
        </ul>
        {note ? (
          <div className="mt-3 flex gap-2 opacity-70">
            <Pencil aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-faint" />
            <p className="text-[11px] leading-4 text-ink">{note}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Заметка этих суток — с другой стороны кольца.
 *
 * На сетке от заметки виден только уголок в углу клетки: цвет там занят
 * видом суток, и места под текст в клетке размером с палец нет. Прочесть
 * её можно было, лишь открыв день, то есть уйдя с сетки.
 *
 * Но раз день уже открыт кольцом, она — готовый ответ на вопрос «а что тут
 * было»: человек нажал по дню как раз потому, что не помнит. Поэтому она
 * стоит рядом, тем же негромким текстом, что и перечень видов, только
 * напротив него — и карандаш перед ней говорит, чья это строка.
 *
 * Нажатие по ней закрывает кольцо, как и по любому погасшему месту:
 * править заметку — дело квадрата с карандашом, а не самой подписи.
 */
function RingNote({
  text,
  onDismiss,
  place,
}: {
  text: string;
  onDismiss: () => void;
  place: LegendPlace;
}) {
  return (
    <div
      aria-hidden
      style={place.style}
      className="pointer-events-none fixed z-[115] flex flex-col"
    >
      <div
        data-day-ring
        onPointerDown={(event) => {
          event.preventDefault();
          onDismiss();
        }}
        className="pointer-events-auto flex min-h-0 gap-2 overflow-y-auto py-1 opacity-70"
      >
        <Pencil aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-faint" />
        <p className="text-[11px] leading-4 text-ink">{text}</p>
      </div>
    </div>
  );
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
        // кольце место одно на все виды, и оставить квадрат пустым значило
        // бы сделать его единственным неподписанным.
        { mark: "С", tone: SHIFT_TONE, label: "Поставить смену" };
  }
  return {
    mark: <Pencil aria-hidden className="size-4" />,
    tone: RING_NOTE_TONE,
    label: "Заметка к этому дню",
    short: "Заметка",
    corner: true,
  };
}
