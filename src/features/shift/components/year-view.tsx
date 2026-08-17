"use client";

import { CalendarCog, CalendarDays, ZoomIn, ZoomOut } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";

import type { PeriodCalculation } from "../domain/calculation";
import type { IsoDate } from "../domain/plain-date";
import {
  VIEWABLE_PERIODS,
  isAccountingPeriod,
  type AccountingPeriodKind,
} from "../domain/value-objects";
import { DAY_TYPE_EFFECT, DAY_TYPE_LABELS, type DayType } from "../schemas";
import type { StoredProfile } from "../storage/profile";
import { MONTH_NAMES } from "./month-names";
import { ShiftStrip } from "./shift-strip";
import { DAY_TYPES, YearCalendarEditor } from "./year-calendar-editor";

/**
 * Год на сетке: график смен и производственный календарь на одном месте.
 *
 * --- Почему это один блок, а не два --------------------------------------
 *
 * Обе сетки показывают одно и то же — месяцы года клетками по дням недели,
 * — и человек смотрит их по очереди, сверяя одно с другим: «у меня тут
 * смена, а день-то рабочий или праздничный?». Двумя разделами подряд это
 * означало прокрутку между ними: пока долистаешь до календаря, клетка
 * графика, из-за которой пошёл, уже за экраном.
 *
 * --- Почему выбор периода тоже здесь -------------------------------------
 *
 * Он жил в боковой колонке и управлял тем, что нарисовано в этой сетке, —
 * то есть человек менял период в одном углу экрана, а смотрел на
 * последствия в другом. Теперь орган управления стоит вплотную к тому,
 * чем управляет: год, полугодие, квартал и месяц выбираются над самой
 * сеткой.
 *
 * --- Почему период одним списком -----------------------------------------
 *
 * Сначала здесь стояли сегменты «3 месяца / 6 месяцев / Год» и отдельный
 * список «который из них». Два органа управления ради одного выбора: чтобы
 * попасть в третий квартал, нужно было нажать сегмент и потом выбрать
 * номер. Отрезков всего семь — четыре квартала, два полугодия и год, — и
 * они прекрасно живут одним списком, где выбор делается за одно движение.
 *
 * Квартал показан и сотруднику, хотя учётным периодом у него не является
 * (Приказ № 308 п. 2). Смотреть на квартал ему нужно по той же причине,
 * по которой нужен месяц, — найти, где разошлось; разницу говорит подпись
 * под списком, а не запрет.
 *
 * --- Зачем масштаб --------------------------------------------------------
 *
 * Двенадцать месяцев по три в ряд — компромисс, который никому не подходит
 * целиком. Тому, кто ищет одну спорную смену, нужны крупные клетки с
 * читаемым кодом вызова; тому, кто смотрит, «как лёг год», нужны все
 * двенадцать месяцев разом, без прокрутки. Это разные задачи, и выбирать
 * между ними должен человек, а не вёрстка.
 *
 * Масштаб общий у обеих сеток: они читаются вперемежку, и разный масштаб
 * означал бы скачок размера при каждом переключении.
 *
 * --- Почему кисть календаря тоже здесь -----------------------------------
 *
 * Она стояла под сеткой вместе с формой диапазона. Но пометка дня — это
 * два действия подряд: выбрать, чем помечать, и щёлкнуть по числу. Держать
 * их по разные стороны двенадцати месяцев значило заставлять человека
 * прокручивать между каждой парой. Кисть — орган управления сеткой, и её
 * место там же, где остальные.
 */

/**
 * Ступени масштаба — числом месяцев в ряду на широком экране.
 *
 * Классы записаны целиком, а не собраны из кусков: Tailwind ищет имена
 * классов в тексте программы, и `lg:grid-cols-${n}` он не найдёт.
 *
 * Вместе с числом колонок меняется и КЕГЛЬ в клетке: клетка квадратная и
 * растёт вместе с шириной месяца, а число внутри без этого осталось бы
 * прежним — получались бы пустые квадраты с мелкой цифрой в середине.
 * Размеры внутри клетки заданы в `em` и потому следуют за этим классом.
 */
