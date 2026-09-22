"use client";

import { Pencil } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  SHIFT_TONE,
} from "./day-marks";

/**
 * Кольцо вокруг клетки: чем эти сутки были на самом деле.
 *
 * --- Почему вокруг дня, а не окном ------------------------------------------
 *
 * Прежде нажатие по клетке открывало окно во весь экран: список из
 * двенадцати видов с флажками, поля времени, вторая дата. Всё это нужно —
 * но не каждый раз. Обычная правка короткая: «здесь был больничный», и
 * ради неё человек уходил с сетки, терял из виду месяц, отмечал галочку и
 * возвращался обратно, чтобы взглядом найти следующий день.
 *
 * Кольцо отвечает на тот же вопрос, не уводя с сетки: восемь квадратов
 * встают вокруг самой клетки, нажатие по любому из них отмечает или
 * снимает вид суток тут же. Месяц остаётся перед глазами, и следующий день
 * — на своём месте.
 *
 * --- Что в кольце и почему именно это ---------------------------------------
 *
 * Пять освобождений от работы (отпуск, доп. отпуск, больничный, отгул,
 * учебный), вызов, смена и заметка. Это всё, что человек отмечает изо дня
 * в день. Пять остальных видов вызова — соревнования, сбор, резерв,
 * праздник, выборы — редки и требуют часов, и живут там, где часы и
 * спрашивают: в полном окне, которое открывается нажатием по самому дню в
 * середине кольца.
 *
 * --- Почему на квадратах только буква ---------------------------------------
 *
 * Число в квадрате назвало бы день, а день здесь один — тот, вокруг
 * которого кольцо, и он написан в середине. Восемь квадратов с одним и тем
 * же числом читались бы восемью днями.
 *
 * Буквы — те самые, что стоят в клетках на сетке и в легенде («О», «Б»,
 * «ВЗ»), и яркость у них одна на все восемь: цвет вида говорит заливкой и
 * рамкой, а буква остаётся чернилами. Разная яркость означала бы разную
 * важность, а её здесь нет — это восемь равных ответов на один вопрос.
 */

/** Часы вызова по умолчанию: обычная смена, правится в полном окне. */
const DEFAULT_CALLOUT_HOURS = "8";

type Slot =
  | { kind: "absence"; absence: AbsenceKind }
  | { kind: "callout"; callout: CalloutKind }
  | { kind: "shift" }
  | { kind: "note" };

/**
 * Девять мест кольца по порядку чтения: слева направо, сверху вниз.
 *
 * В середине — сам день, и это не украшение: он показывает, вокруг чего
 * кольцо, и открывает полное окно.
 *
 * Сверху и по бокам — освобождения от работы, одной семьёй. Снизу то, что
 * к ней не относится: работа помимо графика, сама смена и заметка.
 * Заметка — в правом нижнем углу, дальше всех от отпусков: она ничего не
 * меняет в расчёте, это память о дне, а не его вид.
 */
const LAYOUT: readonly (Slot | "day")[] = [
  { kind: "absence", absence: "annual_leave" },
  { kind: "absence", absence: "extra_leave" },
  { kind: "absence", absence: "sick_leave" },
  { kind: "absence", absence: "time_off_in_lieu" },
  "day",
  { kind: "absence", absence: "study_leave" },
  { kind: "callout", callout: "callout" },
  { kind: "shift" },
  { kind: "note" },
];

export function DayRing({
  day,
  profile,
  onChange,
  onOpenEditor,
  onClose,
}: {
  /** Сутки, вокруг которых стоит кольцо. `null` — кольца нет. */
  day: IsoDate | null;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  /** Открыть полное окно дня — нажатием по самому дню в середине. */
  onOpenEditor: () => void;
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
    <RingPad
      key={day}
      day={day}
      profile={profile}
      onChange={onChange}
      onOpenEditor={onOpenEditor}
      onClose={onClose}
    />,
    document.body,
  );
}

