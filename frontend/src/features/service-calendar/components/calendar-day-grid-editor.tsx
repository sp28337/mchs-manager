"use client";

import { useRouter } from "next/navigation";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ErrorPanel } from "@/components/shared/error-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client/client";
import { cn } from "@/lib/utils/cn";

import { publishCalendarYear, setCalendarDays } from "../api";
import {
  DAY_TYPE_EFFECT,
  DAY_TYPE_LABELS,
  DAY_TYPE_MARK,
  DAY_TYPE_TONE,
  type CalendarDay,
  type CalendarYear,
  type DayType,
} from "../schemas";

/**
 * FE039 — редактор производственного календаря.
 *
 * DoD: «редактор позволяет массово задать `day_type` для диапазона».
 *
 * --- Диапазон — основная операция, а не удобство -----------------------
 *
 * Администратор размечает не день, а период: новогодние каникулы,
 * майские, перенос выходного. Поэтому диапазон задаётся ДВУМЯ способами,
 * и ни один не является «версией для доступности»:
 *
 * * поле «с … по …» — быстрее всего для «31.12–08.01» и работает с
 *   клавиатуры, без единого щелчка по сетке;
 * * Shift+щелчок по сетке — для случая, когда границы проще увидеть,
 *   чем назвать датой.
 *
 * Перетаскивания нет вовсе: WCAG 2.2 (2.5.7) требует альтернативу
 * любому перетаскиванию, а здесь оно не даёт ничего сверх Shift+щелчка.
 *
 * --- Правки копятся, отправляются одним запросом ------------------------
 *
 * `POST /years/{year}/days` принимает до 366 дней и применяет их как одно
 * изменение. Отправлять каждую клетку отдельно значило бы получить
 * наполовину размеченный год, если связь оборвалась посередине, — и
 * заодно сделать «Отмена» невозможной.
 *
 * Поэтому изменения держатся локально до «Сохранить», их число всё время
 * на экране, а уход со страницы с несохранёнными правками спрашивает
 * подтверждение.
 *
 * --- Публикация необратима ---------------------------------------------
 *
 * Опубликованный календарь — основание расчёта нормы за весь год
 * (Алгоритм Б), и сервер отвечает 423 на любую попытку правки. Редактор
 * не «блокирует поля»: их нет, потому что действия нет. Кнопка
 * публикации спрашивает подтверждение — это единственное необратимое
 * действие на экране.
 */

export interface CalendarDayGridEditorProps {
  calendar: CalendarYear;
  token?: string | null;
  /** Может ли пользователь править календарь (роль `system_admin`). */
  editable: boolean;
}

const DAY_TYPES: DayType[] = ["working", "pre_holiday", "holiday", "weekend"];

const MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function CalendarDayGridEditor({
  calendar,
  token,
  editable,
}: CalendarDayGridEditorProps) {
  const router = useRouter();
  const fromId = useId();
  const toId = useId();

  const [brush, setBrush] = useState<DayType>("holiday");
  const [pending, setPending] = useState<Map<string, DayType>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const lastClicked = useRef<string | null>(null);

  const saved = useMemo(() => {
    const index = new Map<string, DayType>();
    for (const day of calendar.days) index.set(day.day, day.dayType);
    return index;
  }, [calendar.days]);

  const typeOf = useCallback(
    (iso: string): DayType | undefined => pending.get(iso) ?? saved.get(iso),
    [pending, saved],
  );

  const readOnly = calendar.published || !editable;

  const paint = useCallback(
    (from: string, to: string, dayType: DayType) => {
      const [start, end] = from <= to ? [from, to] : [to, from];
      setPending((previous) => {
        const next = new Map(previous);
        const cursor = new Date(`${start}T00:00:00Z`);
        const last = new Date(`${end}T00:00:00Z`);
        while (cursor <= last) {
          const iso = cursor.toISOString().slice(0, 10);
          // Значение, совпадающее с сохранённым, из правок убирается:
          // иначе счётчик «изменений: 12» считал бы возвраты к
          // исходному, и «Сохранить» отправляло бы то, что не менялось.
          if (saved.get(iso) === dayType) next.delete(iso);
          else next.set(iso, dayType);
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        return next;
      });
    },
    [saved],
  );

  const fail = useCallback((cause: unknown) => {
    setError(
      cause instanceof ApiError
        ? cause
        : new ApiError({
            type: "about:blank",
            title: "Сервер недоступен",
            status: 0,
            detail: "Не удалось выполнить действие. Проверьте соединение.",
          }),
    );
  }, []);

  async function save() {
    if (pending.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const days: CalendarDay[] = [...pending.entries()]
        .map(([day, dayType]) => ({ day, dayType }))
        .sort((a, b) => a.day.localeCompare(b.day));

      await setCalendarDays(calendar.year, days, {
        token,
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success(`Сохранено дней: ${days.length}`);
      setPending(new Map());
      router.refresh();
    } catch (cause) {
      fail(cause);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setSaving(true);
    setError(null);
    try {
      await publishCalendarYear(calendar.year, {
        token,
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success(`Календарь ${calendar.year} опубликован`);
      setConfirmPublish(false);
      router.refresh();
    } catch (cause) {
      fail(cause);
    } finally {
      setSaving(false);
    }
  }

  const unmarked = useMemo(() => {
    const total = daysInYear(calendar.year);
    let marked = 0;
    for (let month = 0; month < 12; month += 1) {
      for (let day = 1; day <= daysInMonth(calendar.year, month); day += 1) {
        if (typeOf(isoDay(calendar.year, month, day))) marked += 1;
      }
    }
    return total - marked;
  }, [calendar.year, typeOf]);

  return (
    <div className="space-y-4">
      {error ? <ErrorPanel error={error} /> : null}

      {calendar.published ? (
        <p className="rounded-sm border-l-2 border-verify bg-paper-sunken px-4 py-3 text-sm">
          Календарь опубликован{" "}
          {calendar.publishedAt
            ? new Date(calendar.publishedAt).toLocaleDateString("ru-RU")
            : null}{" "}
          и неизменяем: на нём построен расчёт нормы за весь год. Ошибку в
          опубликованном календаре исправляют новым годом расчёта, а не правкой
          прошлого.
        </p>
      ) : null}

      {!readOnly ? (
        <div className="space-y-4 rounded-sm border border-rule bg-paper-raised p-4">
          <fieldset className="space-y-2">
            <legend className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
              Тип дня
            </legend>
            <div className="flex flex-wrap gap-2">
              {DAY_TYPES.map((type) => (
                <Button
                  key={type}
                  type="button"
                  size="sm"
                  variant={brush === type ? "default" : "outline"}
                  aria-pressed={brush === type}
                  onClick={() => setBrush(type)}
                >
                  {DAY_TYPE_LABELS[type]}
                </Button>
              ))}
            </div>
            <p className="max-w-prose text-xs text-ink-muted" aria-live="polite">
              {DAY_TYPE_EFFECT[brush]}
            </p>
          </fieldset>

          <form
            className="flex flex-wrap items-start gap-3 border-t border-rule pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const from = String(form.get("from") ?? "");
              const to = String(form.get("to") ?? "");
              if (!from || !to) return;
              paint(from, to, brush);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={fromId}>С даты</Label>
              <Input
                id={fromId}
                name="from"
                type="date"
                required
                min={`${calendar.year}-01-01`}
                max={`${calendar.year}-12-31`}
                className="w-44"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={toId}>По дату включительно</Label>
              <Input
                id={toId}
                name="to"
                type="date"
                required
                min={`${calendar.year}-01-01`}
                max={`${calendar.year}-12-31`}
                className="w-44"
              />
            </div>
            <Button type="submit" variant="outline" className="mt-[1.375rem]">
              Назначить диапазону
            </Button>
            <p className="mt-[1.375rem] max-w-xs text-xs text-ink-muted">
              Границы включительно. В сетке тот же диапазон задаётся щелчком по
              первому дню и Shift+щелчком по последнему.
            </p>
          </form>
        </div>
      ) : null}

      <CalendarGrid
        year={calendar.year}
        typeOf={typeOf}
        readOnly={readOnly}
        pending={pending}
        onPick={(iso, withShift) => {
          if (withShift && lastClicked.current) paint(lastClicked.current, iso, brush);
          else paint(iso, iso, brush);
          lastClicked.current = iso;
        }}
      />

      <Legend />

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-4 border-t border-rule pt-4">
          <Button type="button" disabled={pending.size === 0 || saving} onClick={save}>
            {saving ? "Сохранение…" : `Сохранить (${pending.size})`}
          </Button>

          {pending.size > 0 ? (
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => setPending(new Map())}
            >
              Отменить правки
            </Button>
          ) : null}

          <p className="text-sm text-ink-muted" aria-live="polite">
            {pending.size > 0
              ? `Не сохранено дней: ${pending.size}.`
              : "Несохранённых изменений нет."}
            {unmarked > 0 ? ` Не размечено дней в году: ${unmarked}.` : ""}
          </p>

          <div className="ml-auto">
            {confirmPublish ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="max-w-md text-sm">
                  Опубликовать календарь {calendar.year}? После публикации он
                  неизменяем.
                </p>
                <Button
                  type="button"
                  variant="signal"
                  disabled={saving}
                  onClick={publish}
                >
                  Да, опубликовать
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmPublish(false)}
                >
                  Отмена
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="signal"
                // Публиковать с несохранёнными правками нельзя: сервер
                // опубликовал бы то, что лежит у него, а человек видит на
                // экране другое.
                disabled={pending.size > 0 || unmarked > 0}
                onClick={() => setConfirmPublish(true)}
              >
                Опубликовать год
              </Button>
            )}
          </div>

          {unmarked > 0 ? (
            <p className="w-full text-xs text-ink-muted">
              Публикация возможна только для полностью размеченного года: сервер
              отвергнет неполный календарь (норма периода считается по каждому
              дню, и день без типа сделал бы её неопределённой).
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

interface CalendarGridProps {
  year: number;
  typeOf: (iso: string) => DayType | undefined;
  readOnly: boolean;
  pending: ReadonlyMap<string, DayType>;
  onPick: (iso: string, withShift: boolean) => void;
}

/**
 * Год целиком: строка — месяц, столбец — число.
 *
 * Такая раскладка выбрана не из экономии места. Календарь размечают
 * периодами, и период почти всегда лежит внутри месяца или на стыке двух;
 * двенадцать строк дают увидеть весь год сразу и сравнить майские с
 * январскими, чего двенадцать отдельных месячных сеток не позволяют.
 */
function CalendarGrid({ year, typeOf, readOnly, pending, onPick }: CalendarGridProps) {
  const columns = Array.from({ length: 31 }, (_, index) => index + 1);

  return (
    <div className="overflow-x-auto" role="region" aria-label="Календарь года" tabIndex={0}>
      <table className="border-collapse">
        <caption className="sr-only">
          Производственный календарь {year}: строки — месяцы, столбцы — числа
        </caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
              Месяц
            </th>
            {columns.map((day) => (
              <th
                key={day}
                scope="col"
                className="w-7 px-0 py-1 text-center font-mono text-[10px] font-normal text-ink-faint"
              >
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MONTHS.map((name, month) => (
            <tr key={name}>
              <th
                scope="row"
                className="whitespace-nowrap py-0.5 pr-3 text-left text-sm font-normal"
              >
                {name}
              </th>
              {columns.map((day) => {
                if (day > daysInMonth(year, month)) {
                  return <td key={day} className="p-px" aria-hidden />;
                }
                const iso = isoDay(year, month, day);
                const type = typeOf(iso);
                const changed = pending.has(iso);
                const label = `${day} ${name} — ${type ? DAY_TYPE_LABELS[type] : "тип не задан"}`;

                return (
                  <td key={day} className="p-px">
                    {readOnly ? (
                      <span
                        title={label}
                        aria-label={label}
                        role="img"
                        className={cn(
                          "flex size-6 items-center justify-center rounded-xs border font-mono text-[10px]",
                          type ? DAY_TYPE_TONE[type] : "border-dashed border-rule text-ink-faint",
                        )}
                      >
                        {type ? DAY_TYPE_MARK[type] : "—"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        title={label}
                        aria-label={label}
                        onClick={(event) => onPick(iso, event.shiftKey)}
                        className={cn(
                          "flex size-6 items-center justify-center rounded-xs border font-mono text-[10px]",
                          "hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-trace",
                          type ? DAY_TYPE_TONE[type] : "border-dashed border-rule text-ink-faint",
                          // Несохранённая правка отмечена жирной рамкой, а
                          // не другим цветом: цвет уже занят типом дня, и
                          // второй смысл на том же канале означал бы, что
                          // ни один не читается.
                          changed && "ring-1 ring-ink ring-offset-1 ring-offset-paper",
                        )}
                      >
                        {type ? DAY_TYPE_MARK[type] : "—"}
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend() {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
      {DAY_TYPES.map((type) => (
        <div key={type} className="flex items-center gap-2">
          <dt
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-xs border font-mono text-[10px]",
              DAY_TYPE_TONE[type],
            )}
          >
            {DAY_TYPE_MARK[type]}
          </dt>
          <dd>
            <span className="font-medium">{DAY_TYPE_LABELS[type]}</span>
            <span className="text-ink-muted"> — {DAY_TYPE_EFFECT[type]}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
