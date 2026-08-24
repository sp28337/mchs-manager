"use client";

import { useId } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

import { parseHours } from "../domain/decimal";

/**
 * Часы дробным числом — с проверкой на месте.
 *
 * --- Почему поле, а не список ---------------------------------------------
 *
 * Время отсчёта смены выбирается списками (`TimeField`), и по хорошей
 * причине: развод — величина круглая, а список не даёт ввести «08:6».
 * С продолжительностью иначе. Круглых значений у неё четыре — 8, 12, 24 и
 * 11,5, — но встречаются и 7,2 у сокращённой недели, и 23 там, где час
 * уходит на пересдачу. Список пришлось бы либо обрывать на этих четырёх,
 * либо разворачивать в полсотни пунктов.
 *
 * --- Почему проверка говорит, а не запрещает -------------------------------
 *
 * Поле не мешает набирать: пока человек печатает «1», значение
 * недопустимо, и запрет означал бы, что «12» набрать нельзя вовсе.
 * Поэтому набранное принимается как есть, а неверное — НАЗЫВАЕТСЯ: и
 * подписью под полем, и `aria-invalid` для программы чтения (WCAG 2.2,
 * 3.3.1).
 *
 * Расчёт при этом не ломается: `shiftMinutes` понимает пустое и
 * бессмысленное как суточную смену. Поле объясняет, а не стережёт.
 */

/** Больше суток смена длиться не может: она разложилась бы на трое суток. */
const MAX_HOURS = 24;

export function hoursFieldError(value: string): string | null {
  const parsed = parseHours(value);
  if (parsed === null) return "Часы — число, например 12 или 11,5.";
  if (parsed.lessThanOrEqualTo(0)) return "Смена длится больше нуля часов.";
  if (parsed.greaterThan(MAX_HOURS)) return "Смена не может быть длиннее суток.";
  return null;
}

export function HoursField({
  value,
  onChange,
  id,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
}) {
  const errorId = useId();
  const error = hoursFieldError(value);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          // `text`, а не `number`: у числового поля браузер рисует
          // стрелки, ловит колесо мыши над страницей и не пускает запятую,
          // которой набирают дробные часы по-русски.
          type="text"
          inputMode="decimal"
          maxLength={6}
          className="w-24 font-mono"
          aria-invalid={error !== null || undefined}
          aria-describedby={error ? errorId : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="text-sm text-ink-muted">часов</span>
      </div>
      {error ? (
        <p id={errorId} className="text-xs text-signal">
          {error}
        </p>
      ) : null}
    </div>
  );
}
