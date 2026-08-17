"use client";

import { Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";

import { parseHours } from "../domain/decimal";
import { formatDateRu, formatDayMonthRu } from "../domain/format";
import type { IsoDate } from "../domain/plain-date";
import { statutoryCalendar } from "../domain/production-calendar";
import { ABSENCE_KIND_BASIS, CALLOUT_KIND_BASIS } from "../domain/value-objects";
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
 * --- Почему вид дня тоже здесь -------------------------------------------
 *
 * Производственный календарь правится тем же движением: нашёл день,
 * нажал, сказал, чем он был. Раньше для этого была отдельная механика —
 * кисть над сеткой и форма диапазона под ней, — то есть на один и тот же
 * вопрос «что в этих сутках» отвечали в двух разных местах двумя разными
 * способами.
 *
 * Вид дня спрашивается на обеих сетках, а не только в календаре: сутки
 * одни и те же, и человек, нашедший спорную смену в графике, не должен
 * переключать вид, чтобы поправить праздник под ней.
 *
 * Совпадение с законом не хранится: выбрав то, что и так следует из
 * ст. 112 и 95 ТК РФ, человек снимает правку, а не добавляет ещё одну, —
 * иначе счётчик «ваших правок» врал бы, а с ним и вес его утверждений в
 * споре.
 *
 * --- Почему заметка здесь же ---------------------------------------------
 *
 * Спор о табеле идёт через полгода после событий. «Звонил начкару, обещал
 * отгул» — это то, что человек помнит сегодня и не вспомнит потом, и
 * место для этого одно: те сутки, о которых речь. Расчёт заметку не
 * читает, она не влияет ни на один час.
 */

/** Что человек выбирает в списке: ничего, отсутствие или вызов. */
type DayChoice = "none" | `absence:${AbsenceKind}` | `callout:${CalloutKind}`;

const ABSENCE_KINDS = Object.keys(ABSENCE_LABELS) as AbsenceKind[];
const CALLOUT_KINDS = Object.keys(CALLOUT_LABELS) as CalloutKind[];

/** Часы вызова по умолчанию: смена целиком бывает реже, чем полдня. */
const DEFAULT_CALLOUT_HOURS = "8";

export interface DayEditorProps {
  /** День, по которому нажали. `null` — окно закрыто. */
  day: IsoDate | null;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onClose: () => void;
}

export function DayEditor({ day, profile, onChange, onClose }: DayEditorProps) {
  return (
    <Modal
      open={day !== null}
      onClose={onClose}
      title={day ? formatDayMonthRu(day) : ""}
    >
      {/* Ключ по дню: открыв второй день подряд, человек обязан увидеть
          чистые поля, а не остатки первого — иначе он запишет их не туда.
          Сброс ключом, а не эффектом: эффект сделал бы лишнюю отрисовку
          ради того, что React умеет сам. */}
      {day !== null ? (
        <DayForm
          key={day}
          day={day}
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
  profile,
  onChange,
  onClose,
}: {
  day: IsoDate;
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onClose: () => void;
}) {
  const choiceId = useId();
  const dayTypeId = useId();
  const hoursId = useId();
  const noteId = useId();

  // Вид дня по закону — то, с чем сравнивается выбор человека.
  const lawful = statutoryCalendar(profile.accountingYear).get(day) ?? "working";
  const effective = profile.calendarOverrides[day] ?? lawful;

  const [dayType, setDayType] = useState<DayType>(effective);
  const [choice, setChoice] = useState<DayChoice>("none");
  const [endsOn, setEndsOn] = useState<IsoDate | null>(day);
  const [hours, setHours] = useState(DEFAULT_CALLOUT_HOURS);
  const [note, setNote] = useState(profile.dayNotes[day] ?? "");
  const [error, setError] = useState<string | null>(null);

  // Что уже отмечено на этих сутках. Ищется по профилю, а не по расчёту:
  // удалять нужно запись целиком, а у расчёта её опознавателя нет.
  const absence = profile.absences.find(
    (item) => item.startsOn <= day && day <= item.endsOn,
  );
  const callouts = profile.callouts.filter(
    (item) => item.startsOn <= day && day <= item.endsOn,
  );

  const kind = choice === "none" ? null : choice.split(":");
  const isAbsence = kind?.[0] === "absence";
  const isCallout = kind?.[0] === "callout";

  /**
   * Вид дня в производственном календаре.
   *
   * Совпал с законом — правка снимается: список «ваших правок» должен
   * содержать только то, что человек утверждает вопреки закону.
   */
  function saveDayType(next: StoredProfile): StoredProfile {
    const calendarOverrides = { ...next.calendarOverrides };
    if (dayType === lawful) delete calendarOverrides[day];
    else calendarOverrides[day] = dayType;
    return { ...next, calendarOverrides };
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
      onChange((previous) => saveDayType(saveNote(previous, note)));
      onClose();
      return;
    }

    const end = endsOn ?? target;
    if (end < target) {
      setError("Дата окончания раньше выбранного дня.");
      return;
    }

    if (isAbsence) {
      const absenceKind = (kind?.[1] ?? "annual_leave") as AbsenceKind;
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
      const calloutKind = (kind?.[1] ?? "competition") as CalloutKind;
      onChange((previous) =>
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
            добавить ещё одно. */}
        {absence || callouts.length > 0 ? (
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

        {/* Вид дня стоит первым: он есть у каждых суток, тогда как
            отпуск и вызов — исключение. */}
        <div className="space-y-1.5">
          <Label htmlFor={dayTypeId}>Что это за день по календарю</Label>
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
          <p className="text-xs text-ink-muted" aria-live="polite">
            {DAY_TYPE_EFFECT[dayType]}.
            {dayType === lawful
              ? " Это и есть значение по закону."
              : ` По закону здесь ${DAY_TYPE_LABELS[lawful].toLowerCase()} — ваша правка это переопределит.`}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={choiceId}>Что в этот день</Label>
          <Select
            id={choiceId}
            value={choice}
            onChange={(event) => {
              setChoice(event.target.value as DayChoice);
              setError(null);
            }}
          >
            <option value="none">— ничего не добавлять —</option>
            <optgroup label="Освобождение от службы">
              {ABSENCE_KINDS.map((option) => (
                <option key={option} value={`absence:${option}`}>
                  {ABSENCE_LABELS[option]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Вызов помимо графика">
              {CALLOUT_KINDS.map((option) => (
                <option key={option} value={`callout:${option}`}>
                  {CALLOUT_LABELS[option]}
                </option>
              ))}
            </optgroup>
          </Select>
          {isAbsence ? (
            <p className="text-xs text-ink-muted" aria-live="polite">
              {ABSENCE_EFFECT[(kind?.[1] ?? "annual_leave") as AbsenceKind]}
            </p>
          ) : null}
          {isCallout ? (
            <p className="text-xs text-ink-muted" aria-live="polite">
              Часы прибавляются к отработанному, норму не трогают (ч. 1 ст. 54
              ФЗ-141, ст. 91 ТК РФ).
            </p>
          ) : null}
        </div>

        {/* Вторая дата и часы появляются только у того, чему они нужны:
            пустые поля «на всякий случай» человек читает как обязательные. */}
        {choice !== "none" ? (
          <DateField
            key={choice}
            label="По дату включительно"
            name="endsOn"
            defaultValue={day}
            min={day}
            hint={
              isAbsence
                ? "Как в приказе об отпуске: последний день входит."
                : "Однодневный вызов — тот же день."
            }
            onChange={setEndsOn}
          />
        ) : null}

        {isCallout ? (
          <div className="space-y-1.5">
            <Label htmlFor={hoursId}>Часов в сутки</Label>
            <Input
              id={hoursId}
              inputMode="decimal"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              className="w-28 font-mono"
            />
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={noteId}>Заметка</Label>
          <textarea
            id={noteId}
            value={note}
            maxLength={500}
            rows={3}
            placeholder="Например: звонил начкару, обещал отгул"
            onChange={(event) => setNote(event.target.value)}
            className="block w-full rounded-sm border border-rule-strong bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
          />
          <p className="text-xs text-ink-muted">
            Только для вашей памяти: на расчёт не влияет, но в календаре видно,
            что запись есть.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
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
