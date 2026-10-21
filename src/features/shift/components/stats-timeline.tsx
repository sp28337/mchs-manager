import { cn } from "@/lib/utils/cn";

import type { IsoDate } from "../domain/plain-date";
import { spanOn, timelineOf } from "../model/stats-timeline";
import { MONTH_NAMES } from "./month-names";

/**
 * Лента периода: отпуска, больничные, командировки, отгулы и вызовы — по датам,
 * одной картинкой на весь год.
 *
 * --- Зачем она, если ниже те же события перечнем --------------------------
 *
 * Перечень отвечает «когда именно и сколько», и на этот вопрос он хорош. Но не
 * на тот, с которого начинают смотреть год: «где меня не было и где я вкалывал
 * без передыха». Три отпуска и два больничных — пять строк, из которых картину
 * приходится складывать в голове; на ленте видно сразу, что лето ушло на отдых,
 * а в марте и сентябре человек болел.
 *
 * Лента ничего не добавляет к перечню и не заменяет его: события те же, даты те
 * же, цвета те же, что у клеток на сетке. Поэтому для программы чтения её нет
 * вовсе (`aria-hidden`) — всё, что на ней нарисовано, прочитано перечнем ниже.
 *
 * --- Как устроена ---------------------------------------------------------
 *
 * Строка на группу событий, по оси — сутки периода, а не месяцы: у февраля
 * двадцать восемь суток, и ровные двенадцать долей сдвигали бы события коротких
 * месяцев (`model/stats-timeline.ts`). Красная черта — сегодня, тем же цветом,
 * каким сегодняшние сутки обведены на сетке; её нет, если сегодня вне периода.
 *
 * Цвета берутся у клеток события (`ABSENCE_TONE`, `CALLOUT_TONE`), поэтому
 * собственные цвета, выбранные в настройках, ложатся и сюда.
 */

export interface TimelineSpan {
  readonly key: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** Вид клетки этого события на сетке. */
  readonly tone: string;
  /** Подсказка под указателем: «Отпуск, 6 июля — 26 июля». */
  readonly title: string;
}

export interface TimelineRow {
  readonly key: string;
  readonly label: string;
  readonly spans: readonly TimelineSpan[];
}

/** Высота строки и просвет между строками — те же у подписей и у дорожек. */
const ROW = "h-5";
const GAP = "space-y-1.5";

export function PeriodTimeline({
  year,
  months,
  rows,
  today,
}: {
  year: number;
  /** Месяцы периода: от 0 до 11, подряд. */
  months: readonly number[];
  rows: readonly TimelineRow[];
  today: IsoDate;
}) {
  const timeline = timelineOf(year, months, today);
  // На узком экране подписи двенадцати месяцев сливаются: остаются каждая вторая.
  const sparse = months.length > 6;

  return (
    <div aria-hidden className="flex gap-3">
      {/* Подписи строк — отдельным столбцом, а не внутри дорожки: дорожка
          целиком отдана датам, и слово поверх события закрывало бы его. */}
      <div className="w-[5.25rem] shrink-0 sm:w-28">
        <div className="h-4" />
        <div className={GAP}>
          {rows.map((row) => (
            <div
              key={row.key}
              className={cn(ROW, "flex items-center truncate text-[11px] text-ink-muted")}
            >
              {row.label}
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="relative h-4">
          {timeline.months.map((it, index) => (
            <span
              key={it.month}
              className={cn(
                "absolute top-0 pl-0.5 text-[10px] leading-4 text-ink-faint",
                sparse && index % 2 === 1 && "max-sm:hidden",
              )}
              style={{ left: `${it.left}%` }}
            >
              {MONTH_NAMES[it.month]!.slice(0, 3).toLowerCase()}
            </span>
          ))}
        </div>

        <div className="relative">
          <div className={GAP}>
            {rows.map((row) => (
              <div key={row.key} className={cn(ROW, "relative rounded-md bg-paper-sunken")}>
                {/* Черты месяцев — внутри дорожки и под событиями: событие
                    ложится поверх черты, а не режется ею. Первой черты нет —
                    это левый край. */}
                {timeline.months.slice(1).map((it) => (
                  <span
                    key={it.month}
                    className="absolute inset-y-0 w-px bg-rule"
                    style={{ left: `${it.left}%` }}
                  />
                ))}

                {row.spans.map((item) => {
                  const span = spanOn(timeline, item.from, item.to);
                  if (span === null) return null;

                  return (
                    <span
                      key={item.key}
                      title={item.title}
                      // Не уже пяти точек: отгул на одни сутки в году — сотая
                      // доля ширины, то есть три точки на широком экране, и
                      // тоньше он перестаёт быть виден как событие.
                      className={cn(
                        "absolute inset-y-0 min-w-[5px] border",
                        item.tone,
                        // Вид клетки — пунктирная рамка и скругление побольше;
                        // на узком отрезке пунктир не читается, а скругление
                        // съедает его.
                        "rounded-[3px] border-solid",
                      )}
                      style={{ left: `${span.left}%`, width: `${span.width}%` }}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {timeline.today === null ? null : (
            <span
              className="pointer-events-none absolute -inset-y-0.5 w-0.5 rounded-full bg-signal"
              style={{ left: `${timeline.today}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
