"use client";

import { CalendarRange, StickyNote } from "lucide-react";
import { useState } from "react";

import { DialogActions, DialogButton } from "@/components/ui/dialog-parts";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils/cn";
import { Card, Field } from "@/components/ui/panel";

import { parseHours } from "../domain/decimal";
import { formatDayMonthRu } from "../domain/format";
import type { IsoDate } from "../domain/plain-date";
import { dayRu, spanRu } from "./changes-timeline";
import { DateField } from "./date-field";

/**
 * Два окна события: «по какое число» и «что было в этот день».
 *
 * --- Почему отдельным файлом ------------------------------------------------
 *
 * Открывают их из двух мест. Первое — перечень видов у клетки
 * (`day-ring.tsx`): отметил отпуск, и следом спрашивают срок. Второе —
 * перечень внесённых изменений (`changes-list.tsx`): карандаш у строки
 * «Отпуск, 3 — 14 июля» открывает то же самое окно, чтобы подвинуть
 * границу.
 *
 * Разойдись эти два окна хоть полем, хоть словом в заголовке — и человек,
 * поправивший отпуск из перечня, увидел бы не то, что видел, когда его
 * ставил. Поэтому окно одно, а откуда его открыли, оно не знает.
 *
 * --- Почему их пересоздают ключом, а не правят эффектом ---------------------
 *
 * Поля внутри — своё состояние окна: набранные часы, выбранная дата. У
 * второго события эти значения другие, и взять их окно должно заново.
 * Переписывать состояние эффектом на открытие — значит рисовать окно
 * дважды и ловить порядок эффектов; поэтому окно просто ПЕРЕСОЗДАЁТСЯ:
 * `key` у него — то событие, о котором речь, и с новым событием React
 * заводит новое окно с новыми начальными значениями. Значения из свойств
 * и есть начальные: дальше окно живёт само.
 *
 * --- Почему у них нет кнопки «Отмена» ---------------------------------------
 *
 * Ни то, ни другое окно ничего не создаёт: отметка уже стоит в сутках,
 * заметка уже записана. Окно спрашивает подробность — срок, часы, текст, —
 * и закрыть его, ничего не назвав, значит оставить как есть. Кнопка
 * «Отмена» обещала бы, что закрытием что-то отменяется, а это не так:
 * убирают отметку там же, где ставили, — в перечне видов у дня или
 * крестиком в перечне изменений.
 */

/** Часы вызова по умолчанию: обычная смена. */
export const DEFAULT_CALLOUT_HOURS = "8";

/**
 * Срок у того, что длится: по какое число и, у вызова, сколько часов в сутки.
 *
 * Начало не спрашивается. У события, которое ставят нажатием по дню, начало
 * — это и есть тот день; у события, которое правят из перечня, начало уже
 * названо и стоит в заголовке. Спрашивать его второй раз значит предлагать
 * человеку передвинуть то, за чем он сюда не приходил.
 */
export function SpanModal({
  open,
  title,
  startsOn,
  endsOn,
  hours,
  onCommit,
  onClose,
  className,
}: {
  open: boolean;
  /** Название события — оно же заголовок окна. */
  title: string;
  /** С какого числа событие идёт: раньше него срок не назначить. */
  startsOn: IsoDate;
  /** По какое число сейчас — начальное значение поля (см. про `key`). */
  endsOn: IsoDate;
  /** Часы в сутки или `null`, если у события их нет (отсутствия). */
  hours: string | null;
  onCommit: (endsOn: IsoDate, hours: string | null) => void;
  onClose: () => void;
  /** Приметы окна от того, кто его открыл. */
  className?: string;
}) {
  const [until, setUntil] = useState<IsoDate>(endsOn);
  const [perDay, setPerDay] = useState(hours ?? DEFAULT_CALLOUT_HOURS);

  function commit() {
    if (hours === null) {
      onCommit(until, null);
      return;
    }
    const parsed = parseHours(perDay);
    // Больше суток в сутках не бывает, и ноль часов — это не работа.
    if (parsed === null || parsed.lessThanOrEqualTo(0) || parsed.greaterThan(24)) {
      return;
    }
    onCommit(until, parsed.toString());
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      icon={<CalendarRange />}
      // Строка под заголовком — событие таким, каким оно станет: пока человек
      // двигает дату, под названием меняются и отрезок, и число суток. Так он
      // видит итог правки, а не только поле, в котором её делает.
      lead={`${spanRu(startsOn, until < startsOn ? startsOn : until)}${
        hours === null ? "" : ` · ${perDay.trim() === "" ? "…" : perDay.trim()} ч в сутки`
      }`}
      className={cn("w-[min(30rem,calc(100vw-2rem))]", className)}
      footer={
        <DialogActions>
          <DialogButton variant="primary" onClick={commit}>
            Готово
          </DialogButton>
        </DialogActions>
      }
    >
      <Card>
        <Field id="day-event-ends" label="По дату включительно">
          <DateField
            id="day-event-ends"
            defaultValue={endsOn}
            min={startsOn}
            onChange={(next) => setUntil(next ?? startsOn)}
          />
        </Field>

        {hours === null ? null : (
          <Field id="day-event-hours" label="Часов в сутки">
            <Input
              id="day-event-hours"
              inputMode="decimal"
              value={perDay}
              onChange={(event) => setPerDay(event.target.value)}
              className="w-28 font-mono"
            />
          </Field>
        )}
      </Card>
    </Modal>
  );
}

/**
 * Заметка к суткам: строка своими словами.
 *
 * Строки ввода в перечне видов нет — отсюда и окно.
 * Пустая строка стирает заметку: это не потеря, а то же самое действие,
 * что крестик в перечне изменений, только сказанное иначе.
 */
export function NoteModal({
  open,
  day,
  text,
  onCommit,
  onClose,
  className,
}: {
  open: boolean;
  day: IsoDate;
  /** Записанная заметка — начальное значение поля (см. про `key`). */
  text: string;
  onCommit: (text: string) => void;
  onClose: () => void;
  /** Те же приметы, что у окна срока: см. `SpanModal`. */
  className?: string;
}) {
  const [draft, setDraft] = useState(text);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Заметка"
      icon={<StickyNote />}
      // Дата — под заголовком, с днём недели: заметку ставят к суткам, и
      // «вт, 10 февраля» отвечает, к каким именно.
      lead={dayRu(day)}
      // Плашки внутри нет: вопрос один, и собирать его не с чем. Бумага
      // у окна и так поднятая — та же, что была у плашки, — поэтому
      // заголовок и поле под ним читаются одним блоком. Поле при этом
      // остаётся видно: оно темнее (`bg-paper` у `Input`) и обведено.
      className={cn("w-[min(30rem,calc(100vw-2rem))]", className)}
      footer={
        <DialogActions>
          <DialogButton variant="primary" onClick={() => onCommit(draft)}>
            Готово
          </DialogButton>
        </DialogActions>
      }
    >
      {/* Подписи над полем нет. Она повторяла бы заголовок другими словами, а
          пример внутри поля («Оставьте заметку») отвечает на тот же вопрос
          точнее любой подписи.

          Фокус — в поле: `data-autofocus` читает само окно после открытия.
          Раньше его ставил эффект в родителе, в обход окна: `showModal()`
          уводил фокус на крестик, и родной `autoFocus` до этого мига не
          доживал. */}
      <Input
        id="day-event-note"
        data-autofocus=""
        value={draft}
        maxLength={500}
        placeholder="Оставьте заметку"
        aria-label={`Заметка к ${formatDayMonthRu(day)}`}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit(draft);
        }}
      />
    </Modal>
  );
}
