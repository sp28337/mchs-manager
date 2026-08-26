"use client";

import { RotateCcw } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils/cn";

import {
  CUSTOM_PATTERN_ID,
  MAX_CUSTOM_DAYS,
  MIN_CUSTOM_DAYS,
  SCHEDULE_PATTERNS,
  schedulePatternOf,
} from "../domain/schedule-pattern";
import {
  WEEKLY_NORM_GROUNDS,
  WEEKLY_NORM_GROUND_LABELS,
  type WeeklyNormGround,
} from "../domain/value-objects";
import {
  patternOfProfile,
  weeklyNormGroundFacts,
  weeklyNormGroundOfProfile,
} from "../model/derive";
import { resetCalendar, type StoredProfile } from "../storage/profile";
import { DateField } from "./date-field";
import { formatHoursTrim as hoursTrim } from "../domain/decimal";
import { shiftMinutes } from "../domain/shift-hours";
import { HoursField } from "./hours-field";
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
  const patternId = useId();
  const customId = useId();
  const durationId = useId();

  const ground = weeklyNormGroundOfProfile(profile);
  const pattern = patternOfProfile(profile);
  const custom = profile.schedulePattern === CUSTOM_PATTERN_ID;

  return (
    <div className="space-y-4">
      {/* Как показывать расчёт — отдельной карточкой и первой.
          -------------------------------------------------------------
          Оба тумблера меняют не расчёт, а то, каким его показать, и стоять
          вперемежку с вопросами о человеке им незачем. Режим первый: он
          решает, за какой отрезок считается всё остальное.

          Пояснение под каждым — не подсказка, а СЛЕДСТВИЕ выбранного, и
          меняется вместе с ним. Прятать его в подсказку значило бы прятать
          ответ на вопрос «что я сейчас включил». */}
      {purpose === "settings" ? (
        <Card>
          <Field
            label=""
            note={
              profile.liveMode
                ? "Расчёт идёт с начала периода по сегодняшний день."
                : "Расчёт идёт за весь выбранный период целиком."
            }
            stack
          >
            <LiveModeSwitch profile={profile} onChange={onChange} spread />
          </Field>

          <Field
            label=""
            note={
              profile.overtimeInDays
                ? `Показывается сменами и часами. Смена здесь — ${hoursTrim(profile.shiftDurationHours)} ч, как указано ниже.`
                : "Показывается часами: «212,0 ч»."
            }
            stack
          >
            <Switch
              checked={profile.overtimeInDays}
              onChange={(overtimeInDays) =>
                onChange((previous) => ({ ...previous, overtimeInDays }))
              }
              label="Переработка в сутках"
              spread
            />
          </Field>
        </Card>
      ) : null}

      {/* Вопросы о человеке и его графике — второй карточкой, в том
          порядке, в каком они следуют друг из друга: график задаёт
          продолжительность смены, норма и дата от него не зависят, но
          читаются рядом. */}
      <Card>
      <Field id={nameId} label="Имя профиля" stack>
        <Input
          id={nameId}
          maxLength={200}
          // Подсказка в поле нужна не настройкам, а окну «Создать профиль»:
          // там оно пустое, и человек видит, чего от него хотят.
          placeholder="Например: Основной график"
          value={profile.displayName}
          onChange={(event) => {
            const displayName = event.target.value;
            onChange((previous) => ({ ...previous, displayName }));
          }}
        />
      </Field>

      {/* График стоит раньше нормы и даты: от него зависит и то, как
          строится календарь, и обычная продолжительность смены. Ответив на
          него первым, человек дальше правит уже подставленное, а не
          заполняет с нуля. */}
      <Field
        id={patternId}
        label="График"
        hint={
          <>
            <p>
              Сколько суток подряд рабочих и сколько за ними выходных. Цикл
              скользящий: он повторяется от названной даты смены и строится в
              обе стороны.
            </p>
            <p>
              «5/2» устроен иначе — это рабочая неделя, и её задаёт
              производственный календарь, а не цикл: в праздники смен нет, а
              перенесённые выходные учтены. Даты смены такому графику не
              нужно.
            </p>
          </>
        }
      >
        <Select
          id={patternId}
          value={pattern.id}
          onChange={(event) => {
            const id = event.target.value as StoredProfile["schedulePattern"];
            onChange((previous) => ({
              ...previous,
              schedulePattern: id,
              // Продолжительность смены следует из графика: сутки через
              // трое — 24 часа, два через два — 12, пятидневка — 8. Человек
              // может поправить её ниже, но подставить обычное для графика
              // значение приложение обязано само — иначе смена графика
              // оставляла бы суточную смену в пятидневке.
              //
              // У своего цикла обычной продолжительности не бывает: 3/1
              // водителя это восемь часов, а 3/1 сторожа — сутки. Поэтому
              // при переходе на него поле остаётся тем, что человек уже
              // поставил.
              shiftDurationHours:
                id === CUSTOM_PATTERN_ID
                  ? previous.shiftDurationHours
                  : schedulePatternOf(id).defaultShiftHours,
            }));
          }}
        >
          {SCHEDULE_PATTERNS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} — {option.title.toLowerCase()}
            </option>
          ))}
          {/* Заготовки — быстрый ответ на частый случай, а не перечень
              допустимого: 3/1, 2/1, 4/4 на вахте в него не влезут никогда.
              Поэтому последним пунктом стоит свой цикл. */}
          <option value={CUSTOM_PATTERN_ID}>Свой график</option>
        </Select>
      </Field>

      {custom ? (
        <Field
          id={customId}
          label="Свой цикл"
          hint={
            <p>
              Сколько суток подряд работать и сколько отдыхать. Цикл
              повторяется от названной даты смены в обе стороны.
            </p>
          }
          note={`Цикл в ${pattern.cycleDays} ${
            pattern.cycleDays % 10 === 1 && pattern.cycleDays % 100 !== 11
              ? "сутки"
              : "суток"
          }.`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <CycleDays
              id={customId}
              label="Рабочих суток"
              value={profile.customWorkDays}
              onChange={(customWorkDays) =>
                onChange((previous) => ({ ...previous, customWorkDays }))
              }
            />
            <span aria-hidden className="text-ink-faint">
              /
            </span>
            <CycleDays
              label="Выходных суток"
              value={profile.customRestDays}
              onChange={(customRestDays) =>
                onChange((previous) => ({ ...previous, customRestDays }))
              }
            />
          </div>
        </Field>
      ) : null}

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

      {/* Любая смена, а не первая в году: цикл одинаков в обе стороны,
          поэтому одна известная дата задаёт весь график — хоть
          завтрашняя. Здесь стоял список «1—4 января», то есть вопрос о
          дате, которую человек не помнит, а вычисляет.

          У пятидневки поля нет вовсе: её смены даёт производственный
          календарь, и дата на них не влияет никак. Оставить поле значило
          бы показать орган управления, который ничего не меняет, — а это
          хуже, чем его отсутствие. Записанное значение при этом цело и
          вернётся, стоит выбрать цикличный график. */}
      {pattern.source === "calendar" ? null : (
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
      )}

      <Field
        id={startId}
        label="Начало смены"
        hint="С этого времени отсчитывается продолжительность смены."
      >
        <TimeField
          id={startId}
          value={profile.shiftStartTime}
          onChange={(shiftStartTime) =>
            onChange((previous) => ({ ...previous, shiftStartTime }))
          }
        />
      </Field>

      {/* Продолжительность стоит сразу за временем отсчёта: вместе они
          отвечают на один вопрос — с какого часа и по какой длится смена. */}
      <Field
        id={durationId}
        label="Продолжительность смены"
        hint={
          <p>
            Обычная для выбранного графика подставляется сама, но правится:
            у двенадцатичасовых смен встречается одиннадцать с половиной
            (обед за свой счёт), у суточных — двадцать три. Это график на
            весь год; если отдельную смену сдали раньше или заступили не в
            своё время, часы правятся в самом дне — нажмите по нему в сетке.
          </p>
        }
      >
        <HoursField
          id={durationId}
          value={profile.shiftDurationHours}
          onChange={(shiftDurationHours) =>
            onChange((previous) => ({ ...previous, shiftDurationHours }))
          }
        />
      </Field>

      {/* Смены встык — не запрет, а предупреждение.
          -------------------------------------------------------------
          Суточная смена в цикле, где рабочих суток подряд несколько,
          означает работу без единого перерыва: одна смена кончается ровно
          тогда, когда начинается следующая. Арифметика при этом сходится,
          и расчёт молча выдаёт восемь тысяч часов за год — то самое тихое
          враньё, ради борьбы с которым приложение и существует.

          Запрещать нельзя: вахта 15/15 по 24 часа встречается, и человек
          знает про свой график больше нас. Но назвать это обязаны — тем
          более что чаще сюда попадают не намеренно, а сменив график и не
          заметив, что продолжительность осталась прежней. */}
      </Card>

      {pattern.workDays > 1 && shiftMinutes(profile.shiftDurationHours) >= 24 * 60 ? (
        <p className="rounded-xl bg-signal-soft px-4 py-3 text-xs">
          {pattern.workDays} рабочих суток подряд по 24 часа — смены пойдут
          встык, без перерыва между ними. Проверьте продолжительность: у
          такого цикла она обычно 8 или 12 часов.
        </p>
      ) : null}

      {/* Учётного года здесь больше нет.
          -------------------------------------------------------------
          Он стоял списком рядом с нормой, то есть выглядел свойством
          человека. Год не свойство: это то, ЗА ЧТО смотрим —
          тот же вопрос, что «полугодие или март». Поэтому он переехал в
          окно выбора периода, к отрезкам и месяцам, и меняется там же,
          где на него смотрят. */}

      {purpose === "settings" ? <ResetCalendar onChange={onChange} /> : null}
    </div>
  );
}

