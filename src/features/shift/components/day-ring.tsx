"use client";

import { Pencil } from "lucide-react";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
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
 * Страница вокруг кольца гаснет, и гаснет не для красоты: пока кольцо
 * открыто, разговор идёт об одном дне, и всё остальное к нему отношения не
 * имеет. Значит, и нажиматься оно не должно. Погашенное ловит нажатие само
 * и не пропускает его дальше: кольцо закрывается, человек возвращается к
 * сетке — и ни соседний день, ни кнопка под пальцем при этом не
 * срабатывают. Нажатие мимо стоит ровно один шаг назад, а не шаг назад и
 * случайную правку заодно.
 *
 * Открытых мест в затемнении два: легенда, по которой эти буквы читают, и
 * сам день. День при этом не просто виден — он нажимается: за ним полное
 * окно со всеми видами, временем и часами.
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
  { kind: "absence", absence: "time_off_in_lieu" },
  { kind: "absence", absence: "sick_leave" },
  { kind: "callout", callout: "callout" },
  { kind: "shift" },
  { kind: "note" },
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
 * Мест вокруг клетки восемь, а видов дня четыре. Разложить четыре по
 * восьми местам подряд значило бы собрать их в одну сторону и оставить
 * полкольца пустым. Крест — сверху, слева, справа, снизу — окружает день
 * ровно и не выделяет ни один из видов местом. Заметка становится в угол:
 * она не вид дня, и стоять с ними в одном ряду ей незачем.
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

