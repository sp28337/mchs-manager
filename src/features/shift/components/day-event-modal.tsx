"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Card, Field } from "@/components/ui/panel";

import { parseHours } from "../domain/decimal";
import { formatDayMonthRu } from "../domain/format";
import type { IsoDate } from "../domain/plain-date";
import { DateField } from "./date-field";

/**
 * Два окна события: «по какое число» и «что было в этот день».
 *
 * --- Почему отдельным файлом ------------------------------------------------
 *
 * Открывают их из двух мест. Первое — кольцо видов вокруг клетки
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
 * убирают отметку там же, где ставили, — в кольце или крестиком в перечне.
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
      className="w-[min(30rem,calc(100vw-2rem))]"
    >
      <div className="flex flex-col items-center space-y-4">
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

        <Button type="button" onClick={commit}>
          Готово
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Заметка к суткам: строка своими словами.
 *
 * Строка в квадрат кольца со стороной в клетку не встаёт — отсюда и окно.
 * Пустая строка стирает заметку: это не потеря, а то же самое действие,
 * что крестик в перечне изменений, только сказанное иначе.
 */
export function NoteModal({
  open,
  day,
  text,
  onCommit,
  onClose,
}: {
  open: boolean;
  day: IsoDate;
  /** Записанная заметка — начальное значение поля (см. про `key`). */
  text: string;
  onCommit: (text: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(text);

  /**
   * Фокус в поле — после того, как окно открылось.
   *
   * `showModal()` уводит его на первое, за что в окне можно зацепиться, то
   * есть на крестик, и родной `autoFocus` до этого мига не доживает: поле
   * появляется раньше, чем окно открывают. Этот эффект стоит в РОДИТЕЛЕ
   * окна, а родительские эффекты выполняются после его собственных —
   * значит, последнее слово о фокусе остаётся за ним.
   */
  useEffect(() => {
    if (!open) return;
    document.getElementById("day-event-note")?.focus();
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Заметка · ${formatDayMonthRu(day)}`}
      // Плашки внутри нет: вопрос один, и собирать его не с чем. Бумага
      // у окна и так поднятая — та же, что была у плашки, — поэтому
      // заголовок «Заметка · 3 марта» и поле под ним читаются одним
      // блоком. Поле при этом остаётся видно: оно темнее (`bg-paper` у
      // `Input`) и обведено.
      className="w-[min(30rem,calc(100vw-2rem))]"
    >
      <div className="space-y-4">
        {/* Подписи над полем нет. Она повторяла заголовок окна другими
            словами — «Заметка · 3 марта» и «Что было в этот день», — а
            пример внутри поля («Например: обещали отгул») отвечает на тот
            же вопрос точнее любой подписи. */}
        <Input
          id="day-event-note"
          value={draft}
          maxLength={500}
          placeholder="Например: обещали отгул"
          aria-label={`Заметка к ${formatDayMonthRu(day)}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommit(draft);
          }}
        />

        <Button type="button" className="w-full" onClick={() => onCommit(draft)}>
          Готово
        </Button>
      </div>
    </Modal>
  );
}
