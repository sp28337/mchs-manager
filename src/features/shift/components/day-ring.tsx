"use client";

import { Pencil } from "lucide-react";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

import { formatDayMonthRu } from "../domain/format";
import type { IsoDate } from "../domain/plain-date";
import {
  shiftOn,
  withAbsenceToggled,
  withCalloutToggled,
  withNoteAt,
  withShiftAt,
} from "../model/derive";
import {
  ABSENCE_LABELS,
  CALLOUT_LABELS,
  type AbsenceKind,
  type CalloutKind,
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
 * Теперь клетка остаётся на месте и остаётся видимой: восемь квадратов
 * распускаются вокруг неё, по восьми соседним местам сетки, и каждый —
 * размером с саму клетку. Отметка ложится в клетку тут же, у человека на
 * глазах, и подтверждать её нечем и незачем: он видит, что день стал
 * больничным.
 *
 * --- Почему они вылетают, а не появляются ------------------------------------
 *
 * Восемь квадратов, возникших разом, читаются новым слоем поверх сетки —
 * тем же окном, только без рамки. Вылетая из клетки, они читаются её
 * продолжением: это её собственные ответы, и вернутся они туда же.
 * Движение короткое (200 мс) и с небольшим запаздыванием друг за другом —
 * столько, чтобы глаз успел заметить, откуда они. При отключённой анимации
 * (`prefers-reduced-motion`) общее правило страницы сводит его к мгновению.
 *
 * --- Что в кольце и почему именно это ----------------------------------------
 *
 * Пять освобождений от работы (отпуск, доп. отпуск, больничный, отгул,
 * учебный), вызов, смена-или-выходной и заметка. Это всё, что человек
 * отмечает изо дня в день. Пять остальных видов вызова — соревнования,
 * сбор, резерв, праздник, выборы — редки и требуют часов, и живут там, где
 * часы и спрашивают: в полном окне, которое открывается повторным нажатием
 * по самому дню.
 *
 * --- Почему в квадрате смены стоит ПРОТИВОПОЛОЖНОЕ ---------------------------
 *
 * Семь квадратов — отметки: нажал, и в сутках появилось то, чего не было.
 * Восьмой не отмечает ничего нового, он правит сам график, и у него есть
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
 * Буквы — те самые, что стоят в клетках на сетке и в легенде («О», «Б»,
 * «ВЗ»), и яркость у них одна на все восемь: цвет вида говорит заливкой и
 * рамкой, а буква остаётся чернилами. Разная яркость означала бы разную
 * важность, а её здесь нет — это восемь равных ответов на один вопрос.
 */

/** Часы вызова по умолчанию: обычная смена, правятся в полном окне. */
const DEFAULT_CALLOUT_HOURS = "8";

/** Не мельче этого квадрат не бывает: в цель меньше пальца не попадают. */
const LEAST_CELL = 34;

/** Просвет между клеткой и кольцом — тот же, что между клетками сетки. */
const RING_GAP = 4;

type Slot =
  | { kind: "absence"; absence: AbsenceKind }
  | { kind: "callout"; callout: CalloutKind }
  | { kind: "shift" }
  | { kind: "note" };

/**
 * Восемь видов в порядке чтения: слева направо, сверху вниз.
 *
 * Сверху и по бокам — освобождения от работы, одной семьёй. Снизу то, что
 * к ней не относится: работа помимо графика, сам график и заметка. Заметка
 * — последней, дальше всех от отпусков: она ничего не меняет в расчёте,
 * это память о дне, а не его вид.
 *
 * Места здесь нет нарочно: его считает `placesAround` — по тому, сколько
 * бумаги осталось вокруг клетки до края окна.
 */
const RING: readonly Slot[] = [
  { kind: "absence", absence: "annual_leave" },
  { kind: "absence", absence: "extra_leave" },
  { kind: "absence", absence: "sick_leave" },
  { kind: "absence", absence: "time_off_in_lieu" },
  { kind: "absence", absence: "study_leave" },
  { kind: "callout", callout: "callout" },
  { kind: "shift" },
  { kind: "note" },
];

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
  profile,
  onChange,
  onClose,
}: {
  /** Сутки, вокруг которых стоит кольцо. `null` — кольца нет. */
  day: IsoDate | null;
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
    <Ring key={day} day={day} profile={profile} onChange={onChange} onClose={onClose} />,
    document.body,
  );
}

/** Где стоит клетка: её середина и сторона квадрата. */
interface Spot {
  x: number;
  y: number;
  size: number;
}

