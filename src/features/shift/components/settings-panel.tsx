"use client";

import { useId } from "react";

import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import {
  WEEKLY_NORM_GROUNDS,
  WEEKLY_NORM_GROUND_LABELS,
  type WeeklyNormGround,
} from "../domain/value-objects";
import {
  weeklyNormGroundFacts,
  weeklyNormGroundOfProfile,
} from "../model/derive";
import type { StoredProfile } from "../storage/profile";
import { DateField } from "./date-field";
import { LiveModeSwitch } from "./live-mode";
import { TimeField } from "./time-field";

/**
 * Ответы анкеты, которые можно переспросить.
 *
 * --- Почему это вообще нужно ---------------------------------------------
 *
 * Анкета заполняется один раз и до того, как человек увидел хоть одно
 * число. Ошибиться в ней легко: поставить смену не на те сутки, не
 * разобраться, вредные у него условия или обычные. До сих пор такая
 * ошибка стоила профиля целиком — исправить её можно было, только удалив
 * всё и заполнив заново вместе с годом внесённых отпусков.
 *
 * Здесь те же вопросы стоят рядом с ответом на них. Переставил дату смены
 * — график справа перестроился, норма пересчиталась, и сразу видно, тот
 * ли это график, который висит в части.
 *
 * --- Почему норма списком -------------------------------------------------
 *
 * Человек здесь не выбирает впервые, а ПРАВИТ — обычно одно поле, — и
 * развёрнутый список из трёх вариантов занял бы место, показывая то, что
 * и так известно. Свёрнутый показывает текущий ответ одной строкой, и это
 * ровно то, что нужно, чтобы его проверить.
 *
 * Остальные три поля списком быть не могут: имя — свободная строка, время
 * отсчёта — время (списком из тысячи четырёхсот сорока минут его не
 * выбирают), а дата смены — дата.
 *
 * --- Почему нет кнопки «Сохранить» ---------------------------------------
 *
 * По той же причине, что и в остальном приложении: запись идёт в браузер,
 * а не по сети. Отдельный шаг сохранения дал бы только возможность
 * потерять правку, закрыв вкладку.
 */

/**
 * Зачем открыта панель.
 *
 * `settings` — правка живого профиля. `create` — первое заполнение, из окна
 * «Создать профиль»: вопросы те же, а вот два тумблера сверху — нет. Они
 * меняют не расчёт, а то, каким его показать, и человеку, который ещё не
 * видел ни одного числа, отвечать на них нечем: «расчёт идёт за весь
 * выбранный период» сказано о периоде, которого пока не существует.
 */
export type SettingsPanelPurpose = "settings" | "create";

export function SettingsPanel({
  profile,
  onChange,
  purpose = "settings",
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  purpose?: SettingsPanelPurpose;
}) {
  const nameId = useId();
  const normId = useId();
  const shiftId = useId();
  const startId = useId();

  const ground = weeklyNormGroundOfProfile(profile);

  return (
    <div className="space-y-4">
      {purpose === "settings" ? (
        <>
          {/* Режим стоит первым: он меняет не одну величину, а то, за какой
              отрезок считается всё остальное. */}
          <div className="space-y-1.5 border-b border-rule pb-4">
            <LiveModeSwitch profile={profile} onChange={onChange} />
            <p className="text-xs text-ink-muted">
              {profile.liveMode
                ? "Расчёт идёт с начала периода по сегодняшний день."
                : "Расчёт идёт за весь выбранный период целиком."}
            </p>
          </div>

          {/* Мера переработки — рядом с режимом, а не среди вопросов о
              человеке: и то и другое меняет не расчёт, а то, каким его
              показать. */}
          <div className="space-y-1.5 border-b border-rule pb-4">
            <Switch
              checked={profile.overtimeInDays}
              onChange={(overtimeInDays) =>
                onChange((previous) => ({ ...previous, overtimeInDays }))
              }
              label="Переработка в сутках"
            />
            <p className="text-xs text-ink-muted">
              {profile.overtimeInDays
                ? "Показывается сменами и часами: «8 суток 20 ч». Сутки — это смена, 24 часа (Приказ № 308 п. 3, № 307 п. 8)."
                : "Показывается часами: «212,0 ч»."}
            </p>
          </div>
        </>
      ) : null}

      <Field id={nameId} label="Имя профиля">
        <Input
          id={nameId}
          maxLength={200}
          // Подсказка в поле нужна не настройкам, а окну «Создать профиль»:
          // там оно пустое, и человек видит, чего от него хотят.
          placeholder="Например: Старший пожарный"
          value={profile.displayName}
          onChange={(event) => {
            const displayName = event.target.value;
            onChange((previous) => ({ ...previous, displayName }));
          }}
        />
      </Field>

      <Field id={normId} label="Норма часов в неделю">
        <Select
          id={normId}
          value={ground}
          onChange={(event) => {
            const facts = weeklyNormGroundFacts(
              event.target.value as WeeklyNormGround,
            );
            onChange((previous) => ({ ...previous, ...facts }));
          }}
        >
          {WEEKLY_NORM_GROUNDS.map((option) => (
            <option key={option} value={option}>
              {WEEKLY_NORM_GROUND_LABELS[option]}
            </option>
          ))}
        </Select>
      </Field>

      {/* Любая смена, а не первая в году: цикл четырёхдневный и одинаков в
          обе стороны, поэтому одна известная дата задаёт весь график —
          хоть завтрашняя. Здесь стоял список «1—4 января», то есть вопрос
          о дате, которую человек не помнит, а вычисляет. */}
      <Field
        id={shiftId}
        label="Дата рабочей смены"
        hint="Необходима для построения графика."
      >
        <DateField
          id={shiftId}
          defaultValue={profile.firstShiftDate}
          onChange={(value) => {
            if (value === null) return;
            onChange((previous) => ({ ...previous, firstShiftDate: value }));
          }}
        />
      </Field>

      <Field
        id={startId}
        label="Время отсчёта смены"
        hint="С этого времени отсчитывается 24 часа смены."
      >
        <TimeField
          id={startId}
          value={profile.shiftStartTime}
          onChange={(shiftStartTime) =>
            onChange((previous) => ({ ...previous, shiftStartTime }))
          }
        />
      </Field>

      {/* Учётного года здесь больше нет.
          -------------------------------------------------------------
          Он стоял списком рядом с караулом и нормой, то есть выглядел
          свойством человека. Год не свойство: это то, ЗА ЧТО смотрим —
          тот же вопрос, что «полугодие или март». Поэтому он переехал в
          окно выбора периода, к отрезкам и месяцам, и меняется там же,
          где на него смотрят. */}
    </div>
  );
}

/**
 * Подпись, знак вопроса и само поле.
 *
 * Знак вопроса стоит у подписи, а не под полем: пояснение отвечает на
 * вопрос «что здесь выбрать», и читают его до выбора, а не после.
 */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        {hint && <Hint label={`Что такое «${label}»`}>{hint}</Hint>}
      </div>
      {children}
    </div>
  );
}
