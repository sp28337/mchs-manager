"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";

import { DEFAULT_SHIFT_START, parseTimeOfDay } from "../domain/shift-hours";
import { todayIso, type IsoDate } from "../domain/plain-date";
import { DateField } from "./date-field";
import { TimeField } from "./time-field";
import { createProfile, importProfile, type StoredProfile } from "../storage/profile";
import {
  WEEKLY_NORM_GROUNDS,
  WEEKLY_NORM_GROUND_LABELS,
  type WeeklyNormGround,
} from "../domain/value-objects";
import { weeklyNormGroundFacts } from "../model/derive";
import { ThemeToggle } from "@/components/ui/theme-toggle";

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
 * * караул и любая известная его смена задают график: без них неизвестно,
 *   в какие сутки человек заступал.
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
 * --- Почему дата смены, а не только номер караула -----------------------
 *
 * Номер караула сам по себе цикл не задаёт. В одной части первый караул
 * заступает 1 января, в другой — третьего, и «караул № 1» в них дежурит
 * в разные сутки. Дата заступления — единственное, что привязывает цикл к
 * календарю.
 *
 * --- Почему любая смена, а не первая в году ------------------------------
 *
 * Спрашивали первую смену года — одни из первых четырёх суток января, — и
 * человек отвечал не тем, что знает, а тем, что вычислил: отсчитывал
 * четвёрками назад от смены, которую помнит. Ошибка в этом отсчёте
 * сдвигает весь график на сутки, и заметна она не сразу.
 *
 * Цикл четырёхдневный и одинаков в обе стороны, поэтому любая известная
 * смена задаёт его целиком — хоть завтрашняя. Отсчёт назад делает
 * приложение.
 */

const CURRENT_YEAR = new Date().getUTCFullYear();

export interface RegisterFormProps {
  onCreated: (profile: StoredProfile) => void;
}

export function RegisterForm({ onCreated }: RegisterFormProps) {
  const [ground, setGround] = useState<WeeklyNormGround>("base");
  const [guard, setGuard] = useState(1);
  // Умолчание — сегодня: это единственная дата, о которой точно известно,
  // что человек её помнит. Свою смену он от неё и отмерит.
  const [knownShift, setKnownShift] = useState<IsoDate>(todayIso());
  const [startTime, setStartTime] = useState(DEFAULT_SHIFT_START);
  const [error, setError] = useState<string | null>(null);

  const nameId = useId();
  const normId = useId();
  const yearId = useId();
  const startId = useId();


  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const year = Number(form.get("year") ?? CURRENT_YEAR);

    if (parseTimeOfDay(startTime) === null) {
      setError("Время развода — в формате ЧЧ:ММ, например 08:00.");
      return;
    }

    setError(null);
    try {
      onCreated(
        createProfile({
          displayName: String(form.get("displayName") ?? "").trim() || "Пожарный",
          // Норма приходит одним ответом: человек выбрал основание, а
          // признаки, которые из него следуют, расставлены по профилю здесь.
          ...weeklyNormGroundFacts(ground),
          guardNumber: guard,
          firstShiftDate: knownShift,
          accountingYear: year,
          shiftStartTime: startTime,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить профиль.");
    }
  }

  return (
    <>
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
              placeholder="Например: Сергей Генадьевич"
              className="max-w-md"
              aria-describedby={`${nameId}-hint`}
            />
            <p id={`${nameId}-hint`} className="max-w-md text-xs text-ink-muted">
              Только для обращения. Фамилия, табельный номер и подразделение не
              нужны — расчёт от них не зависит, и мы их не спрашиваем.
            </p>
          </div>

          {/* Одно поле вместо четырёх.
              -------------------------------------------------------------
              Раньше здесь спрашивали, сотрудник человек или работник,
              мужчина или женщина, каковы условия труда и есть ли
              инвалидность, — и по четырём ответам приложение РЕШАЛО за
              него, какая у него норма. Решение это не всегда верное (круг
              северных местностей у сотрудника шире), а ошибка в нём тихая:
              подставляется другое число, и человек об этом не узнаёт.

              Норму человек знает из своего приказа. Поэтому вопрос теперь
              прямой, а приложение отвечает основанием — статьёй, которой
              выбор можно подтвердить. */}
          <div className="space-y-1.5">
            <Label htmlFor={normId}>Норма часов в неделю</Label>
            <Select
              id={normId}
              value={ground}
              onChange={(event) => setGround(event.target.value as WeeklyNormGround)}
              aria-describedby={`${normId}-hint`}
            >
              {WEEKLY_NORM_GROUNDS.map((option) => (
                <option key={option} value={option}>
                  {WEEKLY_NORM_GROUND_LABELS[option]}
                </option>
              ))}
            </Select>
            <p id={`${normId}-hint`} className="max-w-md text-xs text-ink-muted">
              Норма периода считается из недельной (ст. 104 ТК РФ), и ошибка
              здесь меняет весь расчёт. Сорок часов — общий случай; тридцать
              шесть дают вредные 3-4 степени либо опасные условия (Приказ
              № 308 п. 1, № 307 п. 6) и работа в районах Крайнего Севера,
              приравненных и других местностях с неблагоприятными условиями
              (№ 308 п. 1, № 307 п. 4); тридцать пять — инвалидность I или II
              группы (абз. 4 ч. 1 ст. 92 ТК РФ).
            </p>
          </div>

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
                  onClick={() => setGuard(number)}
                >
                  {number}-й
                </Button>
              ))}
            </div>
          </fieldset>

          {/* Спрашивается любая смена, а не первая в году.
              -------------------------------------------------------------
              Здесь стояли четыре кнопки — «1 января», «2 января», «3», «4»
              — и человек выбирал из них дату, которой не помнит: первое
              января это не событие, а вычисление, и он проделывал его в
              голове, отсчитывая четвёрками назад от смены, которую знает.

              Цикл четырёхдневный и одинаков в обе стороны, поэтому любая
              известная смена задаёт его целиком. Отсчёт назад делает
              приложение — оно в арифметике не ошибается. */}
          <DateField
            label="Любая ваша смена"
            name="knownShift"
            required
            defaultValue={knownShift}
            onChange={(value) => setKnownShift(value ?? knownShift)}
            hint="Та, в которой вы уверены: ближайшая или последняя. Остальной график приложение достроит от неё в обе стороны."
          />
          <p className="-mt-4 max-w-md text-xs text-ink-muted">
            Номер караула цикл не задаёт: в одной части первый караул
            заступает 1 января, в другой — третьего. Привязывает график к
            календарю именно дата.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor={startId}>Время смены караулов</Label>
            <TimeField
              id={startId}
              value={startTime}
              onChange={setStartTime}
              aria-describedby={`${startId}-hint`}
            />
            <p id={`${startId}-hint`} className="max-w-md text-xs text-ink-muted">
              Отсюда считается, как смена делится между сутками. При смене караулов в 
              08:00 сутки заступления получают 16 часов (из них 2 ночных), а
              следующие — 8 (из них 6 ночных). Ошибка здесь сдвигает месячные
              итоги и число ночных на стыке месяцев. Продолжительность смены — 24 часа, не
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
      <footer className="flex justify-center pt-8 pb-8 md:ml-auto md:pb-2">
        <ThemeToggle/>
      </footer>
    </>
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
            "inline-flex h-9 cursor-pointer items-center rounded-xl border border-rule-strong",
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