function Ring({
  day,
  profile,
  onChange,
  onClose,
}: {
  day: IsoDate;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onClose: () => void;
}) {
  const [spot, setSpot] = useState<Spot | null>(null);
  /** Правка заметки: поле под кольцом вместо восьмого квадрата. */
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(profile.dayNotes[day] ?? "");

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
   * Нажатие мимо закрывает кольцо — но не нажатие по самой клетке.
   *
   * Прозрачного слоя во весь экран здесь нет нарочно: он перехватил бы
   * нажатие по дню, а второе нажатие по нему открывает полное окно.
   * Поэтому слушатель на документе, и своё он пропускает: квадраты кольца
   * (`data-day-ring`) и клетку, вокруг которой оно стоит.
   */
  useEffect(() => {
    function outside(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-day-ring]") !== null) return;
      if (target.closest(`[data-day="${day}"]`) !== null) return;
      onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    // На погружении: пока нажатие не дошло до цели. Иначе кольцо закрылось
    // бы уже после того, как чужая кнопка на него ответила.
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [day, onClose]);

  const shift = shiftOn(profile, day);
  const hasAbsence = (kind: AbsenceKind) =>
    profile.absences.some(
      (item) => item.kind === kind && item.startsOn <= day && day <= item.endsOn,
    );
  const hasCallout = (kind: CalloutKind) =>
    profile.callouts.some(
      (item) => item.kind === kind && item.startsOn <= day && day <= item.endsOn,
    );

  function act(slot: Slot) {
    if (slot.kind === "absence") {
      onChange((previous) => withAbsenceToggled(previous, day, slot.absence));
      return;
    }
    if (slot.kind === "callout") {
      onChange((previous) =>
        withCalloutToggled(previous, day, slot.callout, DEFAULT_CALLOUT_HOURS),
      );
      return;
    }
    if (slot.kind === "shift") {
      onChange((previous) => withShiftAt(previous, day, !shift));
      return;
    }
    setNoting(true);
  }

  function commitNote() {
    onChange((previous) => withNoteAt(previous, day, note));
    setNoting(false);
  }

  if (spot === null) {
    // Первый кадр: место клетки ещё не измерено. Рисовать нечего — но и
    // мигать нечем, замер идёт до отрисовки (`useLayoutEffect`).
    return null;
  }

  const step = spot.size + RING_GAP;
  const places = placesAround(spot, step);

  return (
    <div
      data-day-ring
      role="group"
      aria-label={`Что было ${formatDayMonthRu(day)}`}
    >
      {RING.map((slot, index) => {
        const { col, row } = places[index]!;
        const face = faceOf(slot, shift);
        const on =
          slot.kind === "absence"
            ? hasAbsence(slot.absence)
            : slot.kind === "callout"
              ? hasCallout(slot.callout)
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
              left: spot.x - spot.size / 2,
              top: spot.y - spot.size / 2,
              width: spot.size,
              height: spot.size,
              // Куда лететь и когда трогаться — считает разметка, а
              // рисует правило `.day-ring-cell` в `globals.css`.
              ["--dx" as string]: `${col * step}px`,
              ["--dy" as string]: `${row * step}px`,
              ["--delay" as string]: `${index * 16}ms`,
            }}
            className={cn(
              "day-ring-cell fixed z-50 flex cursor-pointer items-center justify-center",
              "rounded-md border font-mono text-[13px] leading-none shadow-lg",
              face.tone,
              // Буква — чернилами у всех восьми: цвет вида уже сказан
              // заливкой и рамкой, и повторять его буквой значило бы делать
              // одни виды бледнее других на ровном месте.
              "text-ink",
              // Отмеченное обведено изнутри — тем же чернильным контуром,
              // каким приложение показывает выбранное. Не яркостью и не
              // заливкой: и то и другое здесь занято видом суток.
              on && "outline-2 -outline-offset-2 outline-ink",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
            )}
          >
            {face.mark}
          </button>
        );
      })}

      {noting ? (
        // Заметке нужна строка, а строка не встаёт в квадрат со стороной в
        // клетку. Поэтому поле раскрывается под кольцом — единственное во
        // всём кольце, у чего есть своя плашка.
        <div
          data-day-ring
          className="lit modal-lift fixed z-50 w-64 max-w-[calc(100vw-1rem)] rounded-xl bg-paper p-2"
          style={{
            left: clamp(spot.x - 128, 8, Math.max(8, window.innerWidth - 264)),
            top: Math.min(
              spot.y + step + spot.size / 2 + 8,
              Math.max(8, window.innerHeight - 120),
            ),
          }}
        >
          <p className="px-0.5 pb-2 text-[11px] leading-4 text-ink-muted">
            Заметка · {formatDayMonthRu(day)}
          </p>
          <Input
            autoFocus
            value={note}
            maxLength={500}
            placeholder="Например: обещали отгул"
            aria-label={`Заметка к ${formatDayMonthRu(day)}`}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitNote();
              if (event.key === "Escape") setNoting(false);
            }}
          />
          <Button type="button" size="sm" className="mt-2 w-full" onClick={commitNote}>
            Готово
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Буква, цвет и название квадрата. */
function faceOf(slot: Slot, shift: boolean): { mark: ReactNode; tone: string; label: string } {
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
    tone: "border-rule-strong bg-paper-sunken",
    label: "Заметка к этому дню",
  };
}

function clamp(value: number, least: number, most: number): number {
  return Math.min(Math.max(value, least), most);
}
