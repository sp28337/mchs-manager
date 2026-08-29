"use client";

import { Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Card, Field } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { formatHoursTrim, parseHours } from "../domain/decimal";
import { formatDateRu, formatDayMonthRu } from "../domain/format";
import { addDays, type IsoDate } from "../domain/plain-date";
import { statutoryCalendar } from "../domain/production-calendar";
import {
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  SHIFT_MINUTES,
  minutesToHours,
  parseTimeOfDay,
  shiftMinutes,
  spanFrom,
  spanMinutes,
  type ShiftSpan,
} from "../domain/shift-hours";
import {
  ABSENCE_KIND_BASIS,
  CALLOUT_KIND_BASIS,
} from "../domain/value-objects";
import {
  scheduleSpanAt,
  scheduledByPattern,
  shiftOn,
  shiftSpanAt,
  withShiftAt,
  withShiftTimeAt,
} from "../model/derive";
import {
  ABSENCE_MARK,
  ABSENCE_TONE,
  CALLOUT_MARK,
  CALLOUT_TONE,
  DAY_OFF_MARK,
  DAY_OFF_TONE,
  SHIFT_TONE,
} from "./day-marks";
import { HoursField } from "./hours-field";
import { TimeField } from "./time-field";
import {
  ABSENCE_EFFECT,
  ABSENCE_LABELS,
  CALLOUT_LABELS,
  DAY_TYPES,
  DAY_TYPE_EFFECT,
  DAY_TYPE_LABELS,
  type AbsenceKind,
  type CalloutKind,
  type DayType,
} from "../schemas";
import type { StoredProfile } from "../storage/profile";
import { DateField } from "./date-field";

/**
 * Что стоит в этих сутках — окно правки одного дня.
 *
 * --- Почему правка идёт от дня, а не от списка ---------------------------
 *
 * Раньше отпуска и вызовы вносились формами в боковой колонке: выбери вид,
 * набери две даты, нажми «Добавить». Человек при этом смотрел в календарь
 * — он ищет в нём тот самый день, из-за которого спорит, — и переносил
 * дату оттуда в форму глазами. Лишний перенос, в котором и ошибаются.
 *
 * Теперь наоборот: нашёл день, нажал, сказал, что в нём было. Дата не
 * набирается вообще — она уже известна, это тот день, по которому нажали.
 *
 * --- Почему вторая дата спрашивается не всегда ---------------------------
 *
 * Отпуск и больничный — периоды, и спрашивать их конец обязательно.
 * Вызов на соревнования тоже бывает на несколько суток, но чаще на одни, и
 * поле подставлено тем же днём: согласиться быстрее, чем набрать.
 *
 * --- Почему вопрос зависит от сетки --------------------------------------
 *
 * Вопросов в этих сутках два, и они про разное. «Что это за день по
 * календарю» — про календарь ПРОИЗВОДСТВЕННЫЙ, общий для всей страны:
 * праздник, предпраздничный, выходной. «Что в этот день» — про самого
 * человека: отпуск, больничный, вызов.
 *
 * Сначала оба стояли в окне всегда, на какой бы сетке ни нажали, — по
 * рассуждению «сутки одни и те же». На экране это вышло иначе: человек,
 * пришедший отметить отпуск, первым видел список видов дня, к отпуску
 * никакого отношения не имеющий, и должен был через него перешагнуть.
 * Причём с риском: список показывает текущее значение, и достаточно
 * задеть его, чтобы записать правку производственного календаря,
 * собираясь внести больничный.
 *
 * Поэтому вопрос задаёт та сетка, на которой нажали, — она и есть выбор
 * человека: на производственном календаре спрашивается вид дня, на
 * графике смен — что в этот день было. Переключатель сеток стоит прямо
 * над ними, и переход от одного вопроса к другому — одно нажатие.
 *
 * Совпадение с законом не хранится: выбрав то, что и так следует из
 * ст. 112 и 95 ТК РФ, человек снимает правку, а не добавляет ещё одну, —
 * иначе счётчик «ваших правок» врал бы, а с ним и вес его утверждений в
 * споре.
 *
 * --- Почему заметка здесь же ---------------------------------------------
 *
 * Разговор об учёте идёт через полгода после событий. «Обещали отгул» —
 * это то, что человек помнит сегодня и не вспомнит потом, и место для
 * этого одно: те сутки, о которых речь. Расчёт заметку не читает, она не
 * влияет ни на один час.
 *
 * Заметка спрашивается на обеих сетках — в отличие от двух вопросов выше,
 * она не про календарь и не про работу, а про память, и день для неё
 * один и тот же, с какой бы сетки его ни открыли.
 */

/** Вид суток, который человек включает в списке: отсутствие или вызов. */
type DayPick = `absence:${AbsenceKind}` | `callout:${CalloutKind}`;

/** Время такого вида: по какое число он длится и сколько часов в сутки. */
interface DayTime {
  endsOn: IsoDate;
  /** Только у вызова: у отсутствия часов нет, поле их не спрашивает. */
  hours: string;
}

const ABSENCE_KINDS = Object.keys(ABSENCE_LABELS) as AbsenceKind[];
const CALLOUT_KINDS = Object.keys(CALLOUT_LABELS) as CalloutKind[];

/** Часы вызова по умолчанию: смена целиком бывает реже, чем полдня. */
const DEFAULT_CALLOUT_HOURS = "8";

/**
 * О чём спрашивать в этих сутках.
 *
 * Совпадает с видом сетки, а не задаётся отдельно: спрашивается то, о чём
 * сетка и есть.
 */
