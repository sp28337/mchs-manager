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
import {
  shiftOn,
  withAbsenceToggled,
  withAbsenceUntil,
  withCalloutToggled,
  withCalloutUntil,
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
import { ABSENCE_MARK, CALLOUT_MARK, DAY_OFF_MARK } from "./day-marks";
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

/** Часы вызова по умолчанию: обычная смена. */
const DEFAULT_CALLOUT_HOURS = "8";

/**
 * Цвет квадратов кольца — в полную силу, а не вполголоса.
 *
 * В клетке сетки у вида суток заливка приглушённая (`day-marks.ts`,
 * `*-soft`): там она лежит под числом и буквой, и спорить с ними ей
 * нельзя. Здесь наоборот: квадрат — это не день, а ПРЕДЛОЖЕНИЕ, и
 * читаться он должен первым. Взятая с клетки, приглушённая заливка
 * делала кольцо блёклым — теми самыми полутонами, какими сетка помечает
 * выходные.
 *
 * Поэтому здесь сам цвет вида, разбавленный на треть: он заметно ярче
 * `*-soft` и при этом не спорит с чернильной буквой поверх него.
 * Рамка сплошная, а не пунктирная: пунктир на сетке означает «смена была,
 * но не состоялась», а у предложения такого свойства нет.
 */
const RING_TONE: Record<AbsenceKind, string> = {
  annual_leave: "border-signal/70 bg-signal/30",
  extra_leave: "border-trip/70 bg-trip/30",
  sick_leave: "border-sick/70 bg-sick/30",
  time_off_in_lieu: "border-rest/70 bg-rest/30",
  study_leave: "border-study/70 bg-study/30",
};

const RING_CALLOUT_TONE = "border-trace/70 bg-trace/30";
const RING_SHIFT_TONE = "border-verify/70 bg-verify/40";
const RING_DAY_OFF_TONE = "border-ink-faint/60 bg-paper-raised";
const RING_NOTE_TONE = "border-rule-strong bg-paper-sunken";

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
  { kind: "absence", absence: "study_leave" },
  { kind: "absence", absence: "time_off_in_lieu" },
  { kind: "absence", absence: "sick_leave" },
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
  /** Где стоит легенда: её страница не гасит (см. `Scrim`). */
  const [legend, setLegend] = useState<Box | null>(null);
  /** Правка заметки: поле под кольцом вместо восьмого квадрата. */
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
      const panel = document.querySelector<HTMLElement>("[data-shift-legend]");
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
   * Нажатие мимо закрывает кольцо — но не нажатие по самой клетке.
   *
   * Прозрачного слоя во весь экран здесь нет нарочно: он перехватил бы
   * нажатие по дню, а второе нажатие по нему открывает полное окно.
   * Поэтому слушатель на документе, и своё он пропускает: квадраты кольца
   * (`data-day-ring`) и клетку, вокруг которой оно стоит.
   */
  useEffect(() => {
    function outside(event: PointerEvent) {
      // Пока спрашивают срок, нажатия принадлежат окну: закрыв кольцо, мы
      // унесли бы окно вместе с ним — оно рисуется отсюда.
      if (asking !== null) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-day-ring]") !== null) return;
      if (target.closest(`[data-day="${day}"]`) !== null) return;
      onClose();
    }
    function onKey(event: KeyboardEvent) {
      // Esc при открытом окне срока закрывает окно, а не кольцо: этим
      // занимается само окно.
      if (event.key === "Escape" && asking === null) onClose();
    }
    // На погружении: пока нажатие не дошло до цели. Иначе кольцо закрылось
    // бы уже после того, как чужая кнопка на него ответила.
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [day, onClose, asking]);

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
      const on = hasAbsence(slot.absence);
      onChange((previous) => withAbsenceToggled(previous, day, slot.absence));
      // Снятое не спрашивает ни о чём: срок у того, чего в сутках больше
      // нет, назначать не по чему.
      if (!on) setAsking({ slot, endsOn: day, hours: DEFAULT_CALLOUT_HOURS });
      return;
    }
    if (slot.kind === "callout") {
      const on = hasCallout(slot.callout);
      onChange((previous) =>
        withCalloutToggled(previous, day, slot.callout, DEFAULT_CALLOUT_HOURS),
      );
      if (!on) setAsking({ slot, endsOn: day, hours: DEFAULT_CALLOUT_HOURS });
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

  /** Срок назван: продлить ту же запись, а не завести вторую. */
  function commitSpan() {
    if (asking === null) return;
    const { slot, endsOn, hours } = asking;
    if (slot.kind === "absence") {
      onChange((previous) => withAbsenceUntil(previous, day, slot.absence, endsOn));
      setAsking(null);
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
    setAsking(null);
  }

  if (spot === null) {
    // Первый кадр: место клетки ещё не измерено. Рисовать нечего — но и
    // мигать нечем, замер идёт до отрисовки (`useLayoutEffect`).
    return null;
  }

  const step = spot.size + RING_GAP;
  const places = placesAround(spot, step);

  const face = asking === null ? null : faceOf(asking.slot, shift);

  return (
    <div
      data-day-ring
      role="group"
      aria-label={`Что было ${formatDayMonthRu(day)}`}
    >
      {/* Страница гаснет, кроме самого дня и легенды. Пока спрашивают срок,
          гасит окно — своим затемнением, и второе было бы вдвое темнее. */}
      {asking === null ? (
        <Scrim
          holes={[
            {
              left: spot.x - spot.size / 2 - 2,
              top: spot.y - spot.size / 2 - 2,
              width: spot.size + 4,
              height: spot.size + 4,
            },
            ...(legend === null ? [] : [legend]),
          ]}
        />
      ) : null}
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
              // Слои страницы: шапка 100, нижняя панель 90, лампа 120.
              // Кольцо стоит выше затемнения (110) и ниже лампы: гасится
              // всё, кроме лампы — так же, как это делают окна
              // (`.scrim` в `globals.css`).
              "day-ring-cell fixed z-[115] flex cursor-pointer items-center justify-center",
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
          className="lit modal-lift fixed z-[115] w-64 max-w-[calc(100vw-1rem)] rounded-xl bg-paper p-2"
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

      {/* Срок у того, что длится. Отметка уже стоит в клетке — окно
          спрашивает не «отмечать ли», а «по какое число», и закрыть его,
          ничего не назвав, значит согласиться на один день. */}
      <Modal
        open={asking !== null}
        onClose={() => setAsking(null)}
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
 */
function Scrim({ holes }: { holes: readonly Box[] }) {
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
      // Нажатия слой не ловит: закрытие кольца слушает документ, а гасить
      // страницу — не то же самое, что перехватывать её.
      className="fixed inset-0 z-[110] bg-black/65 pointer-events-none"
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
function faceOf(slot: Slot, shift: boolean): { mark: ReactNode; tone: string; label: string } {
  if (slot.kind === "absence") {
    return {
      mark: ABSENCE_MARK[slot.absence],
      tone: RING_TONE[slot.absence],
      label: ABSENCE_LABELS[slot.absence],
    };
  }
  if (slot.kind === "callout") {
    return {
      mark: CALLOUT_MARK[slot.callout],
      tone: RING_CALLOUT_TONE,
      label: CALLOUT_LABELS[slot.callout],
    };
  }
  if (slot.kind === "shift") {
    // Противоположное тому, что стоит в клетке: на рабочем дне предлагается
    // выходной, на выходном — смена. Довод целиком — в шапке файла.
    return shift
      ? { mark: DAY_OFF_MARK, tone: RING_DAY_OFF_TONE, label: "Сделать выходным" }
      : // «С» — смена. На сетке у смены буквы нет (там в клетке часы), но в
        // кольце место одно на все виды, и оставить квадрат пустым значило
        // бы сделать его единственным неподписанным.
        { mark: "С", tone: RING_SHIFT_TONE, label: "Поставить смену" };
  }
  return {
    mark: <Pencil aria-hidden className="size-4" />,
    tone: RING_NOTE_TONE,
    label: "Заметка к этому дню",
  };
}

function clamp(value: number, least: number, most: number): number {
  return Math.min(Math.max(value, least), most);
}