function RingPad({
  day,
  profile,
  onChange,
  onOpenEditor,
  onClose,
}: {
  day: IsoDate;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onOpenEditor: () => void;
  onClose: () => void;
}) {
  const pad = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  /** Правка заметки идёт в том же кольце, на месте квадратов. */
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(profile.dayNotes[day] ?? "");
  /**
   * Строка под кольцом: что человек только что отметил или снял.
   *
   * Буква в квадрате коротка, и первое время её читают по легенде. Строка
   * говорит то же самое словом — и не заранее, а в ответ на нажатие: тогда
   * она объясняет ровно то, что человек сделал.
   */
  const [said, setSaid] = useState<string | null>(null);

  /**
   * Кольцо стоит ровно на клетке — и остаётся на ней при прокрутке.
   *
   * Клетка ищется по примете `data-day`, той же, которой её находит
   * перенос смены (`use-shift-drag.ts`). Уехала за край окна — кольцу не за
   * что держаться, и оно закрывается.
   */
  useLayoutEffect(() => {
    function place() {
      const cell = document.querySelector<HTMLElement>(`[data-day="${day}"]`);
      const box = pad.current;
      if (cell === null || box === null) return;
      const spot = cell.getBoundingClientRect();
      // Клетка ушла за верхний или нижний край — держаться не за что.
      if (spot.bottom < 0 || spot.top > window.innerHeight) {
        onClose();
        return;
      }
      const width = box.offsetWidth;
      const height = box.offsetHeight;
      const edge = 8;
      setAt({
        left: clamp(
          spot.left + spot.width / 2 - width / 2,
          edge,
          Math.max(edge, window.innerWidth - width - edge),
        ),
        top: clamp(
          spot.top + spot.height / 2 - height / 2,
          edge,
          Math.max(edge, window.innerHeight - height - edge),
        ),
      });
    }

    place();
    window.addEventListener("resize", place);
    // Третьим доводом `true`: прокручивается не окно, а страница внутри
    // него, и всплытия у события прокрутки нет — ловить его можно только
    // на погружении.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [day, noting, onClose]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shift = shiftOn(profile, day);
  const absence = (kind: AbsenceKind) =>
    profile.absences.some(
      (item) => item.kind === kind && item.startsOn <= day && day <= item.endsOn,
    );
  const callout = (kind: CalloutKind) =>
    profile.callouts.some(
      (item) => item.kind === kind && item.startsOn <= day && day <= item.endsOn,
    );

  function toggle(slot: Slot) {
    if (slot.kind === "absence") {
      const on = absence(slot.absence);
      onChange((previous) => withAbsenceToggled(previous, day, slot.absence));
      setSaid(`${ABSENCE_LABELS[slot.absence]} — ${on ? "снят" : "отмечен"}`);
      return;
    }
    if (slot.kind === "callout") {
      const on = callout(slot.callout);
      onChange((previous) =>
        withCalloutToggled(previous, day, slot.callout, DEFAULT_CALLOUT_HOURS),
      );
      setSaid(`${CALLOUT_LABELS[slot.callout]} — ${on ? "снят" : "отмечен"}`);
      return;
    }
    if (slot.kind === "shift") {
      onChange((previous) => withShiftAt(previous, day, !shift));
      setSaid(shift ? "Смена снята — выходной" : "Смена отмечена");
      return;
    }
    setNoting(true);
  }

  function commitNote() {
    onChange((previous) => withNoteAt(previous, day, note));
    setNoting(false);
    setSaid(note.trim() === "" ? "Заметка убрана" : "Заметка записана");
  }

  return (
    <>
      {/* Нажатие мимо закрывает кольцо. Слой прозрачный: затемнять страницу
          незачем — кольцо не окно, а продолжение клетки, и месяц вокруг
          должен остаться видимым. */}
      <div
        aria-hidden
        onPointerDown={onClose}
        className="fixed inset-0 z-50"
      />
      <div
        ref={pad}
        role="dialog"
        aria-label={`Что было ${formatDayMonthRu(day)}`}
        style={{ left: at?.left ?? 0, top: at?.top ?? 0, visibility: at === null ? "hidden" : undefined }}
        className={cn(
          "lit modal-lift fixed z-50 rounded-xl bg-paper p-2",
          noting ? "w-64" : "w-auto",
        )}
      >
        {noting ? (
          <div className="space-y-2">
            {/* Какой день правится, видно и здесь: квадраты с числом в
                середине на время правки уступили место полю, и без этой
                строки заметка писалась бы вслепую. */}
            <p className="px-0.5 text-[11px] leading-4 text-ink-muted">
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
            <Button type="button" size="sm" className="w-full" onClick={commitNote}>
              Готово
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {LAYOUT.map((slot, index) =>
                slot === "day" ? (
                  <button
                    key="day"
                    type="button"
                    onClick={onOpenEditor}
                    title="Открыть день целиком: время, сроки, все виды"
                    aria-label="Открыть день целиком"
                    className={cn(
                      "flex size-11 cursor-pointer flex-col items-center justify-center rounded-md",
                      "bg-paper-sunken font-mono text-sm text-ink",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                    )}
                  >
                    {Number(day.slice(8, 10))}
                  </button>
                ) : (
                  <RingCell
                    key={index}
                    slot={slot}
                    on={
                      slot.kind === "absence"
                        ? absence(slot.absence)
                        : slot.kind === "callout"
                          ? callout(slot.callout)
                          : slot.kind === "shift"
                            ? shift
                            : (profile.dayNotes[day] ?? "") !== ""
                    }
                    onToggle={() => toggle(slot)}
                  />
                ),
              )}
            </div>
            {/* Строка одной высоты и в покое, и с ответом: без неё кольцо
                подпрыгивало бы на каждом нажатии. */}
            <p className="mt-1.5 h-4 truncate px-0.5 text-center text-[11px] leading-4 text-ink-muted">
              {said ?? formatDayMonthRu(day)}
            </p>
          </>
        )}
      </div>
    </>
  );
}

/** Квадрат кольца: буква вида, цвет вида, чернильная буква у всех. */
function RingCell({
  slot,
  on,
  onToggle,
}: {
  slot: Slot;
  on: boolean;
  onToggle: () => void;
}) {
  const { mark, tone, label } = faceOf(slot);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-11 cursor-pointer items-center justify-center rounded-md border",
        "font-mono text-[13px] leading-none",
        tone,
        // Буква — чернилами у всех восьми: цвет вида уже сказан заливкой и
        // рамкой, и повторять его буквой значило бы делать одни виды
        // бледнее других на ровном месте.
        "text-ink",
        // Отмеченное обведено изнутри — тем же чернильным контуром, каким
        // приложение показывает выбранное. Не яркостью и не заливкой:
        // и то и другое здесь уже занято видом суток.
        on && "outline-2 -outline-offset-2 outline-ink",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
      )}
    >
      {mark}
    </button>
  );
}

function faceOf(slot: Slot): { mark: React.ReactNode; tone: string; label: string } {
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
    // «С» — смена. На сетке у смены буквы нет (там в клетке часы), но в
    // кольце место одно на все виды, и оставить квадрат пустым значило бы
    // сделать его единственным неподписанным.
    return { mark: "С", tone: SHIFT_TONE, label: "Смена по графику" };
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