export type DayEditorKind = "calendar" | "shifts";

export interface DayEditorProps {
  /** День, по которому нажали. `null` — окно закрыто. */
  day: IsoDate | null;
  /** С какой сетки открыли: она и решает, о чём спрашивать. */
  kind: DayEditorKind;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onClose: () => void;
}

export function DayEditor({ day, kind, profile, onChange, onClose }: DayEditorProps) {
  // Последние показанные сутки — чтобы окно уходило не пустым.
  //
  // Закрывается окно не мгновенно: оно гаснет за 130 миллисекунд, и всё
  // это время оно на экране. А `day` становится `null` в первый же кадр
  // закрытия — форма и заголовок исчезали, и человек видел, как окно
  // сначала опустошается, а потом гаснет. Ровно то мигание, ради которого
  // плавное закрытие и делалось.
  //
  // Поэтому показывается последнее, что в окне было. На следующем открытии
  // `day` уже другой, и ключ по нему по-прежнему даёт чистые поля.
  const [shown, setShown] = useState<IsoDate | null>(day);
  if (day !== null && day !== shown) setShown(day);

  return (
    <Modal
      open={day !== null}
      onClose={onClose}
      sheet
      title={shown ? formatDayMonthRu(shown) : ""}
    >
      {/* Ключ по дню: открыв второй день подряд, человек обязан увидеть
          чистые поля, а не остатки первого — иначе он запишет их не туда.
          Сброс ключом, а не эффектом: эффект сделал бы лишнюю отрисовку
          ради того, что React умеет сам. */}
      {shown !== null ? (
        <DayForm
          key={shown}
          day={shown}
          kind={kind}
          profile={profile}
          onChange={onChange}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
}

function DayForm({
  day,
  kind,
  profile,
  onChange,
  onClose,
}: {
  day: IsoDate;
  kind: DayEditorKind;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onClose: () => void;
}) {
  const dayTypeId = useId();
  const noteId = useId();

  // Вид дня по закону — то, с чем сравнивается выбор человека.
  const lawful = statutoryCalendar(profile.accountingYear).get(day) ?? "working";
  const effective = profile.calendarOverrides[day] ?? lawful;

  // Смена в этих сутках: по графику или как поправил человек. У пятидневки
  // «по графику» означает «рабочий день по производственному календарю», и
  // ответ на это даёт один общий помощник — иначе окно дня и расчёт могли
  // бы разойтись.
  const onCycle = scheduledByPattern(profile, day);
  const scheduled = shiftOn(profile, day);

  // Что уже отмечено на этих сутках. Ищется по профилю, а не по расчёту:
  // удалять нужно запись целиком, а у расчёта её опознавателя нет.
  const absence = profile.absences.find(
    (item) => item.startsOn <= day && day <= item.endsOn,
  );
  const callouts = profile.callouts.filter(
    (item) => item.startsOn <= day && day <= item.endsOn,
  );

  const [dayType, setDayType] = useState<DayType>(effective);
  const [shift, setShift] = useState(scheduled);
  // Начало и продолжительность держатся врозь и строками — тем же, чем их
  // набирают. Собрать из них промежуток можно в любой миг (`spanFrom`), а
  // разобрать обратно на каждом нажатии значило бы стирать человеку
  // запятую посреди «11,5».
  const [startsAt, setStartsAt] = useState(() => shiftSpanAt(profile, day).startsAt);
  const [durationHours, setDurationHours] = useState(() =>
    spanHoursText(shiftSpanAt(profile, day)),
  );
  /**
   * Что стоит в этих сутках — по видам суток, вместе с временем каждого.
   *
   * Ключ — вид («absence:sick_leave», «callout:reserve»), значение — его
   * период и часы. Заводится тем, что уже записано в профиле: окно
   * открывается НА том, что в сутках есть, а не пустым. Раньше стоявший в
   * сутках вызов правился одним способом — удалить и внести заново, набрав
   * и срок, и часы.
   *
   * Отдельной записью на каждый вид, а не одним выбором на всё окно,
   * потому что в одних сутках их бывает несколько: после смены
   * соревнования, а следом резерв, и у каждого свои часы. С одним выбором
   * включение второго ГАСИЛО первый — на глазах у человека и без всякого
   * объяснения.
   */
  const [draft, setDraft] = useState<Record<string, DayTime>>(() => {
    const seed: Record<string, DayTime> = {};
    if (absence) {
      seed[`absence:${absence.kind}`] = {
        endsOn: absence.endsOn,
        hours: DEFAULT_CALLOUT_HOURS,
      };
    }
    for (const callout of callouts) {
      seed[`callout:${callout.kind}`] = {
        endsOn: callout.endsOn,
        hours: formatHoursTrim(callout.hoursPerDay),
      };
    }
    return seed;
  });
  /**
   * Какое окно времени открыто поверх окна дня.
   *
   * «shift» — начало смены и её продолжительность; вид суток — период и
   * часы. `null` — не открыто ничего.
   */
  const [detail, setDetail] = useState<DayPick | "shift" | null>(null);
  /**
   * О чём говорит оговорка под списком.
   *
   * Видов включено бывает несколько, а оговорка одна: что эти сутки делают
   * с расчётом. Говорит она о последнем тронутом виде — том, из-за
   * которого человек сюда и смотрит. Пока не тронуто ничего, речь о смене
   * или выходном.
   */
  const [spotlight, setSpotlight] = useState<DayPick | null>(null);
  const [note, setNote] = useState(profile.dayNotes[day] ?? "");
  const [error, setError] = useState<string | null>(null);

  // Сутки, в которые дотянулась чужая смена: своей здесь нет, а часы есть.
  // Спрашивается это по ПРЕДЫДУЩЕМУ дню, потому что смена лежит в двух
  // календарных днях, а принадлежит тем суткам, в которые началась.
  const tailFrom = overnightTailFrom(profile, day);

  /** Запись профиля, стоящая за этим видом суток, — если она есть. */
  function storedOf(pick: DayPick) {
    if (pick.startsWith("absence:")) {
      return absence && `absence:${absence.kind}` === pick ? absence : null;
    }
    if (pick.startsWith("callout:")) {
      return callouts.find((item) => `callout:${item.kind}` === pick) ?? null;
    }
    return null;
  }

  /** Убрать запись из профиля. Тумблер выключен — значит этого в сутках нет. */
  function removeStored(stored: { id: string }) {
    onChange((previous) => ({
      ...previous,
      absences: previous.absences.filter((item) => item.id !== stored.id),
      callouts: previous.callouts.filter((item) => item.id !== stored.id),
    }));
  }

  const isAbsence = spotlight?.startsWith("absence:") ?? false;
  const isCallout = spotlight?.startsWith("callout:") ?? false;

  /**
   * Вид дня в производственном календаре.
   *
   * Совпал с законом — правка снимается: список «ваших правок» должен
   * содержать только то, что человек утверждает вопреки закону.
   *
   * На сетке графика вид дня не спрашивается, и записывать здесь нечего:
   * значение в состоянии осталось бы тем, каким его показал закон, и
   * «правка» сводилась бы к перезаписи дня самим собой. Поэтому вне
   * календаря профиль возвращается неизменным.
   */
  function saveDayType(next: StoredProfile): StoredProfile {
    if (kind !== "calendar") return next;
    const calendarOverrides = { ...next.calendarOverrides };
    if (dayType === lawful) delete calendarOverrides[day];
    else calendarOverrides[day] = dayType;
    return { ...next, calendarOverrides };
  }

  /**
   * Смена в этих сутках.
   *
   * Только на сетке графика: на производственном календаре о сменах не
   * спрашивают, и записывать там нечего.
   */
  function saveShift(next: StoredProfile): StoredProfile {
    if (kind !== "shifts") return next;
    const moved = shift === scheduled ? next : withShiftAt(next, day, shift);
    // Часы записываются ПОСЛЕ смены и только к ней: у выходного часов нет,
    // и оставшаяся от прежней смены запись однажды приписала бы чужой
    // распорядок той смене, которая встанет сюда потом.
    return withShiftTimeAt(moved, day, shift ? spanFrom(startsAt, shiftMinutes(durationHours)) : null);
  }

  function saveNote(next: StoredProfile, text: string): StoredProfile {
    const dayNotes = { ...next.dayNotes };
    // Пустая заметка не хранится: иначе профиль обрастал бы пустыми
    // строками на каждом дне, который человек когда-либо открывал.
    if (text.trim() === "") delete dayNotes[day];
    else dayNotes[day] = text.trim();
    return { ...next, dayNotes };
  }

  /**
   * Записать всё, что человек включил и поправил, одним движением.
   *
   * --- Почему всё разом, а не по одному ---------------------------------------
   *
   * Видов в одних сутках бывает несколько, и каждый со своим сроком и
   * часами. Записывать их по мере включения значило бы, что «Отмена» внизу
   * отменяет не всё, а только последнее, — а это худший вид неправды в
   * окне правки. Здесь либо записано всё, либо ничего.
   *
   * Убирание при этом идёт сразу, тумблером, и это не противоречие: убрать
   * — действие законченное и видимое, его результат человек проверяет тут
   * же, на списке «Уже отмечено».
   */
  function submit() {
    const target = day;
    const picks = Object.keys(draft) as DayPick[];

    // Часы и сроки проверяются ДО первой записи: половина внесённого хуже
    // невнесённого — человек уйдёт, будучи уверен, что записано всё.
    const additions: { pick: DayPick; end: IsoDate; hours: string | null }[] = [];

    for (const pick of picks) {
      const time = draft[pick];
      if (!time) continue;
      const end = time.endsOn;
      if (end < target) {
        setError("Дата окончания раньше выбранного дня.");
        return;
      }
      if (pick.startsWith("callout:")) {
        const parsed = parseHours(time.hours);
        // Больше суток в сутках не бывает, и ноль часов — это не вызов.
        if (parsed === null || parsed.lessThanOrEqualTo(0) || parsed.greaterThan(24)) {
          setError("Часы в сутки — число от 0 до 24, например 8 или 4,5.");
          return;
        }
        additions.push({ pick, end, hours: parsed.toString() });
      } else {
        // Пересекающиеся отсутствия запрещены: смена, попавшая и в отпуск,
        // и в больничный, вычлась бы из нормы дважды — 48 часов за одни
        // сутки. Своя же запись, открытая на правку, не считается.
        const kind = pick.slice("absence:".length) as AbsenceKind;
        const own = absence?.kind === kind ? absence : null;
        const overlap = profile.absences.find(
          (item) => item.id !== own?.id && item.startsOn <= end && target <= item.endsOn,
        );
        if (overlap) {
          setError(
            `Эти сутки уже заняты: ${ABSENCE_LABELS[overlap.kind]} ` +
              `${formatDateRu(overlap.startsOn)} — ${formatDateRu(overlap.endsOn)}. ` +
              `Сначала выключите её, иначе смена вычтется из нормы дважды.`,
          );
          return;
        }
        additions.push({ pick, end, hours: null });
      }
    }

    onChange((previous) => {
      let next = saveShift(saveDayType(saveNote(previous, note)));
      for (const { pick, end, hours: parsed } of additions) {
        if (pick.startsWith("absence:")) {
          const kind = pick.slice("absence:".length) as AbsenceKind;
          // Правка того, что уже стоит: запись остаётся той же — с тем же
          // опознавателем и той же датой начала, которая может быть и
          // раньше открытых суток, — а меняется у неё дата окончания.
          // Добавить вместо этого вторую значило бы удвоить отпуск.
          const edited = next.absences.find((item) => item.id === absence?.id && item.kind === kind);
          next = edited
            ? {
                ...next,
                absences: next.absences.map((item) =>
                  item.id === edited.id ? { ...item, endsOn: end } : item,
                ),
              }
            : {
                ...next,
                absences: [
                  ...next.absences,
                  { id: crypto.randomUUID(), kind, startsOn: target, endsOn: end },
                ],
              };
        } else {
          const kind = pick.slice("callout:".length) as CalloutKind;
          const edited = callouts.find((item) => item.kind === kind) ?? null;
          next = edited
            ? {
                ...next,
                callouts: next.callouts.map((item) =>
                  item.id === edited.id
                    ? { ...item, endsOn: end, hoursPerDay: parsed! }
                    : item,
                ),
              }
            : {
                ...next,
                callouts: [
                  ...next.callouts,
                  {
                    id: crypto.randomUUID(),
                    kind,
                    startsOn: target,
                    endsOn: end,
                    hoursPerDay: parsed!,
                  },
                ],
              };
        }
      }
      return next;
    });
    onClose();
  }

  return (
    <div className="space-y-4">
        {error ? (
          <p className="rounded-sm border-l-2 border-signal bg-signal-soft px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        {/* Что на этих сутках уже стоит. Показано до формы: человек чаще
            открывает день, чтобы посмотреть или убрать, чем чтобы
            добавить ещё одно.

            Только на сетке смен, там же, где это и вносят: кнопка
            «Удалить» без стоящего рядом способа добавить — половина
            механики, оставленная в чужом окне. */}
        {kind === "shifts" && (absence || callouts.length > 0) ? (
          <section className="space-y-2">
            <h3 className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
              Уже отмечено
            </h3>
            <ul className="divide-y divide-rule border-y border-rule">
              {absence ? (
                <Entry
                  title={ABSENCE_LABELS[absence.kind]}
                  detail={`${formatDateRu(absence.startsOn)} — ${formatDateRu(absence.endsOn)}`}
                  basis={ABSENCE_KIND_BASIS[absence.kind]}
                  onRemove={() =>
                    onChange((previous) => ({
                      ...previous,
                      absences: previous.absences.filter((item) => item.id !== absence.id),
                    }))
                  }
                />
              ) : null}
              {callouts.map((callout) => (
                <Entry
                  key={callout.id}
                  title={CALLOUT_LABELS[callout.kind]}
                  detail={
                    `${formatDateRu(callout.startsOn)} — ${formatDateRu(callout.endsOn)}` +
                    `, ${callout.hoursPerDay} ч в сутки`
                  }
                  basis={CALLOUT_KIND_BASIS[callout.kind]}
                  onRemove={() =>
                    onChange((previous) => ({
                      ...previous,
                      callouts: previous.callouts.filter((item) => item.id !== callout.id),
                    }))
                  }
                />
              ))}
            </ul>
          </section>
        ) : null}

        {/* Вопросы — одной карточкой, тем же строем, что и настройки:
            строки под общей рамкой, ответ у каждой на своём месте. Прежде
            они шли по окну сплошняком, и на телефоне, где окно во весь
            экран, конец одного вопроса от начала следующего отличался
            только кеглем. */}
        <Card>

        {/* Вид дня — вопрос производственного календаря, и спрашивается
            он там же, где календарь: на сетке графика этому списку взяться
            неоткуда. */}
        {kind === "calendar" ? (
        <Field
          id={dayTypeId}
          label="Что это за день по календарю"
          stack
          note={
            <>
              {DAY_TYPE_EFFECT[dayType]}.
              {dayType === lawful
                ? " Это и есть значение по закону."
                : ` По закону здесь ${DAY_TYPE_LABELS[lawful].toLowerCase()} — ваша правка это переопределит.`}
            </>
          }
        >
          <Select
            id={dayTypeId}
            value={dayType}
            onChange={(event) => setDayType(event.target.value as DayType)}
          >
            {DAY_TYPES.map((type) => (
              <option key={type} value={type}>
                {DAY_TYPE_LABELS[type]}
                {type === lawful ? " — по закону" : ""}
              </option>
            ))}
          </Select>
        </Field>
        ) : null}

        {/* Сутки без своей смены, но с чужими часами: сюда дотянулась смена,
            начатая накануне. Часы у неё там же, где она началась, — иначе
            одна смена правилась бы из двух разных дней, и правки эти
            неминуемо разошлись бы. */}
        {kind === "shifts" && !shift && tailFrom !== null ? (
          <Field
            label=""
            stack
            note={
              <>
                Эти сутки — продолжение смены с {formatDayMonthRu(tailFrom)}: её
                хвост от полуночи до сдачи посчитан здесь. Часы правятся в тех
                сутках, где смена началась.
              </>
            }
          >
            {null}
          </Field>
        ) : null}

        {/* Что в этих сутках стоит — одним списком: смена, выходной,
            освобождение от работы, работа помимо графика.

            Список один, потому что вопрос один. Прежде он был разорван на
            тумблер «Смена в этот день» и отдельный список всего
            остального, и человек, пришедший отметить отгул, отвечал на два
            вопроса подряд, не понимая, связаны они или нет. Связаны:
            отгул — это и есть «смены не было».

            Оговорка внизу говорит о ВЫБРАННОМ: что эти сутки делают с
            расчётом. Пока выбрана смена или выходной — про них и сказано,
            вместе со сверкой с циклом. */}
        {kind === "shifts" ? (
        <Field
          label="Что в этот день"
          stack
          note={
            isAbsence ? (
              ABSENCE_EFFECT[spotlight!.slice("absence:".length) as AbsenceKind]
            ) : isCallout ? (
              "Часы прибавляются к отработанному, норму не трогают (ч. 1 ст. 54 ФЗ-141, ст. 91 ТК РФ)."
            ) : (
              <>
                {shift ? "Часы смены идут в отработанное." : "Выходной: ни часов, ни ночных."}
                {shift === onCycle
                  ? " Это и есть график по циклу."
                  : ` По циклу здесь ${onCycle ? "смена" : "выходной"} — ваша правка это переопределит.`}
              </>
            )
          }
        >
          <DayChoicePicker
            shift={shift}
            onShift={(next) => {
              setShift(next);
              // Включили смену — сразу спрашиваем, со скольки она и
              // сколько длится: это единственные две величины, которые у
              // неё есть. Выключили (то есть поставили выходной) —
              // спрашивать нечего.
              if (next) setDetail("shift");
            }}
            onEdit={(next) => {
              if (next !== "shift") setSpotlight(next);
              setDetail(next);
            }}
            picked={draft}
            onPick={(next, on) => {
              setError(null);
              if (!on) {
                // Выключили. Записанное в профиле убирается сразу — как и
                // кнопкой «Удалить» в «Уже отмечено»: тумблер и есть эта
                // кнопка. Не записанное просто уходит из правок.
                const stored = storedOf(next);
                if (stored) removeStored(stored);
                setDraft((previous) => {
                  const rest = { ...previous };
                  delete rest[next];
                  return rest;
                });
                if (spotlight === next) setSpotlight(null);
                return;
              }
              // Второе отсутствие в те же сутки запрещено: смена, попавшая
              // и в отпуск, и в больничный, вычлась бы из нормы дважды.
              const busy =
                next.startsWith("absence:") &&
                (Object.keys(draft) as DayPick[]).find(
                  (pick) => pick.startsWith("absence:") && pick !== next,
                );
              if (busy) {
                const kind = busy.slice("absence:".length) as AbsenceKind;
                setError(
                  `Эти сутки уже заняты: ${ABSENCE_LABELS[kind]}. ` +
                    `Сначала выключите её, иначе смена вычтется из нормы дважды.`,
                );
                return;
              }
              // Включили — спрашиваем срок и часы отдельным окном.
              setDraft((previous) => ({
                ...previous,
                [next]: { endsOn: day, hours: DEFAULT_CALLOUT_HOURS },
              }));
              setSpotlight(next);
              setDetail(next);
            }}
          />
        </Field>
        ) : null}

        <Field id={noteId} label="Заметка" stack>
          <textarea
            id={noteId}
            value={note}
            maxLength={500}
            rows={3}
            placeholder=""
            onChange={(event) => setNote(event.target.value)}
            className="block w-full rounded-lg bg-paper px-3 py-2 text-sm text-ink transition-all
                       placeholder:text-ink-faint border border-transparent hover:border-ink-muted duration-200"
          />
        </Field>
        </Card>

        {/* Время — отдельным окном поверх окна дня.
            ------------------------------------------------------------------
            Величин у каждого вида суток две-три, и раньше они появлялись
            прямо в окне дня, под списком. Список из двенадцати строк уже
            высотой в экран телефона, и поля вырастали ЗА его нижним краем:
            человек включал вызов, ничего не происходило на видимой части,
            и он шёл сохранять, не назвав ни часов, ни срока.

            Окно поверх решает это тем же, чем и вопрос «точно?»: оно
            встаёт по центру, поверх всего, и не заметить его нельзя.

            Своего «Сохранить» у него нет и быть не должно: величины
            записываются в то же состояние окна дня, а на бумагу всё
            ложится одним нажатием внизу. Два «Сохранить» подряд означали
            бы, что первое что-то уже сохранило, — а это неправда. */}
        <DayTimeModal
          detail={detail}
          onClose={() => setDetail(null)}
          day={day}
          profile={profile}
          startsAt={startsAt}
          durationHours={durationHours}
          onStart={setStartsAt}
          onDuration={setDurationHours}
          time={detail && detail !== "shift" ? draft[detail] : undefined}
          onTime={(next) =>
            setDetail((current) => {
              if (current && current !== "shift") {
                setDraft((previous) => ({ ...previous, [current]: next }));
              }
              return current;
            })
          }
        />

        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" onClick={submit}>
            Сохранить
          </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

/**
 * Откуда пришёл хвост смены в эти сутки, если он пришёл.
 *
 * Смена лежит в двух календарных днях, а принадлежит тем суткам, в которые
 * началась: там её часы и правятся. Здесь же нужно только сказать
 * человеку, откуда взялись часы в дне, где своей смены нет, — иначе он
 * читает это как ошибку расчёта.
 */
function overnightTailFrom(profile: StoredProfile, day: IsoDate): IsoDate | null {
  const previous = addDays(day, -1);
  if (!shiftOn(profile, previous)) return null;
  const span = shiftSpanAt(profile, previous);
  const started = parseTimeOfDay(span.startsAt);
  const length = spanMinutes(span);
  if (started === null || length === null) return null;
  return started + length > MINUTES_PER_DAY ? previous : null;
}

/**
 * Продолжительность промежутка — строкой, как её набирают: «24», «11,5».
 *
 * Через `formatHoursTrim`, а не делением в уме: разделитель дробной части
 * в этом приложении запятая, и поле часов принимает именно её.
 */
function spanHoursText(span: ShiftSpan): string {
  return formatHoursTrim(minutesToHours(spanMinutes(span) ?? SHIFT_MINUTES));
}

/** «11 ч 30 мин» — столько, сколько между названными часами. */
function formatSpanLength(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/**
 * Начало смены и её продолжительность в этих сутках.
 *
 * --- Почему это спрашивается на дне, а не в настройках ---------------------
 *
 * В настройках стоят те же две величины — но это ГРАФИК, одинаковый на все
 * сутки года. Спор с работодателем идёт не о графике: заступил в восемь, а
 * сдал в одиннадцать вечера, потому что смена не пришла; отпустили в шесть;
 * подменял полсмены. Такие сутки единичные, и настройками их не выразить:
 * поправив там, человек сдвинул бы весь год.
 *
 * --- Почему теми же двумя величинами, что и в настройках -------------------
 *
 * Вопрос здесь тот же самый, только про одни сутки, — и задан он обязан
 * быть так же. Человек, уже отвечавший про начало смены и её
 * продолжительность в настройках, второй раз отвечает не глядя; спроси его
 * тут иначе — «со скольки и до скольки», — и он сперва переводит одно в
 * другое, а перевод в уме это место, где ошибаются.
 *
 * Конца смены поле не спрашивает вовсе: тот следует из двух названных
 * чисел, и лишний ответ, который можно вычислить, — лишний способ
 * ошибиться. Вычисленный конец при этом ПОКАЗАН, потому что отвечает на
 * настоящий вопрос человека: когда сдавать и в какие сутки уйдут часы.
 *
 * --- Почему рядом стоит график ---------------------------------------------
 *
 * Тот же приём, что у вида дня и у самой смены: человек видит, от чего он
 * отступает, и одним нажатием возвращается обратно. Часы, совпавшие с
 * графиком, не хранятся вовсе — об этом сказано в `withShiftTimeAt`.
 */
function ShiftHoursField({
  day,
  startsAt,
  hours,
  schedule,
  onStart,
  onHours,
  onReset,
}: {
  day: IsoDate;
  /** Начало смены, «ЧЧ:ММ». */
  startsAt: string;
  /**
   * Продолжительность — строкой, как её набирают.
   *
   * Строкой, а не минутами: набирая «11,5», человек проходит через «11,»,
   * и приведение к числу на каждом нажатии стирало бы у него запятую.
   */
  hours: string;
  /** Часы этой смены по графику — то, от чего человек отступает. */
  schedule: ShiftSpan;
  onStart: (startsAt: string) => void;
  onHours: (hours: string) => void;
  onReset: () => void;
}) {
  const startId = useId();
  const durationId = useId();

  const length = shiftMinutes(hours);
  const span = spanFrom(startsAt, length);
  const overnight = (parseTimeOfDay(startsAt) ?? 0) + length > MINUTES_PER_DAY;
  const bySchedule =
    span.startsAt === schedule.startsAt && span.endsAt === schedule.endsAt;
  const scheduleLength = spanMinutes(schedule);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={startId}>Начало смены</Label>
          <TimeField id={startId} value={startsAt} onChange={onStart} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={durationId}>Продолжительность</Label>
          <HoursField id={durationId} value={hours} onChange={onHours} />
        </div>
      </div>

      <p className="text-xs text-ink-muted" aria-live="polite">
        {/* Сдача назавтра названа датой, а не словом «ночная»: смена с
            двадцати ноль-ноль кончается первого числа следующего месяца, и
            человек должен видеть, куда уйдут эти часы. */}
        Сдача {overnight ? `${formatDayMonthRu(addDays(day, 1))} ` : ""}в{" "}
        {span.endsAt}.{" "}
        {bySchedule
          ? "Столько же, сколько по графику."
          : `По графику здесь ${formatSpanLength(scheduleLength ?? 0)} с ` +
            `${schedule.startsAt} — ваши часы это переопределят.`}
      </p>

      {bySchedule ? null : (
        <Button type="button" variant="ghost" size="sm" onClick={onReset}>
          Вернуть часы по графику
        </Button>
      )}
    </div>
  );
}

function Entry({
  title,
  detail,
  basis,
  onRemove,
}: {
  title: string;
  detail: string;
  basis: string;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="font-mono text-xs">{detail}</p>
        <p className="text-xs text-ink-muted">{basis}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRemove}
        aria-label={`Удалить: ${title}`}
      >
        <Trash2 aria-hidden />
        Удалить
      </Button>
    </li>
  );
}

/**
 * Время выбранного вида суток — окном поверх окна дня.
 *
 * --- Почему отдельным окном --------------------------------------------------
 *
 * Величин у каждого вида две-три, и появлялись они прямо в окне дня, под
 * списком из двенадцати строк. Список этот на телефоне уже высотой в экран,
 * и поля вырастали ЗА его нижним краем: человек включал вызов, на видимой
 * части не менялось ничего, и он шёл сохранять, не назвав ни часов, ни
 * срока. Окно поверх не заметить нельзя — тот же довод, что у вопроса
 * «точно?» (`ui/confirm-dialog.tsx`), и то же устройство: `modal-over-modal`
 * с родным затемнением, потому что свой слой затемнения до окна, лежащего
 * выше, не дотягивается.
 *
 * --- Почему у него нет своего «Сохранить» ------------------------------------
 *
 * Величины записываются в состояние окна дня, а на бумагу всё ложится одним
 * нажатием «Сохранить» внизу. Второе «Сохранить» означало бы, что первое
 * что-то уже записало, — а это неправда, и человек, закрывший окно дня
 * после него, потерял бы всё, будучи уверен в обратном.
 */
function DayTimeModal({
  detail,
  onClose,
  day,
  profile,
  startsAt,
  durationHours,
  onStart,
  onDuration,
  time,
  onTime,
}: {
  detail: DayPick | "shift" | null;
  onClose: () => void;
  day: IsoDate;
  profile: StoredProfile;
  startsAt: string;
  durationHours: string;
  onStart: (next: string) => void;
  onDuration: (next: string) => void;
  /** Срок и часы того вида, что сейчас правится. */
  time?: DayTime;
  onTime: (next: DayTime) => void;
}) {
  const hoursId = useId();
  const endsId = useId();
  const kindOf = detail && detail !== "shift" ? detail.split(":") : null;
  const isAbsence = kindOf?.[0] === "absence";
  const isCallout = kindOf?.[0] === "callout";

  const title =
    detail === "shift"
      ? "Смена в этот день"
      : isAbsence
        ? ABSENCE_LABELS[kindOf![1] as AbsenceKind]
        : isCallout
          ? CALLOUT_LABELS[kindOf![1] as CalloutKind]
          : "";

  return (
    <Modal
      open={detail !== null}
      onClose={onClose}
      title={title}
      // Узкое и поверх — как вопрос «точно?»: довод там же.
      className="modal-over-modal backdrop:bg-black/60 w-[min(30rem,calc(100vw-2rem))]"
    >
      <div className="space-y-4 flex flex-col items-center">
        <Card>
          {detail === "shift" ? (
            <Field label="" stack>
              <ShiftHoursField
                day={day}
                startsAt={startsAt}
                hours={durationHours}
                schedule={scheduleSpanAt(profile, day)}
                onStart={onStart}
                onHours={onDuration}
                onReset={() => {
                  const schedule = scheduleSpanAt(profile, day);
                  onStart(schedule.startsAt);
                  onDuration(spanHoursText(schedule));
                }}
              />
            </Field>
          ) : null}

          {/* Подпись рисует строка карточки, а не само поле: тогда вопрос
              стоит слева, а ответ справа — тем же строем, что и «Часов в
              сутки» под ним и что все строки в настройках. Своей подписью
              поле вставало столбиком, и две соседние строки одной карточки
              читались как из разных мест. На узком экране строка
              переносится, и поле встаёт под вопросом само. */}
          {isAbsence || isCallout ? (
            <Field id={endsId} label="По дату включительно">
              <DateField
                key={detail}
                id={endsId}
                // Своя дата у того, что уже записано: открыв середину
                // вызова с 7 по 9, человек обязан увидеть 9, а не открытые
                // сутки.
                defaultValue={time?.endsOn ?? day}
                min={day}
                onChange={(next) => onTime({ ...time!, endsOn: next ?? day })}
              />
            </Field>
          ) : null}

          {isCallout ? (
            <Field id={hoursId} label="Часов в сутки">
              <Input
                id={hoursId}
                inputMode="decimal"
                value={time?.hours ?? ""}
                onChange={(event) => onTime({ ...time!, hours: event.target.value })}
                className="w-28 font-mono"
              />
            </Field>
          ) : null}
        </Card>

        <Button type="button" onClick={onClose}>
          Готово
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Что в этих сутках — списком клеток с тумблерами.
 *
 * --- Почему не список выбора -----------------------------------------------
 *
 * Список показывает одно значение, а остальные десять прячет за нажатием.
 * Человек, открывший сутки, чтобы отметить отпуск, не знает, что в том же
 * списке лежит отгул и что отгул считается иначе, — пока не раскроет его и
 * не прочитает все строки подряд. Раскрытый список на телефоне вдобавок
 * закрывает собой окно, из которого он вызван.
 *
 * Клетки показывают всё сразу и ровно тем же значком, каким этот вид суток
 * стоит потом на сетке: человек нажимает на «О» в отпуске и видит «О» в
 * календаре. Легенда и правка перестали быть двумя разными словарями —
 * буквы и цвета у них общие (`day-marks.ts`).
 *
 * --- Почему тумблер справа, а не отметка выбранного ------------------------
 *
 * Отметка отвечает на вопрос «что я сейчас выбрал». Вопрос человека другой:
 * «что в этих сутках СТОИТ». Тумблер отвечает на него прямо — включён
 * значит стоит, и неважно, поставлено это сейчас или было записано раньше.
 * Поэтому включённых бывает и несколько: отпуск и вызов в одни сутки, две
 * записи разом.
 *
 * Он же и убирает: выключенный тумблер у записанного вида — это удаление, и
 * оно происходит сразу, как и по кнопке «Удалить» в «Уже отмечено».
 *
 * --- Почему смена и выходной стоят здесь же --------------------------------
 *
 * Потому что это ответ на тот же вопрос. Они шли отдельным тумблером выше
 * списка, и человек, пришедший отметить отгул, отвечал на два вопроса
 * подряд, не понимая, связаны ли они. Связаны: отгул — это и есть «смены не
 * было». Взаимно исключающие друг друга, они и ведут себя так: включение
 * одного гасит другой.
 */
function DayChoicePicker({
  shift,
  onShift,
  picked,
  onPick,
  onEdit,
}: {
  shift: boolean;
  onShift: (next: boolean) => void;
  /** Что в этих сутках стоит: и записанное, и только что включённое. */
  picked: Record<string, DayTime>;
  onPick: (pick: DayPick, on: boolean) => void;
  /** Открыть окно времени у включённой строки. */
  onEdit: (detail: DayPick | "shift") => void;
}) {
  const has = (pick: DayPick) => pick in picked;

  return (
    // Во всю ширину строки: `Field` кладёт ответ в гибкую строку, и без
    // этого плашки сжались бы по самой длинной подписи, оставив полполосы
    // пустой бумаги справа.
    <div className="w-full min-w-0 space-y-3">
      <DayChoiceGroup title="Смена по графику">
        <DayChoiceRow
          on={shift}
          onToggle={(next) => onShift(next)}
          onEdit={() => onEdit("shift")}
          label="Смена в этот день"
          tone={SHIFT_TONE}
        />
        {/* У выходного времени нет — ни начала, ни продолжительности, — и
            карандаша у него поэтому тоже нет: открывать было бы нечего. */}
        <DayChoiceRow
          on={!shift}
          onToggle={(next) => onShift(!next)}
          label="Выходной"
          mark={DAY_OFF_MARK}
          tone={DAY_OFF_TONE}
        />
      </DayChoiceGroup>

      <DayChoiceGroup title="Освобождение от работы">
        {ABSENCE_KINDS.map((kind) => (
          <DayChoiceRow
            key={kind}
            on={has(`absence:${kind}`)}
            onToggle={(next) => onPick(`absence:${kind}`, next)}
            onEdit={() => onEdit(`absence:${kind}`)}
            label={ABSENCE_LABELS[kind]}
            mark={ABSENCE_MARK[kind]}
            tone={ABSENCE_TONE[kind]}
          />
        ))}
      </DayChoiceGroup>

      <DayChoiceGroup title="Работа помимо графика">
        {CALLOUT_KINDS.map((kind) => (
          <DayChoiceRow
            key={kind}
            on={has(`callout:${kind}`)}
            onToggle={(next) => onPick(`callout:${kind}`, next)}
            onEdit={() => onEdit(`callout:${kind}`)}
            label={CALLOUT_LABELS[kind]}
            mark={CALLOUT_MARK[kind]}
            tone={CALLOUT_TONE}
          />
        ))}
      </DayChoiceGroup>
    </div>
  );
}

/**
 * Заголовок группы и её строки — тем же строем, что и легенда: подпись над
 * рядом, а не при каждой строке.
 *
 * Группа размечена `role="group"` с подписью: без неё диктор прочитал бы
 * двенадцать тумблеров подряд, не сказав, где кончается освобождение от
 * работы и начинается работа помимо графика.
 */
function DayChoiceGroup({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className="space-y-1.5">
      <p
        id={titleId}
        className="font-display text-[11px] font-bold uppercase tracking-wide text-ink-muted"
      >
        {title}
      </p>
      <div className="grid grid-cols-1 min-[30rem]:grid-cols-2 gap-1.5">{children}</div>
    </div>
  );
}

/**
 * Строка списка: клетка вида суток, название, карандаш и тумблер.
 *
 * --- Почему карандаш стоит РЯДОМ с тумблером, а не внутри строки ------------
 *
 * Тумблер — это кнопка во всю строку, и вложить в неё вторую кнопку нельзя:
 * такая разметка недопустима, и нажатие досталось бы то одной, то другой.
 * Поэтому карандаш лежит НАД строкой отдельной кнопкой, слева от дорожки, и
 * перехватывает свои нажатия сам. Место под него держит отступ справа у
 * подписи — иначе длинное название уезжало бы под него.
 *
 * Показан он только у включённого вида: у выключенного правит нечего.
 */
function DayChoiceRow({
  on,
  onToggle,
  onEdit,
  label,
  mark,
  tone,
}: {
  on: boolean;
  onToggle: (next: boolean) => void;
  /** Чем правится время этого вида суток. Без него карандаша нет. */
  onEdit?: () => void;
  label: string;
  mark?: string;
  tone: string;
}) {
  return (
    <div className="relative">
      <Switch
        settings
        checked={on}
        onChange={onToggle}
        className={cn(
          "rounded-lg px-2 py-1.5 text-xs transition-colors duration-150",
          "bg-paper-sunken/60 border border-transparent hover:border-ink-muted",
        )}
        label={
          // Место под карандаш держит подпись, а не сам тумблер: отступ на
          // тумблере сдвинул бы ВНУТРЬ его дорожку, и карандаш лёг бы прямо
          // на неё — поймано снимком.
          <span
            className={cn(
              "flex min-w-0 items-center gap-2 text-left",
              on && onEdit ? "pr-8" : "",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm border px-2",
                "font-mono text-[12px] leading-none",
                tone,
              )}
            >
              {mark}
            </span>
            <span className={cn("truncate", on ? "text-ink" : "text-ink-muted")}>{label}</span>
          </span>
        }
      />
      {on && onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Настроить: ${label}`}
          className="absolute right-11 top-1/2 -translate-y-1/2 inline-flex size-7 items-center
                     justify-center rounded-sm text-ink-faint transition-colors
                     hover:text-ink cursor-pointer
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace"
        >
          <Pencil aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