/**
 * Карточка настроек: несколько строк «вопрос — ответ» под одной рамкой.
 *
 * Рамка здесь не украшение, а то, что делает список настроек списком.
 * Прежде вопросы шли по странице сплошняком — подпись, поле, подпись,
 * поле, — и на телефоне, где панель открыта окном во всю высоту, отличить
 * конец одного вопроса от начала следующего можно было только по кеглю.
 * Разделённые линиями строки под общей рамкой читаются рядами таблицы, и
 * ответ у каждой стоит на своём месте, справа.
 */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-rule rounded-xl border border-rule bg-paper-raised px-4">
      {children}
    </div>
  );
}

/**
 * Сброс календаря и графика — с подтверждением и с прямым перечнем
 * последствий.
 *
 * --- Почему сбрасывается именно это ---------------------------------------
 *
 * Стирается то, что человек наставил на сетках: отпуска и больничные,
 * вызовы, правки производственного календаря, переносы и отмены смен,
 * заметки. Это единственный способ убрать их разом — по одному они
 * снимаются в окне дня, и после года ведения таких дней бывает две сотни.
 *
 * Настройки при этом остаются: имя, норма, дата рабочей смены, время
 * отсчёта, оба переключателя. Сбрасывать их незачем — они видны тут же,
 * над кнопкой, и правятся полем, а не сбросом. Дата смены остаётся ещё и
 * потому, что задаёт сам цикл: после сброса человек обязан увидеть свой
 * чистый график, а не чужой.
 *
 * Для «стереть всё» есть отдельный, честно названный способ — удалить
 * профиль с устройства, он в подвале.
 *
 * --- Почему подтверждение прямо здесь, а не окном -------------------------
 *
 * Настройки на телефоне сами открыты окном, и второе окно поверх первого
 * — это два крестика, из которых один закрывает не то. Подтверждение
 * разворачивается на месте кнопки: тот же приём, что у удаления профиля в
 * подвале, и человек уже видел его там.
 *
 * Вопрос называет и то, что уцелеет: настройки и дата смены. Без этой
 * половины человек честно испугается нажать.
 */
