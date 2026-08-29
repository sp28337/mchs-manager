"use client";

import { Trash2 } from "lucide-react";

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

/** Что человек выбирает в списке: ничего, отсутствие или вызов. */
type DayChoice = "none" | `absence:${AbsenceKind}` | `callout:${CalloutKind}`;

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
  const hoursId = useId();
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
  // Что в этих сутках уже стоит — это и есть начальный выбор.
  //
  // Раньше окно открывалось с пустым «ничего не добавлять», и стоявший в
  // сутках вызов правился одним способом: удалить и внести заново, набрав
  // и период, и часы. Теперь окно открыто НА нём: переключатель включён,
  // период и часы показаны его собственные, а «Сохранить» их поправит.
  //
  // Правится один, а не все сразу: у окна одна пара полей, и второй вызов
  // в тех же сутках (так бывает — соревнования и следом резерв) правится
  // следующим открытием. Оба при этом видны в «Уже отмечено», и выключить
  // можно любой.
  const editing = absence ?? callouts[0] ?? null;
  const [choice, setChoice] = useState<DayChoice>(() =>
    absence
      ? `absence:${absence.kind}`
      : callouts[0]
        ? `callout:${callouts[0].kind}`
        : "none",
  );
  const [endsOn, setEndsOn] = useState<IsoDate | null>(editing?.endsOn ?? day);
  const [hours, setHours] = useState(
    callouts[0] ? formatHoursTrim(callouts[0].hoursPerDay) : DEFAULT_CALLOUT_HOURS,
  );
  const [note, setNote] = useState(profile.dayNotes[day] ?? "");
  const [error, setError] = useState<string | null>(null);

  // Сутки, в которые дотянулась чужая смена: своей здесь нет, а часы есть.
  // Спрашивается это по ПРЕДЫДУЩЕМУ дню, потому что смена лежит в двух
  // календарных днях, а принадлежит тем суткам, в которые началась.
  const tailFrom = overnightTailFrom(profile, day);

  /** Запись профиля, стоящая за этим видом суток, — если она есть. */
  function storedOf(pick: DayChoice) {
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

  const parts = choice === "none" ? null : choice.split(":");
  const isAbsence = parts?.[0] === "absence";
  const isCallout = parts?.[0] === "callout";

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

  function submit() {
    const target = day;

    if (choice === "none") {
      onChange((previous) => saveShift(saveDayType(saveNote(previous, note))));
      onClose();
      return;
    }

    const end = endsOn ?? target;
    if (end < target) {
      setError("Дата окончания раньше выбранного дня.");
      return;
    }

    if (isAbsence) {
      const absenceKind = (parts?.[1] ?? "annual_leave") as AbsenceKind;
      // Правка того, что уже стоит: запись остаётся той же — с тем же
      // опознавателем и той же датой начала, которая может быть и раньше
      // открытых суток, — а меняется у неё дата окончания. Добавлять
      // вместо этого вторую запись значило бы удвоить отпуск.
      const edited = absence?.kind === absenceKind ? absence : null;
      if (edited) {
        onChange((previous) =>
          saveShift(
          saveDayType(
          saveNote(
            {
              ...previous,
              absences: previous.absences.map((item) =>
                item.id === edited.id ? { ...item, endsOn: end } : item,
              ),
            },
            note,
          ),
          ),
          ),
        );
        onClose();
        return;
      }
      // Пересекающиеся отсутствия запрещены: смена, попавшая и в отпуск,
      // и в больничный, вычлась бы из нормы дважды — 48 часов за одни
      // сутки.
      const overlap = profile.absences.find(
        (item) => item.startsOn <= end && target <= item.endsOn,
      );
      if (overlap) {
        setError(
          `Эти сутки уже заняты: ${ABSENCE_LABELS[overlap.kind]} ` +
            `${formatDateRu(overlap.startsOn)} — ${formatDateRu(overlap.endsOn)}. ` +
            `Сначала удалите её, иначе смена вычтется из нормы дважды.`,
        );
        return;
      }

      onChange((previous) =>
        saveShift(
        saveDayType(
        saveNote(
          {
            ...previous,
            absences: [
              ...previous.absences,
              { id: crypto.randomUUID(), kind: absenceKind, startsOn: target, endsOn: end },
            ],
          },
          note,
        ),
        ),
        ),
      );
      onClose();
      return;
    }

    if (isCallout) {
      const parsed = parseHours(hours);
      // Больше суток в сутках не бывает, и ноль часов — это не вызов.
      if (parsed === null || parsed.lessThanOrEqualTo(0) || parsed.greaterThan(24)) {
        setError("Часы в сутки — число от 0 до 24, например 8 или 4,5.");
        return;
      }
      const calloutKind = (parts?.[1] ?? "competition") as CalloutKind;
      // Тот же довод, что и у отсутствия: вызов, открытый на правку,
      // правится, а не заводится вторым такой же.
      const edited = callouts.find((item) => item.kind === calloutKind) ?? null;
      if (edited) {
        onChange((previous) =>
          saveShift(
          saveDayType(
          saveNote(
            {
              ...previous,
              callouts: previous.callouts.map((item) =>
                item.id === edited.id
                  ? { ...item, endsOn: end, hoursPerDay: parsed.toString() }
                  : item,
              ),
            },
            note,
          ),
          ),
          ),
        );
        onClose();
        return;
      }
      onChange((previous) =>
        saveShift(
        saveDayType(
        saveNote(
          {
            ...previous,
            callouts: [
              ...previous.callouts,
              {
                id: crypto.randomUUID(),
                kind: calloutKind,
                startsOn: target,
                endsOn: end,
                hoursPerDay: parsed.toString(),
              },
            ],
          },
          note,
        ),
        ),
        ),
      );
      onClose();
    }
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

        {/* Со скольки и до скольки. Спрашивается только там, где часы есть,
            — у смены; на выходном отвечать было бы не о чем. */}
        {kind === "shifts" && shift ? (
          <Field label="" stack>
          <ShiftHoursField
            day={day}
            startsAt={startsAt}
            hours={durationHours}
            schedule={scheduleSpanAt(profile, day)}
            onStart={setStartsAt}
            onHours={setDurationHours}
            onReset={() => {
              const schedule = scheduleSpanAt(profile, day);
              setStartsAt(schedule.startsAt);
              setDurationHours(spanHoursText(schedule));
            }}
          />
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
              ABSENCE_EFFECT[(parts?.[1] ?? "annual_leave") as AbsenceKind]
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
            onShift={setShift}
            choice={choice}
            absence={absence ?? null}
            callouts={callouts}
            onPick={(next, on) => {
              setError(null);
              if (!on) {
                // Выключили то, что уже записано в профиле, — значит
                // убрали. Убирается сразу, как и кнопкой «Удалить» в
                // «Уже отмечено»: тумблер и есть эта кнопка.
                const stored = storedOf(next);
                if (stored) removeStored(stored);
                if (choice === next) setChoice("none");
                return;
              }
              if (next.startsWith("absence:") && absence && `absence:${absence.kind}` !== next) {
                setError(
                  `Эти сутки уже заняты: ${ABSENCE_LABELS[absence.kind]} ` +
                    `${formatDateRu(absence.startsOn)} — ${formatDateRu(absence.endsOn)}. ` +
                    `Сначала выключите её, иначе смена вычтется из нормы дважды.`,
                );
                return;
              }
              // Включили — показываем период и часы, а если это уже
              // записанное, то его собственные: окно открывается на правку,
              // а не на добавление второго такого же.
              const stored = storedOf(next);
              setChoice(next);
              setEndsOn(stored?.endsOn ?? day);
              setHours(
                stored && "hoursPerDay" in stored
                  ? formatHoursTrim(stored.hoursPerDay)
                  : DEFAULT_CALLOUT_HOURS,
              );
            }}
          />
        </Field>
        ) : null}

        {/* Вторая дата и часы появляются только у того, чему они нужны:
            пустые поля «на всякий случай» человек читает как обязательные. */}
        {/* Подпись у второй даты своя — поле само её рисует вместе с
            подсказкой, поэтому строка карточки берёт его целиком. */}
        {choice !== "none" ? (
          <Field label="" stack>
          <DateField
            key={choice}
            label="По дату включительно"
            // Своя дата у того, что уже записано: открыв середину вызова с
            // 7 по 9, человек обязан увидеть 9, а не открытые сутки. Поле
            // не управляемое и заводится заново при смене выбора (`key`),
            // поэтому здесь стоит именно то, с чем оно заводится.
            defaultValue={endsOn ?? day}
            min={day}
            hint={
              isAbsence
                ? "Как в приказе об отпуске: последний день входит."
                : "Однодневный вызов — тот же день."
            }
            onChange={setEndsOn}
          />
          </Field>
        ) : null}

        {isCallout ? (
          <Field id={hoursId} label="Часов в сутки">
            <Input
              id={hoursId}
              inputMode="decimal"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              className="w-28 font-mono"
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
                       placeholder:text-ink-faint hover:border hover:border-ink-muted duration-200"
          />
        </Field>
        </Card>

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
  choice,
  absence,
  callouts,
  onPick,
}: {
  shift: boolean;
  onShift: (next: boolean) => void;
  /** Что сейчас правится: у этого вида показаны период и часы. */
  choice: DayChoice;
  /** Отсутствие, накрывающее эти сутки, — если оно записано. */
  absence: { kind: AbsenceKind } | null;
  /** Вызовы в этих сутках — их бывает несколько. */
  callouts: readonly { kind: CalloutKind }[];
  onPick: (pick: DayChoice, on: boolean) => void;
}) {
  const has = (pick: DayChoice) =>
    choice === pick ||
    (absence !== null && `absence:${absence.kind}` === pick) ||
    callouts.some((item) => `callout:${item.kind}` === pick);

  return (
    // Во всю ширину строки: `Field` кладёт ответ в гибкую строку, и без
    // этого плашки сжались бы по самой длинной подписи, оставив полполосы
    // пустой бумаги справа.
    <div className="w-full min-w-0 space-y-3">
      <DayChoiceGroup title="Смена по графику">
        <DayChoiceRow
          on={shift}
          onToggle={(next) => onShift(next)}
          label="Смена в этот день"
          tone={SHIFT_TONE}
        />
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

/** Строка списка: клетка вида суток, название и тумблер по правому краю. */
function DayChoiceRow({
  on,
  onToggle,
  label,
  mark,
  tone,
}: {
  on: boolean;
  onToggle: (next: boolean) => void;
  label: string;
  mark?: string;
  tone: string;
}) {
  return (
    <Switch
      settings
      checked={on}
      onChange={onToggle}
      className={cn(
        "rounded-lg px-2 py-1.5 text-xs transition-colors duration-150",
        on ? "bg-paper-sunken/60" : "bg-paper-sunken/60",
      )}
      label={
        <span className="flex min-w-0 items-center gap-2 text-left">
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
  );
}
