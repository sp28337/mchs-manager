"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

import { DEFAULT_SHIFT_START, parseTimeOfDay } from "../domain/shift-hours";
import { createProfile, importProfile, type StoredProfile } from "../storage/profile";
import {
  CONDITIONS_LABELS,
  EMPLOYMENT_HINT,
  EMPLOYMENT_LABELS,
  GENDER_LABELS,
  type EmploymentKind,
  type Gender,
  type WorkingConditions,
} from "../schemas";

/**
 * Регистрация.
 *
 * --- Почему спрашивается именно это ------------------------------------
 *
 * Каждое поле здесь меняет ЧИСЛО в расчёте, и ни одно не задано «для
 * анкеты»:
 *
 * * основание (служба или трудовой договор) решает, каким законом
 *   считается время;
 * * условия труда, пол в северной местности и инвалидность I-II группы
 *   сокращают неделю до 36 или 35 часов — это до 5 часов нормы в неделю,
 *   больше двухсот часов в год;
 * * караул и дата его первой смены задают график: без них неизвестно, в
 *   какие сутки человек заступал.
 *
 * Ни фамилии в паспортном смысле, ни табельного номера, ни подразделения
 * не спрашивается: расчёту они не нужны, а собирать то, что не нужно, —
 * значит хранить чужие данные без причины.
 *
 * --- Куда всё это уходит ------------------------------------------------
 *
 * Никуда. Ответы записываются в хранилище браузера и остаются на этом
 * устройстве; сервера у приложения нет. Здесь спрашивают об инвалидности и
 * больничных — сведения о здоровье, — и отправлять их наружу означало бы
 * ровно тот риск, от которого человек сюда и пришёл.
 *
 * --- Почему дата первой смены, а не только номер караула ----------------
 *
 * Номер караула сам по себе цикл не задаёт. В одной части первый караул
 * заступает 1 января, в другой — третьего, и «караул № 1» в них дежурит
 * в разные сутки. Дата первой смены — единственное, что привязывает цикл
 * к календарю.
 */

const CURRENT_YEAR = new Date().getUTCFullYear();

export interface RegisterFormProps {
  onCreated: (profile: StoredProfile) => void;
}

