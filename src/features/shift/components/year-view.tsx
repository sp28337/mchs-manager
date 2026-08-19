"use client";

import { CalendarCog, CalendarDays, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils/cn";

import type { PeriodCalculation } from "../domain/calculation";
import type { IsoDate } from "../domain/plain-date";
import type { StoredProfile } from "../storage/profile";
import { LiveModeSwitch } from "./live-mode";
import { PeriodPicker, type StatutoryChoice } from "./period-picker";
import { ShiftStrip } from "./shift-strip";
import { YearCalendarEditor } from "./year-calendar-editor";

export type { StatutoryChoice };

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
 * --- Почему период одной кнопкой -----------------------------------------
 *
 * Сначала здесь стояли сегменты «3 месяца / 6 месяцев / Год» и отдельный
 * список «который из них», потом один список на семь отрезков и второй —
 * на месяцы внутри. И то и другое было двумя органами управления ради
 * одного выбора. Теперь это одна кнопка, называющая выбранный отрезок, и
 * окно со всеми девятнадцатью (`PeriodPicker`).
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
 * --- Куда делась кисть календаря -----------------------------------------
 *
 * Была: выбрать, чем помечать, потом щёлкнуть по числу. Два действия и
 * скрытое состояние — щёлкнув по дню, человек получал то, что выбрал
 * когда-то раньше, и не всегда помнил, что именно.
 *
 * Теперь у календаря та же механика, что у графика: нажатие по дню
 * открывает окно этих суток, и вид дня выбирается ТАМ, вместе с заметкой.
 * Ни кисти, ни формы диапазона под сеткой — одна дорога вместо трёх.
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

/**
 * Умолчание масштаба — по тому, есть ли чем его менять.
 *
 * Кнопки масштаба стоят только на широком экране (`lg`): на телефоне
 * месяцы всё равно идут в одну-две колонки, и регулировать там нечего.
 * Значит, там, где менять НЕЛЬЗЯ, сетка обязана сразу быть самой
 * компактной — иначе человек остаётся с раскладкой, которая ему не
 * подходит, и без способа это исправить.
 *
 * Там, где менять можно, умолчание на ступень крупнее: шесть месяцев в
 * ряд на тысяче точек дают клетку в два десятка пикселей, и открывать
 * экран на ней значило бы заставить первым делом нажать «крупнее».
 */
const SMALLEST_SCALE = SCALES.length - 1;
const DEFAULT_ZOOMABLE_SCALE = SCALES.length - 2;

export type YearViewKind = "shifts" | "calendar";

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
}) {
  // Кнопки масштаба появляются с `lg` — тем же порогом, что и колонки в
  // сетке. Условие продублировано здесь, а не выведено из классов: узнать
  // из Tailwind, применился ли `lg:`, нельзя.
  const zoomable = useMediaQuery("(min-width: 1024px)");

  // Выбор человека, пока его не было — `null`. Так умолчание остаётся
  // живым: окно расширили до кнопок масштаба — раскладка стала крупнее
  // сама, а не осталась той, что сложилась на узком экране. Как только
  // человек нажал кнопку, его выбор перестаёт слушать ширину.
  const [chosen, setChosen] = useState<number | null>(null);
  const scale = chosen ?? (zoomable ? DEFAULT_ZOOMABLE_SCALE : SMALLEST_SCALE);

  const step = SCALES[scale] ?? SCALES[1]!;
  // Отступ по краям на телефоне: месяц во всю ширину экрана растягивался
  // на двенадцать громоздких блоков подряд. Вместе с полем самой страницы
  // получается примерно четыре пятых ширины экрана — месяц снова похож на
  // страницу календаря, а клетка остаётся достаточно крупной, чтобы по
  // ней попасть пальцем.
  const grid = cn("grid gap-x-6 gap-y-5 max-sm:px-[5%] flex-1", step.grid, step.text);

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
        <div className="flex flex-wrap items-center gap-3">
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

          {/* Период стоит в одной строке с видом сетки: и то и другое
              отвечает на вопрос «что я сейчас вижу». */}
          {/* Учётный год записывается прямо в профиль, а не хранится
              состоянием экрана: человек, вернувшийся к прошлогоднему
              расчёту через день, должен найти его там же, где оставил.
              Отдельного свойства у `YearView` для этого не нужно —
              обновление профиля здесь уже есть. */}
          <PeriodPicker
            accountingYear={profile.accountingYear}
            onAccountingYear={(accountingYear) =>
              onChange((previous) => ({ ...previous, accountingYear }))
            }
            statutory={statutory}
            onStatutory={onStatutory}
            month={month}
            onMonth={onMonth}
          />

          {/* Тумблер здесь, а не только в настройках: он меняет то, что
              нарисовано в сетке, — значит, стоит там, где на это смотрят. */}
          <LiveModeSwitch profile={profile} onChange={onChange} />

          <div className="ml-auto hidden items-center gap-1 lg:flex">
            <span className="mr-1 font-display text-[11px] font-bold uppercase tracking-wide text-ink-muted">
              Масштаб
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="rounded-xl"
              aria-label="Крупнее: меньше месяцев в ряду"
              disabled={scale === 0}
              onClick={() => setChosen(Math.max(0, scale - 1))}
            >
              <ZoomIn aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="rounded-xl"
              aria-label="Мельче: больше месяцев в ряду"
              disabled={scale === SMALLEST_SCALE}
              onClick={() => setChosen(Math.min(SMALLEST_SCALE, scale + 1))}
            >
              <ZoomOut aria-hidden />
            </Button>
          </div>
        </div>

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
          dayNotes={profile.dayNotes}
          onPickDay={onPickDay}
        />
      )}
    </div>
  );
}
