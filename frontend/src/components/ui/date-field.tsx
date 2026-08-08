"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";
import { maskDateRu, parseDateRu } from "@/features/shift/domain/format";
import type { IsoDate } from "@/features/shift/domain/plain-date";

/**
 * Ввод даты в российском формате.
 *
 * --- Почему не `<input type="date">` -------------------------------------
 *
 * Нативное поле показывает дату по настройкам БРАУЗЕРА, а не по языку
 * страницы: `lang="ru"` на него не влияет. У большинства оно выглядит как
 * `mm/dd/yyyy` — американский порядок посреди русского интерфейса.
 * Перепутать в нём 03.01 и 01.03 не просто легко, а естественно, и цена
 * ошибки здесь — две недели чужого отпуска, ушедшие в расчёт.
 *
 * --- Что взамен ----------------------------------------------------------
 *
 * Обычное текстовое поле с маской: человек набирает цифры, точки
 * подставляются сами. Даты отпусков и больничных люди переписывают из
 * приказа, где они уже написаны как ДД.ММ.ГГГГ, и набрать восемь цифр
 * быстрее, чем щёлкать по выпадающему календарю.
 *
 * --- Почему ошибка показывается, а не исправляется -----------------------
 *
 * `31.02.2026` не превращается в 3 марта. `Date` поступил бы именно так, и
 * в расчёт попал бы день, которого человек не вводил, — молча.
 */

export interface DateFieldProps {
  label: string;
  name: string;
  required?: boolean;
  /** Начальное значение в ISO. */
  defaultValue?: IsoDate;
  /** Границы допустимого — включительно, в ISO. */
  min?: IsoDate;
  max?: IsoDate;
  hint?: string;
  className?: string;
  onChange?: (value: IsoDate | null) => void;
}

/**
 * Значение уходит в форму скрытым полем в ISO.
 *
 * Так `FormData` получает то же, что и раньше, и обработчики форм не
 * знают о смене способа ввода. Видимое поле имени не имеет — иначе в
 * форму попали бы обе строки, и однажды прочитали бы не ту.
 */
export function DateField({
  label,
  name,
  required = false,
  defaultValue,
  min,
  max,
  hint,
  className,
  onChange,
}: DateFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  const [text, setText] = useState(defaultValue ? toRu(defaultValue) : "");
  const [touched, setTouched] = useState(false);

  const parsed = parseDateRu(text);
  const empty = text.trim() === "";

  let problem: string | null = null;
  if (touched && !empty && parsed === null) {
    problem = "Не похоже на дату. Формат: ДД.ММ.ГГГГ";
  } else if (parsed !== null && min !== undefined && parsed < min) {
    problem = `Не раньше ${toRu(min)}`;
  } else if (parsed !== null && max !== undefined && parsed > max) {
    problem = `Не позже ${toRu(max)}`;
  } else if (touched && empty && required) {
    problem = "Укажите дату";
  }

  const valid = parsed !== null && problem === null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="ДД.ММ.ГГГГ"
        value={text}
        aria-describedby={cn(hint ? hintId : undefined, problem ? errorId : undefined)}
        aria-invalid={problem !== null}
        className={cn("w-40 font-mono", problem && "border-signal")}
        onChange={(event) => {
          const next = maskDateRu(event.target.value);
          setText(next);
          onChange?.(parseDateRu(next));
        }}
        onBlur={() => setTouched(true)}
      />
      {/* Разобранное значение — единственное, что уходит в форму. Пустая
          строка при неверном вводе намеренна: пусть форма откажет, чем
          примет наполовину набранную дату. */}
      <input type="hidden" name={name} value={valid ? parsed : ""} />
      {hint ? (
        <p id={hintId} className="max-w-44 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {problem ? (
        <p id={errorId} role="alert" className="max-w-44 text-xs text-signal">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function toRu(iso: IsoDate): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}