export function RegisterForm({ onCreated }: RegisterFormProps) {
  const [employment, setEmployment] = useState<EmploymentKind>("attested");
  const [gender, setGender] = useState<Gender>("male");
  const [conditions, setConditions] = useState<WorkingConditions>("normal");
  const [northern, setNorthern] = useState(false);
  const [disability, setDisability] = useState(false);
  const [guard, setGuard] = useState(1);
  const [firstShiftDay, setFirstShiftDay] = useState(1);
  const [startTime, setStartTime] = useState(DEFAULT_SHIFT_START);
  const [error, setError] = useState<string | null>(null);

  const nameId = useId();
  const yearId = useId();
  const startId = useId();

  // Северное сокращение спрашивается только у женщин: оба приказа
  // (№ 308 п. 1 и № 307 п. 4) говорят именно о них. Задать вопрос
  // мужчине значило бы спросить о том, что ни на что не повлияет.
  const northernApplies = gender === "female";

  // Инвалидность I или II группы даёт 35 часов только работнику
  // (Приказ № 307 п. 5). Приказ № 308 такого пункта не знает: службу в
  // ФПС ГПС инвалид I или II группы не проходит.
  const disabilityApplies = employment === "civilian";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const year = Number(form.get("year") ?? CURRENT_YEAR);

    if (parseTimeOfDay(startTime) === null) {
      setError("Время развода — в формате ЧЧ:ММ, например 08:30.");
      return;
    }

    setError(null);
    try {
      onCreated(
        createProfile({
          displayName: String(form.get("displayName") ?? "").trim() || "Пожарный",
          employmentKind: employment,
          gender,
          workingConditions: conditions,
          northernLocality: northernApplies && northern,
          disabilityGroupIorII: disabilityApplies && disability,
          guardNumber: guard,
          firstShiftDate: `${year}-01-0${firstShiftDay}`,
          shiftStartTime: startTime,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить профиль.");
    }
  }

  return (
    <div className="space-y-8">
      <form className="space-y-7" onSubmit={submit}>
        {error ? (
          <p className="rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
            {error}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={nameId}>Как к вам обращаться</Label>
          <Input
            id={nameId}
            name="displayName"
            maxLength={200}
            placeholder="Например: Сергей, 2-й караул"
            className="max-w-md"
            aria-describedby={`${nameId}-hint`}
          />
          <p id={`${nameId}-hint`} className="max-w-md text-xs text-ink-muted">
            Только для обращения. Фамилия, табельный номер и подразделение не
            нужны — расчёт от них не зависит, и мы их не спрашиваем.
          </p>
        </div>

        <Choice
          legend="Кто вы"
          value={employment}
          options={["attested", "civilian"] as const}
          labels={EMPLOYMENT_LABELS}
          hints={EMPLOYMENT_HINT}
          onChange={setEmployment}
        />

        <Choice
          legend="Пол"
          value={gender}
          options={["male", "female"] as const}
          labels={GENDER_LABELS}
          onChange={setGender}
          hint="Влияет в одном случае: женщинам на Крайнем Севере и в приравненных местностях положена 36-часовая неделя (Приказ № 308 п. 1, Приказ № 307 п. 4)."
        />

        <Choice
          legend="Условия службы или труда"
          value={conditions}
          options={["normal", "harmful_or_dangerous"] as const}
          labels={CONDITIONS_LABELS}
          onChange={setConditions}
          hint="По результатам специальной оценки. Вредные 3-4 степени или опасные дают 36 часов в неделю вместо 40 (Приказ № 308 п. 1, Приказ № 307 п. 6)."
        />

        {northernApplies ? (
          <label className="flex max-w-md items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={northern}
              onChange={(event) => setNorthern(event.target.checked)}
              className="mt-1"
            />
            <span>
              {employment === "attested"
                ? "Служу в районе Крайнего Севера, приравненной или иной местности с неблагоприятными условиями"
                : "Работаю в районе Крайнего Севера или приравненной местности"}
              <span className="block text-xs text-ink-muted">
                {employment === "attested"
                  ? "Приказ МЧС России № 308 п. 1 (ч. 4 ст. 54 ФЗ-141): 36 часов в неделю. Круг местностей шире, чем в Трудовом кодексе, — в него входят и отдалённые."
                  : "Приказ МЧС России № 307 п. 4 (ст. 320 ТК РФ): 36 часов в неделю."}
              </span>
            </span>
          </label>
        ) : null}

        {disabilityApplies ? (
          <label className="flex max-w-md items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={disability}
              onChange={(event) => setDisability(event.target.checked)}
              className="mt-1"
            />
            <span>
              Инвалидность I или II группы
              <span className="block text-xs text-ink-muted">
                Приказ МЧС России № 307 п. 5 (абз. 4 ч. 1 ст. 92 ТК РФ): 35 часов
                в неделю — самая короткая из возможных норм.
              </span>
            </span>
          </label>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
            Ваш караул
          </legend>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((number) => (
              <Button
                key={number}
                type="button"
                variant={guard === number ? "default" : "outline"}
                aria-pressed={guard === number}
                onClick={() => {
                  setGuard(number);
                  // Чаще всего номер караула и есть день его первой смены,
                  // поэтому подставляется он — но остаётся изменяемым: в
                  // части нумерация может быть другой.
                  setFirstShiftDay(number);
                }}
              >
                {number}-й
              </Button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
            Первая смена караула в году
          </legend>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((day) => (
              <Button
                key={day}
                type="button"
                variant={firstShiftDay === day ? "default" : "outline"}
                aria-pressed={firstShiftDay === day}
                onClick={() => setFirstShiftDay(day)}
              >
                {day} января
              </Button>
            ))}
          </div>
          <p className="max-w-md text-xs text-ink-muted">
            Цикл «сутки через трое» четырёхдневный, поэтому первая смена
            обязательно приходится на одни из первых четырёх суток года.
            Пятое января — это уже вторая смена какого-то из караулов.
          </p>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor={startId}>Время развода караула</Label>
          <Input
            id={startId}
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            className="w-32 font-mono"
            aria-describedby={`${startId}-hint`}
          />
          <p id={`${startId}-hint`} className="max-w-md text-xs text-ink-muted">
            Отсюда считается, как смена делится между сутками. При разводе в
            08:30 сутки заступления получают 15,5 часа, а следующие — 8,5, из
            которых 6 ночные. Ошибка здесь сдвигает месячные итоги и число
            ночных на стыке месяцев. Продолжительность смены — 24 часа, не
            включая время смены караулов (Приказ № 308 п. 3, № 307 п. 8).
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={yearId}>Учётный год</Label>
          <Input
            id={yearId}
            name="year"
            type="number"
            min={2000}
            max={2100}
            defaultValue={CURRENT_YEAR}
            className="w-32"
          />
        </div>

        <Button type="submit" className="w-full max-w-md">
          Построить мой график
        </Button>
      </form>

      <ImportBlock onImported={onCreated} />
    </div>
  );
}

/**
 * Возврат из файла.
 *
 * Профиль живёт в браузере, а браузеры чистят. Без этой кнопки
 * единственным способом вернуть свой год после очистки был бы ввод заново
 * — включая все больничные, которые человек уже вспоминал однажды.
 */
function ImportBlock({ onImported }: { onImported: (profile: StoredProfile) => void }) {
  const fileId = useId();
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <section aria-labelledby="restore" className="space-y-2 border-t border-rule pt-6">
      <h3 id="restore" className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
        Уже заполняли раньше
      </h3>
      <p className="max-w-prose text-sm text-ink-muted">
        Если вы сохраняли профиль в файл, загрузите его — график, отсутствия и
        правки календаря вернутся как были.
      </p>
      {error ? (
        <p className="max-w-prose rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}
      {/* Нативная кнопка выбора файла подписана браузером — «Choose File»
          в русском интерфейсе, и поменять эту надпись со страницы нельзя.
          Поэтому само поле скрыто (но доступно с клавиатуры и программе
          чтения), а роль кнопки играет подпись к нему. */}
      <div className="flex flex-wrap items-center gap-3">
        <Label
          htmlFor={fileId}
          className={cn(
            "inline-flex h-9 cursor-pointer items-center rounded-xs border border-rule-strong",
            "bg-paper px-3 text-sm font-normal",
            "hover:border-ink focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-trace",
          )}
        >
          Выбрать файл профиля
        </Label>
        <input
          id={fileId}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            setError(null);
            try {
              onImported(importProfile(await file.text()));
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Файл не прочитан.");
            }
          }}
        />
        <span className="text-sm text-ink-muted" aria-live="polite">
          {fileName ?? "Файл не выбран"}
        </span>
      </div>
    </section>
  );
}

function Choice<T extends string>({
  legend,
  value,
  options,
  labels,
  hints,
  hint,
  onChange,
}: {
  legend: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  hints?: Record<T, string>;
  hint?: string;
  onChange: (next: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
        {legend}
      </legend>
      <div className="space-y-2">
        {options.map((option) => (
          <label key={option} className="flex max-w-md items-start gap-2 text-sm">
            <input
              type="radio"
              name={legend}
              checked={value === option}
              onChange={() => onChange(option)}
              className="mt-1"
            />
            <span>
              {labels[option]}
              {hints ? (
                <span className="block text-xs text-ink-muted">{hints[option]}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      {hint ? <p className="max-w-md text-xs text-ink-muted">{hint}</p> : null}
    </fieldset>
  );
}