function ResetCalendar({
  onChange,
}: {
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="border-t border-rule pt-4">
        <button
          type="button"
          className="text-xs text-ink-muted underline underline-offset-2 hover:text-signal"
          onClick={() => setConfirming(true)}
        >
          Сбросить настройки календаря
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-rule pt-4">
      <p className="text-sm">
        Убрать с календаря и графика всё отмеченное — отпуска, вызовы, правки
        видов дней, переносы и отмены смен, заметки?
      </p>
      <p className="text-xs text-ink-muted">
        Имя, норма, дата рабочей смены, время отсчёта и оба переключателя
        останутся на месте.
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            onChange(resetCalendar);
            setConfirming(false);
          }}
        >
          <RotateCcw aria-hidden />
          Да, сбросить
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(false)}
        >
          Отмена
        </Button>
      </div>
    </div>
  );
}

/**
 * Число суток в своём цикле.
 *
 * Список, а не поле с набором: значений всего тридцать одно, и все они
 * целые. Списком нельзя ввести ни ноль, ни «два с половиной» — то есть
 * ровно те значения, из-за которых поле пришлось бы стеречь проверкой и
 * объяснять человеку, что он ввёл не то.
 */
function CycleDays({
  id,
  label,
  value,
  onChange,
}: {
  id?: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Select
      id={id}
      aria-label={label}
      className="w-auto font-mono"
      value={String(value)}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {Array.from(
        { length: MAX_CUSTOM_DAYS - MIN_CUSTOM_DAYS + 1 },
        (_, index) => MIN_CUSTOM_DAYS + index,
      ).map((days) => (
        <option key={days} value={days}>
          {days}
        </option>
      ))}
    </Select>
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
  note,
  stack,
  children,
}: {
  id?: string;
  label: string;
  hint?: React.ReactNode;
  /** Строка под вопросом: что следует из выбранного ответа. */
  note?: React.ReactNode;
  /**
   * Ответ под вопросом, а не справа от него.
   *
   * Для тех немногих ответов, которым строки не хватает: своего цикла из
   * двух списков и имени профиля, где обрезанное поле в треть строки
   * читается хуже пустого.
   */
  stack?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("py-3", stack ? "space-y-2" : "space-y-1")}>
      <div
        className={cn(
          "flex gap-x-4 gap-y-2",
          stack ? "flex-col" : "flex-wrap items-center justify-between",
        )}
      >
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          {hint && <Hint label={`Что такое «${label}»`}>{hint}</Hint>}
        </div>
        {/* Ответ прижат к правому краю: так у столбца ответов появляется
            своя ось, и глаз читает настройки как таблицу, а не как список
            разной длины. На узком экране строка переносится, и ответ встаёт
            под вопросом сам. */}
        <div className={cn("flex items-center gap-2", stack ? "" : "justify-end")}>
          {children}
        </div>
      </div>
      {note ? (
        <p className="text-xs text-ink-muted" aria-live="polite">
          {note}
        </p>
      ) : null}
    </div>
  );
}