export function DayRing({
  day,
  kind,
  profile,
  onChange,
  onClose,
  onOpenEditor,
}: {
  /** Сутки, вокруг которых стоит кольцо. `null` — кольца нет. */
  day: IsoDate | null;
  kind: DayRingKind;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onClose: () => void;
  /** Нажали по самому дню: за кольцом открывается полное окно суток. */
  onOpenEditor: () => void;
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
      onOpenEditor={onOpenEditor}
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

function boxOf(rect: DOMRect): Box {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function Ring({
  day,
  kind,
  profile,
  onChange,
  onClose,
  onOpenEditor,
}: {
  day: IsoDate;
  kind: DayRingKind;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onClose: () => void;
  onOpenEditor: () => void;
}) {
  const [spot, setSpot] = useState<Spot | null>(null);
  /** Где стоит легенда: её страница не гасит (см. `Scrim`). */
  const [legend, setLegend] = useState<Box | null>(null);
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
   */
  useLayoutEffect(() => {
    function place() {
      const cell = document.querySelector<HTMLElement>(`[data-day="${day}"]`);
      if (cell === null) return;
      const box = cell.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) {
        onClose();
        return;
      }
      setSpot({
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        size: Math.max(Math.round(box.width), LEAST_CELL),
      });
      const panel = document.querySelector<HTMLElement>("[data-grid-legend]");
      setLegend(panel === null ? null : boxOf(panel.getBoundingClientRect()));
    }

    place();
    window.addEventListener("resize", place);
    // Третьим доводом `true`: прокручивается не окно, а страница внутри
    // него, и всплытия у события прокрутки нет — ловить его можно только на
    // погружении.
    window.addEventListener("scroll", place, true);
    return () => {
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
  const hasCallout = (callout: CalloutKind) =>
    profile.callouts.some(
      (item) => item.kind === callout && item.startsOn <= day && day <= item.endsOn,
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
      // нет, назначать не по чему.
      if (on) {
        onClose();
        return;
      }
      setAsking({ slot, endsOn: day, hours: DEFAULT_CALLOUT_HOURS });
      return;
    }
    if (slot.kind === "callout") {
      const on = hasCallout(slot.callout);
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
  const ring = kind === "calendar" ? CALENDAR_RING : SHIFT_RING;
  const around = placesAround(spot, step);
  const places =
    ring.length === around.length
      ? around
      : CROSS_AND_CORNER.map((index) => around[index]!);

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

  return (
    <div
      data-day-ring
      role="group"
      aria-label={`Что было ${formatDayMonthRu(day)}`}
    >
      {picking ? (
        <>
          {/* Страница гаснет, кроме самого дня и легенды, и погашенное
              нажатий дальше не пускает: нажал мимо — вернулся к сетке. */}
          <Scrim
            holes={[
              {
                left: cellBox.left - 2,
                top: cellBox.top - 2,
                width: cellBox.width + 4,
                height: cellBox.height + 4,
              },
              ...(legend === null ? [] : [legend]),
            ]}
            onDismiss={onClose}
          />
          {/* Окошко в затемнении — сам день, и он по-прежнему нажимается:
              затемнение лежит поверх сетки и до клетки нажатию не дойти.
              Поэтому прозрачная накладка ровно по клетке: за ней полное
              окно суток — со всеми видами, временем и часами. */}
          <button
            type="button"
            data-day-ring
            onClick={onOpenEditor}
            title="Открыть день целиком"
            aria-label={`Открыть ${formatDayMonthRu(day)} целиком`}
            style={cellBox}
            className={cn(
              "fixed z-[115] cursor-pointer rounded-md bg-transparent",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
            )}
          />
          {ring.map((slot, index) => {
            const { col, row } = places[index]!;
            const face = faceOf(slot, shift);
            const on =
              slot.kind === "absence"
                ? hasAbsence(slot.absence)
                : slot.kind === "callout"
                  ? hasCallout(slot.callout)
                  : slot.kind === "dayType"
                    ? effective === slot.type
                    : slot.kind === "note"
                      ? (profile.dayNotes[day] ?? "") !== ""
                      : false;
            return (
              <button
                key={index}
                type="button"
                data-day-ring
                onClick={() => act(slot)}
                // У смены состояния нет: она не отметка, а сам график, и
                // квадрат называет то, чего в сутках ещё НЕТ.
                aria-pressed={slot.kind === "shift" ? undefined : on}
                aria-label={face.label}
                title={face.label}
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
                {face.mark}
              </button>
            );
          })}
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
 * Затемнение страницы с окошками.
 *
 * --- Зачем оно кольцу ------------------------------------------------------
 *
 * Кольцо стоит не поверх страницы, а ВНУТРИ неё, между клетками своего же
 * месяца, и от соседних дней его отличает только то, что оно ярче. Пока
 * рядом горит триста шестьдесят пять таких же квадратов, выбор теряется
 * среди них. Погасшая страница оставляет на виду ровно то, о чём сейчас
 * речь: сам день, кольцо вокруг него — и легенду, по которой эти буквы и
 * читают.
 *
 * --- Почему маска, а не рамки вокруг --------------------------------------
 *
 * Незатемнённых мест два, и лежат они в разных концах экрана. Четыре
 * полосы вокруг одного из них второе не обходят, а поднять их над
 * затемнением нельзя: сетка лежит в сдвинутом разделе (`-translate-y-2` в
 * `workspace.tsx`), и весь он рисуется одним слоем — `z-index` внутри него
 * наружу не действует.
 *
 * Поэтому затемнение одно, сплошное, а окошки в нём ВЫРЕЗАНЫ маской: два
 * прямоугольника вычитаются из полного слоя (`exclude`). Тот же приём, что
 * у каймы `lit`, только там вычитается середина, а здесь — два места.
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
function Scrim({
  holes,
  onDismiss,
}: {
  holes: readonly Box[];
  onDismiss: () => void;
}) {
  // Окошко за краем экрана вырезается НЕ ТАМ, где просят.
  // ---------------------------------------------------------------------
  // Замечено на телефоне: легенда лежит внизу длинной страницы, её место в
  // окне — четыре тысячи точек, то есть далеко за нижней кромкой. Браузер
  // такую подложку не отбрасывает, а рисует её где-то у себя, и внизу
  // экрана появляется светлое пятно шириной с легенду — дырка в
  // затемнении там, где ничего нет.
  //
  // Поэтому окошки обрезаются по окну, а вышедшие из него целиком
  // выбрасываются: гасить нечего — того, что они открывают, и так не
  // видно.
  const shown = holes
    .map((hole) => ({
      left: Math.max(0, hole.left),
      top: Math.max(0, hole.top),
      right: Math.min(window.innerWidth, hole.left + hole.width),
      bottom: Math.min(window.innerHeight, hole.top + hole.height),
    }))
    .filter((hole) => hole.right > hole.left && hole.bottom > hole.top)
    .map((hole) => ({
      left: hole.left,
      top: hole.top,
      width: hole.right - hole.left,
      height: hole.bottom - hole.top,
    }));

  const layer = "linear-gradient(#000 0 0)";
  const image = [...shown.map(() => layer), layer].join(", ");
  const size = [
    ...shown.map((hole) => `${Math.ceil(hole.width)}px ${Math.ceil(hole.height)}px`),
    "100% 100%",
  ].join(", ");
  const position = [
    ...shown.map((hole) => `${Math.floor(hole.left)}px ${Math.floor(hole.top)}px`),
    "0 0",
  ].join(", ");

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
      className="fixed inset-0 z-[110] bg-black/65"
      style={{
        maskImage: image,
        WebkitMaskImage: image,
        maskSize: size,
        WebkitMaskSize: size,
        maskPosition: position,
        WebkitMaskPosition: position,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskComposite: [...shown.map(() => "exclude"), "add"].join(", "),
        // Старое написание для Safari: `xor` — то же, что `exclude`.
        WebkitMaskComposite: [...shown.map(() => "xor"), "source-over"].join(", "),
      }}
    />
  );
}

/** Буква, цвет и название квадрата. */
function faceOf(
  slot: Slot,
  shift: boolean,
): { mark: ReactNode; tone: string; label: string; corner?: boolean } {
  if (slot.kind === "absence") {
    return {
      mark: ABSENCE_MARK[slot.absence],
      tone: ABSENCE_TONE[slot.absence],
      label: ABSENCE_LABELS[slot.absence],
    };
  }
  if (slot.kind === "callout") {
    return {
      mark: CALLOUT_MARK[slot.callout],
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
    corner: true,
  };
}