const SCALES = [
  { columns: 2, grid: "grid-cols-1 sm:grid-cols-2", text: "text-sm" },
  { columns: 3, grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", text: "text-xs" },
  { columns: 4, grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4", text: "text-xs" },
  { columns: 6, grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-6", text: "text-[11px]" },
] as const;

/** Три месяца в ряд — то, как блок выглядел до появления масштаба. */
const DEFAULT_SCALE = 1;

/**
 * Порядок отрезков в списке — от широкого к узкому.
 *
 * Первым стоит год: это самый частый учётный период, и он же умолчание
 * экрана. Дальше сужение — полугодия, кварталы: список читается как
 * «насколько мелко смотрим».
 */
const PERIOD_ORDER: readonly AccountingPeriodKind[] = [...VIEWABLE_PERIODS].reverse();

export type YearViewKind = "shifts" | "calendar";

/** Сколько месяцев в периоде такого вида. */
function monthsIn(kind: AccountingPeriodKind): number {
  return kind === "quarter" ? 3 : kind === "half_year" ? 6 : 12;
}

function partLabel(kind: AccountingPeriodKind, index: number, year: number): string {
  if (kind === "year") return `${year} год`;
  return `${index + 1}-${kind === "quarter" ? "й квартал" : "е полугодие"}`;
}

export interface StatutoryChoice {
  kind: AccountingPeriodKind;
  index: number;
}

/** Все отрезки списком: четыре квартала, два полугодия и год. */
function allParts(): StatutoryChoice[] {
  return PERIOD_ORDER.flatMap((kind) =>
    Array.from({ length: 12 / monthsIn(kind) }, (_, index) => ({ kind, index })),
  );
}

/** Значение пункта списка: вид и номер в одной строке. */
function partValue(choice: StatutoryChoice): string {
  return `${choice.kind}:${choice.index}`;
}

export function YearView({
  profile,
  calculation,
  view,
  onViewChange,
  onChange,
  statutory,
  onStatutory,
  month,
  onMonth,
  onPickDay,
  tools,
}: {
  profile: StoredProfile;
  calculation: PeriodCalculation;
  view: YearViewKind;
  onViewChange: (view: YearViewKind) => void;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  statutory: StatutoryChoice;
  onStatutory: (choice: StatutoryChoice) => void;
  /** Месяц внутри периода или `null` — «весь период». */
  month: number | null;
  onMonth: (month: number | null) => void;
  onPickDay: (day: IsoDate) => void;
  /** Кнопки рабочего экрана: стоят слева, в одном уровне с панелью. */
  tools?: ReactNode;
}) {
  const [scale, setScale] = useState(DEFAULT_SCALE);
  // Чем помечать день в календаре. Состояние экрана, а не данных: оно
  // живёт здесь, потому что кисть стоит в этой панели, а красит в сетке
  // ниже.
  const [brush, setBrush] = useState<DayType>("weekend");

  const step = SCALES[scale] ?? SCALES[DEFAULT_SCALE];
  // Отступ по краям на телефоне: месяц во всю ширину экрана растягивался
  // на двенадцать громоздких блоков подряд. Вместе с полем самой страницы
  // получается примерно четыре пятых ширины экрана — месяц снова похож на
  // страницу календаря, а клетка остаётся достаточно крупной, чтобы по
  // ней попасть пальцем.
  const grid = cn("grid gap-x-6 gap-y-5 max-sm:px-[5%]", step.grid, step.text);

  const span = monthsIn(statutory.kind);
  const first = statutory.index * span;
  const monthsAvailable = Array.from({ length: span }, (_, offset) => first + offset);

  // Список делится по признаку, который человеку важен: что из этого его
  // учётный период по приказу, а что — просто отрезок для сверки.
  const parts = allParts();
  const lawful = parts.filter((part) => isAccountingPeriod(part.kind, profile.employmentKind));
  const viewOnly = parts.filter(
    (part) => !isAccountingPeriod(part.kind, profile.employmentKind),
  );

  return (
    <div className="space-y-4">
      {/* Одна панель на всё управление сеткой: что показать, за какой
          период и каким размером. Разнеси это по углам — и человек будет
          искать, где переключается год.

          Подложки у панели нет. Плашка цвета бумаги над сеткой, которая
          сама теперь плашка, читалась как второй слой поверх первого —
          два блока, спорящих за передний план. Управление держится
          линейками, а не фоном. */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Кнопки и переключатель вида — одной группой слева, вплотную:
              `justify-between` растащил бы их по краям, и кнопки уехали
              бы от сетки, которой они не управляют, к масштабу, которым
              они не являются. */}
          <div className="flex flex-wrap items-center gap-3">
          {tools}

          <Segmented label="Что показывать на сетке">
            <SegmentedItem
              active={view === "shifts"}
              onClick={() => onViewChange("shifts")}
            >
              <CalendarDays aria-hidden />
              {/* «График смен» на телефоне съедает всю строку, а рядом
                  стоит «Календарь» — второго графика тут нет, и слово
                  «смен» ничего не различает. */}
              <span className="hidden sm:inline">График смен</span>
              <span className="sm:hidden">График</span>
            </SegmentedItem>
            <SegmentedItem
              active={view === "calendar"}
              onClick={() => onViewChange("calendar")}
            >
              <CalendarCog aria-hidden />
              <span className="hidden sm:inline">Производственный календарь</span>
              <span className="sm:hidden">Календарь</span>
            </SegmentedItem>
          </Segmented>
          </div>

          <div className="hidden items-center gap-1 lg:flex">
            <span className="mr-1 font-display text-[11px] font-bold uppercase tracking-wide text-ink-muted">
              Масштаб
            </span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="rounded-xl"
              aria-label="Крупнее: меньше месяцев в ряду"
              disabled={scale === 0}
              onClick={() => setScale((previous) => Math.max(0, previous - 1))}
            >
              <ZoomIn aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="rounded-xl"
              aria-label="Мельче: больше месяцев в ряду"
              disabled={scale === SCALES.length - 1}
              onClick={() =>
                setScale((previous) => Math.min(SCALES.length - 1, previous + 1))
              }
            >
              <ZoomOut aria-hidden />
            </Button>
            {/* Что именно изменилось, названо числом, а не «средний
                масштаб»: на экране это ровно число месяцев в ряду, и по
                нему человек сразу видит, докуда ещё можно тянуть. */}
            <span
              aria-live="polite"
              className="ml-1 w-20 font-mono text-[11px] text-ink-muted"
            >
              по {step.columns} в ряд
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          <span className="font-display text-[11px] font-bold uppercase tracking-wide text-ink-muted">
            Период
          </span>

          {/* Один список на все семь отрезков. Учётные периоды человека
              стоят первой группой, остальные — второй, и подпись группы
              говорит, чем они отличаются, не запрещая на них смотреть. */}
          <Select
            aria-label="Период"
            className="h-9 w-auto rounded-xl"
            value={partValue(statutory)}
            onChange={(event) => {
              const [kind, index] = event.target.value.split(":");
              onStatutory({
                kind: kind as AccountingPeriodKind,
                index: Number(index),
              });
              // Месяц сбрасывается вместе с периодом: он выбирался из
              // месяцев прежнего и в новый может не входить.
              onMonth(null);
            }}
          >
            <optgroup label="Учётный период">
              {lawful.map((part) => (
                <option key={partValue(part)} value={partValue(part)}>
                  {partLabel(part.kind, part.index, profile.accountingYear)}
                </option>
              ))}
            </optgroup>
            {viewOnly.length > 0 ? (
              <optgroup label="Только для сверки">
                {viewOnly.map((part) => (
                  <option key={partValue(part)} value={partValue(part)}>
                    {partLabel(part.kind, part.index, profile.accountingYear)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>

          <Hint label="Чем учётный период отличается от отрезка для сверки">
            Переработка определяется по итогу УЧЁТНОГО периода (ст. 104 ТК
            РФ): у сотрудника ФПС ГПС это полугодие или год (Приказ № 308
            п. 2), у работника по трудовому договору — ещё и квартал (Приказ
            № 307 п. 7). Остальные отрезки списка и месяц ниже переработку не
            определяют, но по ним удобно искать, в каком именно месяце расчёт
            разошёлся с выданным табелем.
          </Hint>

          <Select
            aria-label="Месяц внутри периода"
            className="h-9 w-auto rounded-xl"
            value={month === null ? "all" : String(month)}
            onChange={(event) => {
              const raw = event.target.value;
              onMonth(raw === "all" ? null : Number(raw));
            }}
          >
            <option value="all">Весь период</option>
            {monthsAvailable.map((index) => (
              <option key={index} value={index}>
                {MONTH_NAMES[index]}
              </option>
            ))}
          </Select>

          <span className="ml-auto font-mono text-[11px] text-ink-muted">
            {profile.accountingYear}
          </span>
        </div>

        {/* Кисть календаря — в той же панели, что и всё остальное
            управление сеткой, и только когда календарь показан: у графика
            смен красить нечего. */}
        {view === "calendar" ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-rule pt-3">
            <span className="font-display text-[11px] font-bold uppercase tracking-wide text-ink-muted">
              Чем помечать
            </span>
            {/* На телефоне четыре подписи в строку не помещаются, а
                сокращать «предпраздничный» нельзя — это название из ст. 95
                ТК РФ. Поэтому полоса переносится на вторую строку, а не
                уезжает вбок: выбранное положение обязано быть видно, иначе
                человек красит, не зная чем. */}
            <Segmented
              label="Чем помечать день"
              className="max-sm:h-auto max-sm:flex-wrap max-sm:gap-1"
            >
              {DAY_TYPES.map((type) => (
                <SegmentedItem
                  key={type}
                  active={brush === type}
                  onClick={() => setBrush(type)}
                >
                  {DAY_TYPE_LABELS[type]}
                </SegmentedItem>
              ))}
            </Segmented>
            <p className="min-w-0 text-[11px] text-ink-muted" aria-live="polite">
              {DAY_TYPE_EFFECT[brush]}. Щёлкните по числу.
            </p>
          </div>
        ) : null}
      </div>

      {/* Сетка стоит здесь, и над ней — только панель управления,
          одинаковая у обоих видов. Поэтому при переключении клетка
          остаётся ровно на своём месте: проверено замером, положение
          первой клетки и прокрутка страницы не меняются ни на пиксель. */}
      {view === "shifts" ? (
        <ShiftStrip
          calculation={calculation}
          gridClassName={grid}
          dayNotes={profile.dayNotes}
          onPickDay={onPickDay}
        />
      ) : (
        <YearCalendarEditor
          profile={profile}
          onChange={onChange}
          gridClassName={grid}
          brush={brush}
        />
      )}
    </div>
  );
}
