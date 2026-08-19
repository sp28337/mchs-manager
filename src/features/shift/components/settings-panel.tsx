"use client";

import { useId } from "react";

import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

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
 * число. Ошибиться в ней легко: перепутать караул, поставить первую смену
 * не на то января, не разобраться, вредные у него условия или обычные. До
 * сих пор такая ошибка стоила профиля целиком — исправить её можно было,
 * только удалив всё и заполнив заново вместе с годом внесённых отпусков.
 *
 * Здесь те же вопросы стоят рядом с ответом на них. Переставил караул —
 * график справа перестроился, норма пересчиталась, и сразу видно, тот ли
 * это график, который висит в части.
 *
 * --- Почему всё селектами -------------------------------------------------
 *
 * В анкете это переключатели и флажки, и там они уместны: человек видит
 * все варианты сразу, потому что выбирает впервые. Здесь он не выбирает, а
 * ПРАВИТ — обычно одно поле из восьми, — и восемь развёрнутых списков в
 * колонке шириной в двадцать знаков означали бы прокрутку вместо правки.
 * Свёрнутый список показывает текущий ответ одной строкой, и это ровно то,
 * что нужно, чтобы его проверить.
 *
 * Исключений три, и все вынужденные: имя — свободная строка, время развода
 * — время (списком из тысячи четырёхсот сорока минут его не выбирают), а
 * дата смены — дата: в году их триста шестьдесят пять.
 *
 * --- Почему норма выбирается вместе с основанием -------------------------
 *
 * Список норм — не «40/36/35», а «40 часов — общая норма», «36 часов —
 * вредные или опасные условия» и так далее. Причина в том, что оснований
 * на 36 часов два и они разные по существу; выбрав просто «36», человек
 * унёс бы в спор ссылку не на ту статью. Число при этом стоит первым, и
 * выбирать по нему так же быстро.
 *
 * --- Почему нет кнопки «Сохранить» ---------------------------------------
 *
 * По той же причине, что и в остальном приложении: запись идёт в браузер,
 * а не по сети. Отдельный шаг сохранения дал бы только возможность
 * потерять правку, закрыв вкладку.
 */

const GUARDS = [1, 2, 3, 4] as const;
/** Год берётся с запасом в обе стороны: спорят и за прошлые годы. */
function yearsAround(year: number): number[] {
  return Array.from({ length: 9 }, (_, index) => year - 5 + index);
}

export function SettingsPanel({
  profile,
  onChange,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
}) {
  const nameId = useId();
  const normId = useId();
  const guardId = useId();
  const startId = useId();
  const yearId = useId();

  const ground = weeklyNormGroundOfProfile(profile);


  return (
    <div className="space-y-4">
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

      <Field
        id={nameId}
        label="Как к вам обращаться"
        hint={
          <>
            Только для обращения. Фамилия, табельный номер и подразделение не
            нужны — расчёт от них не зависит, и мы их не спрашиваем.
          </>
        }
      >
        <Input
          id={nameId}
          maxLength={200}
          value={profile.displayName}
          onChange={(event) => {
            const displayName = event.target.value;
            onChange((previous) => ({ ...previous, displayName }));
          }}
        />
      </Field>


      <Field
        id={normId}
        label="Норма часов в неделю"
        hint={
          <>
            Основание выбирается вместе с числом: «36 часов» без ссылки на
            норму — это мнение, а «36 часов, Приказ № 308 п. 1» — довод.
            Оснований на 36 часов два, и подставить не то значит унести в спор
            не ту статью.
            <span className="mt-2 block">
              Вредные или опасные условия определяются по результатам
              специальной оценки (Приказ № 308 п. 1, Приказ № 307 п. 6).
              Северное сокращение — Приказ № 308 п. 1 (ч. 4 ст. 54 ФЗ-141) или
              Приказ № 307 п. 4 (ст. 320 ТК РФ); у сотрудника круг местностей
              шире и включает отдалённые. Инвалидность I или II группы даёт 35
              часов работнику (Приказ № 307 п. 5, абз. 4 ч. 1 ст. 92 ТК РФ).
            </span>
            <span className="mt-2 block">
              Сокращения не складываются: два основания по 36 часов дают 36, а
              не 32.
            </span>
          </>
        }
      >
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

      <Field
        id={guardId}
        label="Ваш караул"
        hint={
          <>
            Номер караула сам по себе цикл не задаёт — его задаёт вместе с
            датой смены. Если график на экране разошёлся с тем, что висит в
            части, проверьте сначала эти два поля.
          </>
        }
      >
        <Select
          id={guardId}
          value={profile.guardNumber}
          onChange={(event) => {
            const guardNumber = Number(event.target.value);
            onChange((previous) => ({ ...previous, guardNumber }));
          }}
        >
          {GUARDS.map((number) => (
            <option key={number} value={number}>
              {number}-й караул
            </option>
          ))}
        </Select>
      </Field>

      {/* Любая смена, а не первая в году: цикл четырёхдневный и одинаков в
          обе стороны, поэтому одна известная дата задаёт весь график —
          хоть завтрашняя. Здесь стоял список «1—4 января», то есть вопрос
          о дате, которую человек не помнит, а вычисляет. */}
      <DateField
        label="Любая ваша смена"
        name="knownShift"
        defaultValue={profile.firstShiftDate}
        hint="Та, в которой вы уверены. Остальной график достроится от неё в обе стороны."
        onChange={(value) => {
          if (value === null) return;
          onChange((previous) => ({ ...previous, firstShiftDate: value }));
        }}
      />

      <Field
        id={startId}
        label="Время смены караулов"
        hint={
          <>
            Отсюда считается, как смена делится между сутками. При смене
            караулов в 08:30 сутки заступления получают 15,5 часа (из них 2
            ночных), а следующие — 8,5 (из них 6 ночных). Ошибка здесь сдвигает
            месячные итоги и число ночных на стыке месяцев.
            <span className="mt-2 block">
              Продолжительность смены — 24 часа, не включая время смены
              караулов (Приказ № 308 п. 3, № 307 п. 8).
            </span>
          </>
        }
      >
        <TimeField
          id={startId}
          value={profile.shiftStartTime}
          onChange={(shiftStartTime) =>
            onChange((previous) => ({ ...previous, shiftStartTime }))
          }
        />
      </Field>

      <Field
        id={yearId}
        label="Учётный год"
        hint={
          <>
            Меняет год у графика и производственного календаря.
            <span className="mt-2 block">
              Дата вашей смены при этом остаётся прежней: цикл
              четырёхдневный и одинаков в обе стороны, поэтому по смене
              этого года график прошлого строится сам.
            </span>
            <span className="mt-2 block">
              Внесённые отпуска, вызовы и правки календаря остаются на своих
              датах: это то, что было, и переезжать вслед за годом они не
              должны. В новом году они просто окажутся за пределами периода.
            </span>
          </>
        }
      >
        <Select
          id={yearId}
          value={profile.accountingYear}
          onChange={(event) => {
            const accountingYear = Number(event.target.value);
            onChange((previous) => ({ ...previous, accountingYear }));
          }}
        >
          {yearsAround(profile.accountingYear).map((year) => (
            <option key={year} value={year}>
              {year} год
            </option>
          ))}
        </Select>
      </Field>

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
  hint: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Hint label={`Что такое «${label}»`}>{hint}</Hint>
      </div>
      {children}
    </div>
  );
}
